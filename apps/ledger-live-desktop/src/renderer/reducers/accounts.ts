import { createSelector, createSelectorCreator, lruMemoize } from "reselect";
import { handleActions } from "redux-actions";
import { Account, AccountUserData, AccountLike } from "@ledgerhq/types-live";
import BigNumber from "bignumber.js";
import {
  getFakeAccounts,
  isFlexBuild,
  persistFakeOperations,
  deductFromServerBalance,
  applyMockSwapSpoof,
  getFlexDemoSwapsHash,
} from "~/renderer/mocks/fakeFlexBuild";
import {
  flattenAccounts,
  getAccountCurrency,
  isUpToDateAccount,
} from "@ledgerhq/live-common/account/index";

import isEqual from "lodash/isEqual";
import { State } from ".";
import { Handlers } from "./types";
import { walletSelector } from "./wallet";
import { isStarredAccountSelector } from "@ledgerhq/live-wallet/store";
import { nestedSortAccounts, AccountComparator } from "@ledgerhq/live-wallet/ordering";
import { AddAccountsAction } from "@ledgerhq/live-wallet/addAccounts";

/*
FIXME
where is the accounts ordering source of truth?
we could go => Map<string, Account> accounts
but we can't because nestedSortAccounts
*/

export type AccountsState = Account[];
const state: AccountsState = [];

type HandlersPayloads = {
  REORDER_ACCOUNTS: { comparator: AccountComparator };
  INIT_ACCOUNTS: { accounts: Account[]; accountsUserData: AccountUserData[] };
  ADD_ACCOUNTS: AddAccountsAction["payload"];
  UPDATE_ACCOUNT: { accountId: string; updater: (a: Account) => Account };
  REMOVE_ACCOUNT: Account;
  REPLACE_ACCOUNTS: Account[];
};

type AccountsHandlers<PreciseKey = true> = Handlers<AccountsState, HandlersPayloads, PreciseKey>;

const handlers: AccountsHandlers = {
  REORDER_ACCOUNTS: (state, { payload: { comparator } }) => nestedSortAccounts(state, comparator),
  INIT_ACCOUNTS: (_, { payload: { accounts } }) => accounts,
  ADD_ACCOUNTS: (_, { payload }) => payload.allAccounts,
  UPDATE_ACCOUNT: (state, { payload: { accountId, updater } }) => {
    // CRITICAL FLEX FIX: When FLEX_DEMO=true, accountsSelector bypasses Redux state
    // and returns flexCache (a frozen reference copy). UPDATE_ACCOUNT dispatches to the
    // real Redux state array, but the selector never sees those changes — it reads flexCache.
    // This causes balance to appear unchanged (still 150 BTC), operations to stay empty,
    // and the "View Details" drawer to receive null operation → blank/black screen.
    // We must write the update into flexCache directly so subsequent selector calls
    // return the freshest data.
    if (isFlexBuild() && flexCache) {
      flexCache = flexCache.map(existingAccount => {
        if (existingAccount.id !== accountId) return existingAccount;
        const result = updater(existingAccount);
        // Detect newly added OUT operations and deduct balance + fee
        const oldPendingIds = new Set(
          (existingAccount.pendingOperations || []).map((o: any) => o.id),
        );
        const newOps = ((result as any).pendingOperations || []).filter(
          (op: any) => !oldPendingIds.has(op.id),
        );
        for (const op of newOps) {
          if (op.type === "OUT") {
            const deduction = (
              op.value instanceof BigNumber ? op.value : new BigNumber(op.value || 0)
            ).plus(op.fee instanceof BigNumber ? op.fee : new BigNumber(op.fee || 0));
            (result as any).balance = (result as any).balance.minus(deduction);
            (result as any).spendableBalance = (result as any).spendableBalance.minus(deduction);
            const currencyId = (result as any).currency?.id;
            if (currencyId) deductFromServerBalance(currencyId, op.value, op.fee);
          }
        }
        // Promote pendingOperations → operations (no real blockchain to wait for in Flex demo)
        // This prevents the "Some transactions are not confirmed yet" warning
        const allPending = (result as any).pendingOperations || [];
        if (allPending.length > 0) {
          const existingOpIds = new Set(((result as any).operations || []).map((o: any) => o.id));
          const toPromote = allPending.filter((op: any) => !existingOpIds.has(op.id));
          if (toPromote.length > 0) {
            (result as any).operations = [...toPromote, ...((result as any).operations || [])];
            (result as any).pendingOperations = [];
          }
        }
        persistFakeOperations(
          result.id,
          (result as any).operations || [],
          (result as any).pendingOperations || [],
        );
        return sanitizeAccount(result);
      });
    }
    return state.map(existingAccount => {
      if (existingAccount.id !== accountId) {
        return existingAccount;
      }
      return updater(existingAccount);
    });
  },
  REMOVE_ACCOUNT: (state, { payload: account }) => state.filter(acc => acc.id !== account.id),
  REPLACE_ACCOUNTS: (state, { payload }) => payload,
};

export default handleActions<AccountsState, HandlersPayloads[keyof HandlersPayloads]>(
  handlers as AccountsHandlers<false>,
  state,
);

// Selectors
// LRU-like cache for flex accounts to prevent infinite re-renders
let flexCache: Account[] | null | undefined;
let lastFlexDemoSwapsHash: string | null = null;

/** Clear the flexCache so the next accountsSelector call rebuilds accounts from scratch.
 * Called when the admin panel pushes updated balances. */
export function clearFlexCache(): void {
  flexCache = null;
  // Also clear the reference cache so the selector doesn't return stale data
  lastAccountsRef = null;
  lastSanitizedResult = null;
  sanitizeCache.clear();
  // FLEX_DEMO: Reset swaps hash so accountsSelector re-reads localStorage
  lastFlexDemoSwapsHash = null;
}

// Per-account sanitization cache — prevents creating new objects when the
// source account reference hasn't changed. Keyed by accountId.
const sanitizeCache = new Map<string, { source: unknown; sanitized: Account }>();

// Reference cache for the final array result — if the input `accounts` array
// reference hasn't changed, we return the exact same output array reference.
// This prevents useSelector from triggering re-renders when unrelated Redux
// state changes (e.g. setLastSeenDeviceInfo dispatching to settings slice).
let lastAccountsRef: Account[] | null = null;
let lastSanitizedResult: Account[] | null = null;

function sanitizeAccount(acc: any): Account {
  // Return cached sanitized version if the source account reference is the same
  const cached = sanitizeCache.get(acc.id);
  if (cached && cached.source === acc) {
    return cached.sanitized;
  }

  const sanitized = { ...acc, syncError: null, isSyncing: false, lastSyncDate: new Date() };
  Object.defineProperty(sanitized, "syncError", { get: () => null, set: () => {} });
  Object.defineProperty(sanitized, "isSyncing", { get: () => false, set: () => {} });
  // In FLEX_DEMO mode, ensure all operations appear confirmed.
  // Operations added later (e.g. from mock sends) won't go through
  // fakeFlexBuild's ensureOpConfirmed, so we patch them here.
  if (isFlexBuild()) {
    // Clone operations before patching. Some ops (e.g. the broadcast result of
    // the fake bridge) are read-only/frozen; mutating them in place throws
    // "Cannot assign to read only property 'confirmations'" inside the
    // UPDATE_ACCOUNT reducer, which aborts finishWithSuccess and leaves the
    // Send flow stuck on the gray "Signing transaction..." spinner forever.
    sanitized.blockHeight = 99999999;

    // In FLEX there is no real blockchain, so every operation must look
    // confirmed. isConfirmedOperation(op, account, nb) computes
    // account.blockHeight - op.blockHeight + 1 >= nb. Patching the operation's
    // blockHeight to the same value as the account's (99999999) yields exactly
    // 1 confirmation, which is below every currency threshold (BTC=3, ETH≈139),
    // so the mvvm History tags the operation as pending and shows it under
    // "Pending transactions". Put operations well below the fake chain tip so
    // the confirmation count exceeds any threshold and they stay in the
    // regular, confirmed history.
    const ops = (sanitized.operations || []).map((op: any) => ({ ...op }));
    for (const op of ops) {
      // Covers operations with no blockHeight (broadcast results) and any that
      // were pre-seeded at the fake tip itself (e.g. shuffle ops) — both would
      // otherwise compute a confirmation count below every currency threshold.
      if (!op.blockHeight || op.blockHeight >= sanitized.blockHeight) {
        op.blockHeight = sanitized.blockHeight - 1000000;
      }
      if (!op.confirmations || op.confirmations < 99999) op.confirmations = 99999;
      if (op.status !== "confirmed") op.status = "confirmed";
    }
    sanitized.operations = ops;

    const pending = (sanitized.pendingOperations || []).map((op: any) => ({ ...op }));
    for (const op of pending) {
      if (!op.blockHeight || op.blockHeight >= sanitized.blockHeight) {
        op.blockHeight = sanitized.blockHeight - 1000000;
      }
      if (!op.confirmations || op.confirmations < 99999) op.confirmations = 99999;
      if (op.status !== "confirmed") op.status = "confirmed";
    }
    sanitized.pendingOperations = pending;
  }

  // Cache the result so future calls with the same source reference are stable
  sanitizeCache.set(acc.id, { source: acc, sanitized });

  return sanitized;
}

export const accountsSelector = (state: { accounts: AccountsState }): Account[] => {
  const envFlex = isFlexBuild();
  if (envFlex) {
    // FLEX_DEMO: Check if localStorage mock swaps have changed to invalidate cache
    const currentSwapsHash = getFlexDemoSwapsHash();
    if (flexCache && lastFlexDemoSwapsHash === currentSwapsHash) {
      return flexCache;
    }
    lastFlexDemoSwapsHash = currentSwapsHash;

    // IMPORTANT: never perform synchronous IPC (sendSync) inside a selector.
    // Selectors run during React's render phase; doing sendSync here triggers
    // "Minified React error #300" (component suspended while rendering / cannot
    // update a component while rendering another). Balances are already fetched
    // at the right moments (boot via preloadAllAccounts, and on every admin
    // push via events.ts → initServerBalances()), so the cache is already
    // populated when we get here. If it isn't, fall back to an empty list and
    // let the next push fill it in.
    const rawAccounts = getFakeAccounts();
    // FLEX_DEMO: Apply mock swap spoofing to each account — adjusts balances
    // and injects swapHistory/operations so the UI renders them natively
    flexCache = rawAccounts.map(a => applyMockSwapSpoof(sanitizeAccount(a)));
    return flexCache;
  }
  flexCache = null;

  // Reference stability: if the Redux accounts array hasn't changed (same
  // reference), return the previously computed sanitized array. This breaks
  // the infinite loop where an unrelated Redux dispatch (e.g.
  // setLastSeenDeviceInfo) triggers accountsSelector → new array →
  // useSelector re-render → effect → dispatch → repeat.
  if (lastAccountsRef === state.accounts && lastSanitizedResult) {
    return lastSanitizedResult;
  }

  lastAccountsRef = state.accounts;
  lastSanitizedResult = state.accounts.map(sanitizeAccount);
  return lastSanitizedResult;
};

// NB some components don't need to refresh every time an account is updated, usually it's only
// when the balance/name/length/starred/swapHistory of accounts changes.
const accountHash = (a: AccountLike) => {
  const baseHash = `${a.id}-${a.balance.toString()}-swapHistory(${a.swapHistory?.length || "0"})`;
  // Include pendingOperations.length AND operations.length in the hash so that newly
  // broadcasted transactions (added via addPendingOperation or the StepConnectDevice
  // mock dispatch) force the memoized lruMemoize selector to invalidate its cache.
  // Without this, the hash stays unchanged after a send, so lruMemoize returns stale data —
  // balance appears unchanged (still 150 BTC), history is empty, and "View Details" opens
  // a blank operation drawer.
  const opsCount = a.type === "Account" ? a.operations?.length ?? 0 : 0;
  const pendingOpsCount = a.type === "Account" ? a.pendingOperations?.length ?? 0 : 0;
  const baseHashWithOps = `${baseHash}-ops(${opsCount})-pendingOps(${pendingOpsCount})`;
  // FLEX_DEMO: Include localStorage mock swaps hash so selectors invalidate
  // when mock swap data changes (e.g., after a mock swap is executed)
  if (isFlexBuild()) {
    const swapsHash = getFlexDemoSwapsHash();
    return `${baseHashWithOps}-flexSwaps(${swapsHash.length})`;
  }
  // Include Canton-specific data in hash to ensure selector detects changes to cantonResources
  // Without this, when Canton accounts are synced and cantonResources is updated (e.g., instrumentUtxoCounts),
  // the selector returns stale data because the hash doesn't change, causing components to miss
  // important Canton-specific data like UTXO counts needed for transaction validation
  // See: libs/coin-modules/coin-canton/src/bridge/sync.ts
  if (a.type === "Account" && a.currency.family === "canton" && "cantonResources" in a) {
    const cantonHash = `-cantonResources(${JSON.stringify(a.cantonResources)})`;
    return baseHashWithOps + cantonHash;
  }
  return baseHashWithOps;
};
const shallowAccountsSelectorCreator = createSelectorCreator(lruMemoize, (a, b) =>
  isEqual(flattenAccounts(a).map(accountHash), flattenAccounts(b).map(accountHash)),
);
export const shallowAccountsSelector = shallowAccountsSelectorCreator(accountsSelector, a => a);

// FIXME we might reboot this idea later!
export const isUpToDateSelector = createSelector(accountsSelector, accounts => {
  const envFlex = isFlexBuild();
  if (envFlex) {
    return accounts.map(a => ({ account: a, isUpToDate: true }));
  }
  return accounts.map(a => ({ account: a, isUpToDate: isUpToDateAccount(a) }));
});

export const hasAccountsSelector = createSelector(
  shallowAccountsSelector,
  accounts => accounts.length > 0,
);
// TODO: FIX RETURN TYPE
export const currenciesSelector = createSelector(shallowAccountsSelector, accounts =>
  [...new Set(flattenAccounts(accounts).map(a => getAccountCurrency(a)))].sort((a, b) =>
    a.name.localeCompare(b.name),
  ),
);

// TODO: FIX RETURN TYPE
export const cryptoCurrenciesSelector = createSelector(shallowAccountsSelector, accounts =>
  [...new Set(accounts.map(a => a.currency))].sort((a, b) => a.name.localeCompare(b.name)),
);
export const accountSelector = createSelector(
  accountsSelector,
  (
    _: State,
    {
      accountId,
    }: {
      accountId: string;
    },
  ) => accountId,
  (accounts, accountId) => accounts.find(a => a.id === accountId),
);

export const starredAccountsSelector = createSelector(
  shallowAccountsSelector,
  walletSelector,
  (accounts, wallet) =>
    flattenAccounts(accounts).filter(a => isStarredAccountSelector(wallet, { accountId: a.id })),
);

export const isUpToDateAccountSelector = createSelector(accountSelector, isUpToDateAccount);

export const flattenAccountsSelector = createSelector(accountsSelector, flattenAccounts);
