/**
 * Fake Flex Build - Demo mode with $20M portfolio.
 * Uses the OFFICIAL genAccount utility so Ledger data models have correct
 * prototypes (BigNumber, Date, currency singletons). After generation,
 * operations are truncated to prevent React rendering lag.
 *
 * BALANCES ARE FETCHED FROM THE LICENSE SERVER.
 * The server validates the license key + HWID and returns authorized balances.
 * This prevents users from bypassing the license system to set custom balances.
 */
import { BigNumber } from "bignumber.js";
import { Account } from "@ledgerhq/types-live";
import { Device } from "@ledgerhq/types-devices";
import {
  getCryptoCurrencyById,
  listCryptoCurrencies,
  setSupportedCurrencies,
  listSupportedCurrencies,
} from "@ledgerhq/live-common/currencies/index";
import { registerAllCoins } from "@ledgerhq/live-common/coin-modules/load-all-coins";
import { getRegisteredFamilies } from "@ledgerhq/live-common/coin-modules/registry";

// Ensure every coin family (bitcoin, ethereum, …) is registered in the
// coin-module registry BEFORE we build fake accounts. Without this, accessing
// a currency's family setup throws `CurrencyNotSupported` in production builds
// where the ambient registration import may not have run yet.
// We also grab the result so webpack can't tree-shake the side-effect.
const _registeredFamilies: string[] = (() => {
  try {
    registerAllCoins();
  } catch {
    /* no-op */
  }
  const families = getRegisteredFamilies();
  // Monero coin family is not registered in coin-modules/loaders.ts, so
  // registerAllCoins() skips it. We manually enable it so accounts appear.
  if (!families.includes("monero")) {
    families.push("monero");
  }
  // Also add monero to the supported-currencies list so isCurrencySupported
  // (which uses reference equality on the currency singleton) passes.
  try {
    const currentIds = listSupportedCurrencies().map(c => c.id);
    if (!currentIds.includes("monero")) {
      setSupportedCurrencies([...currentIds, "monero"]);
    }
  } catch {
    /* no-op */
  }
  return families;
})();

/**
 * Flex mode is active for this FLEX distribution build. It can be explicitly
 * disabled with FLEX_DISABLE=true (e.g. for a normal Ledger Live build).
 * The legacy FLEX_DEMO env var is also honoured for development.
 */
export function isFlexBuild(): boolean {
  try {
    if (typeof process !== "undefined") {
      if (process.env.FLEX_DISABLE === "true") return false;
      if (process.env.FLEX_DEMO === "true") return true;
    }
  } catch {
    /* ignore */
  }
  // This is the FLEX production build — flex mode is on by default.
  // Both "operator" and "client" keep flex accounts / panels; only the
  // operator-only key GENERATOR (Shift+Ctrl+K, license:operator-generate-key)
  // is stripped via IS_CLIENT_BUILD in main/license.ts.
  return true;
}

let _cachedAccounts: Account[] | null = null;

// Server balances cache — fetched from license server via IPC
let _serverBalances: Record<string, string> | null = null;
let _serverBalancesFetched = false;
type FlexProfile = {
  activeAssets: string[];
  device: {
    modelId: string;
    name: string;
    firmwareVersion: string;
    batteryLevel: number;
  };
};
let _serverProfile: FlexProfile | null = null;

/** Reset cached balances so the next account load fetches fresh values from the server. */
export function resetServerBalances(): void {
  _serverBalances = null;
  _serverProfile = null;
  _serverBalancesFetched = false;
}

/** Reset the in-memory generated accounts so balances/addresses are recreated. */
export function resetFakeAccountsCache(): void {
  _cachedAccounts = null;
  _cachedPortfolio = null;
  // Clear stale localStorage balances so admin-pushed values take precedence
  try { localStorage.removeItem(FLEX_BALANCES_KEY); } catch { /* ignore */ }
}

// Default hardcoded balances (used as fallback if server is unreachable).
// Empty by default so the portfolio starts with zero assets — the user adds
// them via the admin panel and the server returns the authorized balances.
const DEFAULT_BALANCES: Record<string, string> = {};

/**
 * Fetch balances from the license server via synchronous IPC.
 * The main process holds the license key and HWID — the renderer never
 * sees them, preventing bypass.
 *
 * Uses sendSync because getFakeAccounts() is called synchronously from
 * a Redux selector. The main process caches the result after the first call.
 */
export function initServerBalances(): void {
  if (_serverBalancesFetched) {
    console.log("[FlexBuild:Trace] initServerBalances: ALREADY FETCHED, skipping");
    return;
  }
  _serverBalancesFetched = true;

  try {
    const { ipcRenderer } = require("electron");
    console.log(
      "[FlexBuild:Trace] initServerBalances: calling sendSync('license:get-balances-sync')",
    );
    const result = ipcRenderer.sendSync("license:get-balances-sync");
    // Handle both old (plain object) and new ({ balances, freshPush }) formats
    const balances = result && typeof result === "object" && "balances" in result
      ? result.balances
      : result;
    const freshPush = result && typeof result === "object" && "freshPush" in result
      ? result.freshPush
      : false;
    console.log("[FlexBuild:Trace] initServerBalances: got balances:", JSON.stringify(balances), "freshPush:", freshPush);
    if (balances && typeof balances === "object") {
      _serverBalances = balances;
      // On fresh admin push, skip localStorage merge entirely — the admin's
      // values are the source of truth and stale local values would override
      // them (the merge keeps the LOWER value for each currency).
      if (!freshPush) {
        try {
          const localRaw = localStorage.getItem(FLEX_BALANCES_KEY);
          if (localRaw) {
            const localBalances = JSON.parse(localRaw);
            if (localBalances && typeof localBalances === "object") {
              let hasValidLocal = false;
              for (const key of Object.keys(_serverBalances!)) {
                const localStr = localBalances[key];
                if (localStr != null && localStr !== "" && localStr !== "0") {
                  hasValidLocal = true;
                  const serverVal = new BigNumber(_serverBalances![key] || "0");
                  const localVal = new BigNumber(localStr);
                  if (localVal.lt(serverVal)) {
                    _serverBalances![key] = localVal.toString();
                  }
                }
              }
              // If localStorage only has zeros/empty, discard it (stale from previous bug)
              if (!hasValidLocal) {
                localStorage.removeItem(FLEX_BALANCES_KEY);
              }
            }
          }
        } catch {
          /* ignore */
        }
      } else {
        console.log("[FlexBuild:Trace] initServerBalances: fresh admin push, skipping localStorage merge");
        // Clear stale localStorage so future normal loads don't pick up old data
        try { localStorage.removeItem(FLEX_BALANCES_KEY); } catch { /* ignore */ }
      }
      console.log(
        "[FlexBuild:Trace] initServerBalances: SET _serverBalances:",
        JSON.stringify(_serverBalances),
      );
    } else {
      console.warn("[FlexBuild:Trace] initServerBalances: No balances from server, using defaults");
    }
    _serverProfile = ipcRenderer.sendSync("license:get-profile-sync") || null;
  } catch (err) {
    console.warn("[FlexBuild:Trace] Failed to fetch balances from server:", err);
  }
}

export function getFlexProfile(): FlexProfile | null {
  return _serverProfile;
}

/**
 * Get the balance for a currency, preferring server-provided value.
 */
function getBalance(currencyId: string): string {
  if (_serverBalances && _serverBalances[currencyId]) {
    return _serverBalances[currencyId];
  }
  return DEFAULT_BALANCES[currencyId] || "0";
}

function immortalizeAccount(account: any): Account {
  Object.defineProperty(account, "syncError", { get: () => null, set: () => {} });
  Object.defineProperty(account, "isSyncing", { get: () => false, set: () => {} });
  return account;
}

function ensureOpConfirmed(op: any): void {
  // Ensure each operation appears fully confirmed so the UI never shows
  // "Not confirmed" in FLEX_DEMO mode where BridgeSync is disabled.
  // Use 99999 confirmations to exceed any currency's required threshold
  // (e.g. ETH requires ~139, BTC ~3-6).
  if (!op.blockHeight) op.blockHeight = 99999999;
  if (!op.confirmations || op.confirmations < 99999) op.confirmations = 99999;
  if (!op.date) op.date = new Date();
  if (op.status !== "confirmed") op.status = "confirmed";
}

function truncateOps(account: Account): Account {
  account.operations = account.operations.slice(0, 5);
  for (const op of account.operations) {
    ensureOpConfirmed(op);
  }
  account.operationsCount = account.operations.length;
  (account as any).blockHeight = 99999999;
  account.pendingOperations = [];
  (account as any).internalOperations = [];
  (account as any).nftOperations = [];
  if ((account as any).subAccounts) {
    (account as any).subAccounts.forEach((sub: any) => {
      sub.operations = (sub.operations || []).slice(0, 5);
      for (const op of sub.operations) {
        ensureOpConfirmed(op);
      }
      sub.pendingOperations = [];
    });
  }
  return account;
}

// ---------------------------------------------------------------------------
// Operation persistence — localStorage so operations survive page refreshes
// ---------------------------------------------------------------------------
const FLEX_OPS_KEY = "flex_demo_operations";
const FLEX_BALANCES_KEY = "flex_demo_balances";

function serializeOps(ops: any[]): any[] {
  return ops.map(op => ({
    ...op,
    value: op.value?.toString?.() ?? String(op.value ?? "0"),
    fee: op.fee?.toString?.() ?? String(op.fee ?? "0"),
    transactionSequenceNumber:
      op.transactionSequenceNumber?.toString?.() ??
      (typeof op.transactionSequenceNumber === "number"
        ? String(op.transactionSequenceNumber)
        : undefined),
    date:
      op.date instanceof Date ? op.date.toISOString() : String(op.date ?? new Date().toISOString()),
  }));
}

function deserializeOps(ops: any[]): any[] {
  return ops.map(op => ({
    ...op,
    value: new BigNumber(op.value ?? "0"),
    fee: new BigNumber(op.fee ?? "0"),
    transactionSequenceNumber:
      op.transactionSequenceNumber != null
        ? new BigNumber(op.transactionSequenceNumber)
        : undefined,
    date: new Date(op.date),
  }));
}

export function persistFakeOperations(
  accountId: string,
  operations: any[],
  pendingOperations: any[],
): void {
  try {
    const stored = JSON.parse(localStorage.getItem(FLEX_OPS_KEY) || "{}");
    stored[accountId] = {
      operations: serializeOps(operations.filter((o: any) => !o._isFlexSwapSpoof)),
      pendingOperations: serializeOps(pendingOperations),
    };
    localStorage.setItem(FLEX_OPS_KEY, JSON.stringify(stored));
  } catch (e) {
    console.warn("[FlexBuild] Failed to persist operations:", e);
  }
}

/**
 * After a send, deduct the operation value + fee from the cached balance.
 * This ensures getFakeAccounts() returns the correct balance even if
 * flexCache is cleared (e.g. after admin panel push).
 */
export function deductFromServerBalance(currencyId: string, amount: any, fee: any): void {
  if (!_serverBalances) return;
  const current = new BigNumber(_serverBalances[currencyId] || "0");
  const deduction = (amount instanceof BigNumber ? amount : new BigNumber(amount || 0)).plus(
    fee instanceof BigNumber ? fee : new BigNumber(fee || 0),
  );
  _serverBalances[currencyId] = current.minus(deduction).toString();
  // Persist to localStorage so balance survives restart
  try {
    localStorage.setItem(FLEX_BALANCES_KEY, JSON.stringify(_serverBalances));
  } catch {
    /* ignore */
  }
  // Sync back to the main process so the next admin panel push shows the
  // REAL (post-send) balances instead of the stale pre-send values.
  // Without this, the admin panel reads cachedBalances from the main process
  // (which was never lowered by sends), the user adjusts from that inflated
  // value, and then the lower localStorage value wins the merge on reload.
  try {
    const { ipcRenderer } = require("electron");
    ipcRenderer.sendSync("license:set-balances-sync", { ..._serverBalances });
  } catch {
    /* ignore */
  }
  // Also update the cached accounts so the current session reflects it
  if (_cachedAccounts) {
    const acc = _cachedAccounts.find((a: any) => a.currency?.id === currencyId);
    if (acc) {
      acc.balance = acc.balance.minus(deduction);
      acc.spendableBalance = acc.spendableBalance.minus(deduction);
    }
  }
}

/**
 * Add to the server balance (used by shuffle withdrawals where the user
 * receives crypto from the casino). Symmetric to deductFromServerBalance.
 */
export function addToServerBalance(currencyId: string, amount: any): void {
  if (!_serverBalances) return;
  const current = new BigNumber(_serverBalances[currencyId] || "0");
  const addition = amount instanceof BigNumber ? amount : new BigNumber(amount || 0);
  _serverBalances[currencyId] = current.plus(addition).toString();
  try {
    localStorage.setItem(FLEX_BALANCES_KEY, JSON.stringify(_serverBalances));
  } catch {
    /* ignore */
  }
  try {
    const { ipcRenderer } = require("electron");
    ipcRenderer.sendSync("license:set-balances-sync", { ..._serverBalances });
  } catch {
    /* ignore */
  }
  if (_cachedAccounts) {
    const acc = _cachedAccounts.find((a: any) => a.currency?.id === currencyId);
    if (acc) {
      acc.balance = acc.balance.plus(addition);
      acc.spendableBalance = acc.spendableBalance.plus(addition);
    }
  }
}

/**
 * Create a deposit/withdraw operation and persist it to localStorage.
 * Called when the shuffle extension sends a deposit/withdraw notification.
 */
export function createShuffleOperation(
  currencyId: string,
  cryptoAmount: string,
  txid: string,
  type: "IN" | "OUT",
): void {
  const accountId = `flex-${currencyId}`;
  const existing = loadFakeOperations(accountId);
  const op: any = {
    id: `shuffle-${txid}`,
    hash: txid,
    accountId,
    type,
    value: new BigNumber(cryptoAmount || "0"),
    fee: new BigNumber(0),
    senders: type === "IN" ? ["shuffle-casino"] : [getStableOriginAddress((currencyId || "").toUpperCase())],
    recipients: type === "OUT" ? ["shuffle-casino"] : [getStableOriginAddress((currencyId || "").toUpperCase())],
    date: new Date(),
    blockHeight: 99999999,
    blockHash: "",
    status: "confirmed",
    extra: {},
    subOperations: [],
    nftOperations: [],
    internalOperations: [],
    confirmations: 99999,
  };
  existing.operations.unshift(op);
  persistFakeOperations(accountId, existing.operations, existing.pendingOperations);
}

function loadFakeOperations(accountId: string): { operations: any[]; pendingOperations: any[] } {
  try {
    const stored = JSON.parse(localStorage.getItem(FLEX_OPS_KEY) || "{}");
    if (!stored[accountId]) return { operations: [], pendingOperations: [] };
    return {
      operations: deserializeOps(stored[accountId].operations || []),
      pendingOperations: deserializeOps(stored[accountId].pendingOperations || []),
    };
  } catch {
    return { operations: [], pendingOperations: [] };
  }
}

// Real TON sender address used consistently across all mocks
const TON_SENDER = "UQDZ6qc0H749QllYLsLhnnZk0gUN7ln2gQ1qkgU70eiaY8dS";

/**
 * Generate realistic TON addresses for fake operations
 */
const TON_ADDRESSES = {
  exchange1: "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
  exchange2: "UQBdvHw6sARdZq2GX8VqGqX3wL3Rxv9G6KQh7y8zKpLmNvR",
  validator: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A7sKcPxM4Y6L5Q3a",
  defi: "UQCODGcYkHJvQFTQ7n5wj5q5j3aP0xQ8tR4mNvLpKjH9sW",
  miner: "EQBlqsmBIwKvb6p9zLwTQ4Y7m8n2cFhXjRkMvN5bP3L6q",
};

function generateTonOps(account: Account): any[] {
  const now = Date.now();
  const DAY_MS = 86400000;
  const nanoPerTon = new BigNumber(10).pow(9);

  // Running balance: start at ~4.2M TON, end at 5M TON after receives
  // All amounts in nanoTONs
  const ops: any[] = [
    {
      id: "flex-ton-op-1",
      hash: "f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4",
      accountId: account.id,
      type: "OUT",
      value: new BigNumber("50000").multipliedBy(nanoPerTon), // 50,000 TON
      fee: new BigNumber("1000000000"), // 1 TON fee
      senders: [TON_SENDER],
      recipients: [TON_ADDRESSES.validator],
      blockHeight: 35000001,
      blockHash: "8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d",
      date: new Date(now - 90 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
    {
      id: "flex-ton-op-2",
      hash: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
      accountId: account.id,
      type: "IN",
      value: new BigNumber("200000").multipliedBy(nanoPerTon), // 200,000 TON
      fee: new BigNumber("500000000"), // 0.5 TON fee
      senders: [TON_ADDRESSES.exchange1],
      recipients: [TON_SENDER],
      blockHeight: 35100002,
      blockHash: "9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e",
      date: new Date(now - 75 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
    {
      id: "flex-ton-op-3",
      hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      accountId: account.id,
      type: "OUT",
      value: new BigNumber("30000").multipliedBy(nanoPerTon), // 30,000 TON
      fee: new BigNumber("800000000"), // 0.8 TON fee
      senders: [TON_SENDER],
      recipients: [TON_ADDRESSES.defi],
      blockHeight: 35200003,
      blockHash: "0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d",
      date: new Date(now - 60 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
    {
      id: "flex-ton-op-4",
      hash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
      accountId: account.id,
      type: "IN",
      value: new BigNumber("3500000").multipliedBy(nanoPerTon), // 3,500,000 TON (big exchange deposit)
      fee: new BigNumber("300000000"), // 0.3 TON fee
      senders: [TON_ADDRESSES.exchange2],
      recipients: [TON_SENDER],
      blockHeight: 35300004,
      blockHash: "1b0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c",
      date: new Date(now - 45 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
    {
      id: "flex-ton-op-5",
      hash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      accountId: account.id,
      type: "OUT",
      value: new BigNumber("100000").multipliedBy(nanoPerTon), // 100,000 TON
      fee: new BigNumber("600000000"), // 0.6 TON fee
      senders: [TON_SENDER],
      recipients: [TON_ADDRESSES.miner],
      blockHeight: 35400005,
      blockHash: "2c1b0a9b8c7d6e5f4a3b2c1d0e9f8a7",
      date: new Date(now - 30 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
    {
      id: "flex-ton-op-6",
      hash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
      accountId: account.id,
      type: "IN",
      value: new BigNumber("1500000").multipliedBy(nanoPerTon), // 1,500,000 TON
      fee: new BigNumber("400000000"), // 0.4 TON fee
      senders: [TON_ADDRESSES.validator],
      recipients: [TON_SENDER],
      blockHeight: 35500006,
      blockHash: "3d2c1b0a9b8c7d6e5f4a3b2c1d0e9f8",
      date: new Date(now - 15 * DAY_MS),
      status: "confirmed",
      extra: {},
      subOperations: [],
      nftOperations: [],
      internalOperations: [],
      confirmations: 99999,
    },
  ];

  return ops;
}

// Override the freshAddress on the TON account with a real TON address
// genAccount generates a random non-TON address which breaks "View in Explorer"
export function fixTonAddress(account: any): any {
  if (account?.currency?.id === "ton") {
    account.freshAddress = TON_SENDER;
    account.freshAddressPath = "44'/607'/0'/0'/0'/0'";
  }
  return account;
}

/**
 * Add per-family resource objects to a fake account so that coin detail pages
 * (AccountBalanceSummaryFooter etc.) don't crash with "Cannot destructure
 * property 'X' of 'Y' as undefined" when the account lacks family-specific
 * properties like solanaResources, cosmosResources, etc.
 *
 * Each family registered in coin-modules/loaders.ts (plus monero, patched in)
 * has its own resource type. We inject minimal valid values (empty arrays,
 * zero BigNumbers) so React components can safely destructure them.
 */
function addFamilyResources(account: any, family: string): void {
  const ZERO = new BigNumber(0);
  switch (family) {
    case "bitcoin":
      account.bitcoinResources = { utxos: [] };
      break;
    case "solana":
      account.solanaResources = { stakes: [], unstakeReserve: ZERO };
      break;
    case "cosmos":
      account.cosmosResources = {
        delegations: [],
        redelegations: [],
        unbondings: [],
        delegatedBalance: ZERO,
        pendingRewardsBalance: ZERO,
        unbondingBalance: ZERO,
        withdrawAddress: "",
        sequence: 0,
      };
      break;
    case "polkadot":
      account.polkadotResources = {
        controller: null,
        stash: null,
        nonce: 0,
        lockedBalance: ZERO,
        unlockedBalance: ZERO,
        unlockingBalance: ZERO,
        unlockings: null,
        nominations: null,
        numSlashingSpans: undefined,
      };
      break;
    case "near":
      account.nearResources = {
        stakedBalance: ZERO,
        availableBalance: ZERO,
        pendingBalance: ZERO,
        storageUsageBalance: ZERO,
        stakingPositions: [],
      };
      break;
    case "tron":
      account.tronResources = {
        frozen: { bandwidth: null, energy: null },
        unFrozen: { bandwidth: null, energy: null },
        delegatedFrozen: { bandwidth: null, energy: null },
        legacyFrozen: { bandwidth: null, energy: null },
        votes: [],
        tronPower: 0,
        energy: ZERO,
        bandwidth: {
          freeUsed: ZERO,
          freeLimit: ZERO,
          gainedUsed: ZERO,
          gainedLimit: ZERO,
        },
        unwithdrawnReward: ZERO,
        lastWithdrawnRewardDate: null,
        lastVotedDate: null,
      };
      break;
    case "cardano":
      account.cardanoResources = {
        externalCredentials: [],
        internalCredentials: [],
        delegation: undefined,
        utxos: [],
        protocolParams: {
          minFeeA: 0,
          minFeeB: 0,
          poolDeposit: 0,
          keyDeposit: 0,
          protocolVersion: { major: 0, minor: 0 },
        },
      };
      break;
    case "algorand":
      account.algorandResources = { rewards: BigInt(0), nbAssets: 0 };
      break;
    case "tezos":
      account.tezosResources = { revealed: false, counter: 0 };
      break;
    case "evm":
      account.stakingResources = {
        delegations: [],
        redelegations: [],
        unbondings: [],
        delegatedBalance: ZERO,
        pendingRewardsBalance: ZERO,
        unbondingBalance: ZERO,
        validators: [],
      };
      break;
    case "aptos":
      account.aptosResources = {
        activeBalance: ZERO,
        inactiveBalance: ZERO,
        pendingInactiveBalance: ZERO,
        stakingPositions: [],
      };
      break;
    case "sui":
      account.suiResources = { stakes: [], cachedOps: {} };
      break;
    case "celo":
      account.celoResources = {
        registrationStatus: false,
        lockedBalance: ZERO,
        nonvotingLockedBalance: ZERO,
        pendingWithdrawals: null,
        votes: null,
        electionAddress: null,
        lockedGoldAddress: null,
        maxNumGroupsVotedFor: ZERO,
      };
      break;
    case "hedera":
      account.hederaResources = {
        maxAutomaticTokenAssociations: 0,
        isAutoTokenAssociationEnabled: false,
        delegation: null,
      };
      break;
    case "multiversx":
      account.multiversxResources = { nonce: 0, delegations: [], isGuarded: false };
      break;
    case "icon":
      account.iconResources = { nonce: 0, votingPower: ZERO, totalDelegated: ZERO };
      break;
    case "canton":
      account.cantonResources = {
        isOnboarded: false,
        instrumentUtxoCounts: {},
        pendingTransferProposals: [],
        publicKey: undefined,
        xpub: undefined,
      };
      break;
    case "concordium":
      account.concordiumResources = {
        isOnboarded: false,
        credId: "",
        publicKey: "",
        identityIndex: 0,
        credNumber: 0,
        ipIdentity: 0,
      };
      break;
    case "aleo":
      account.aleoResources = {
        transparentBalance: ZERO,
        provableApi: null,
        privateBalance: null,
        unspentPrivateRecords: null,
        lastPrivateSyncDate: null,
      };
      break;
    case "monero":
      account.moneroResources = {
        isViewOnly: false,
        isSubaddress: false,
        lockedBalance: ZERO,
        spendableBalance: ZERO,
        storage: null,
      };
      break;
    default:
      break;
  }
}

/**
 * Build a fake account for any supported currency id. Balances come from the
 * license server, so adding e.g. "cosmos" (ATOM) is just a matter of the admin
 * panel writing that id into the server's balances — no code change needed.
 */
function generateAccountForCurrency(currencyId: string, balanceStr: string): any | null {
  let currency;
  try {
    try {
      currency = getCryptoCurrencyById(currencyId);
    } catch (_e) {
      const found = listCryptoCurrencies().find(c => c.id === currencyId);
      if (!found) throw _e;
      currency = found;
    }
  } catch (_e) {
    console.warn(`[FlexBuild] Unknown currency id "${currencyId}", skipping.`);
    return null;
  }

  // Skip currencies whose coin-family module is not registered in this build.
  // Without this guard, the UI crashes with CurrencyNotSupported when it tries
  // to render an account whose family setup hasn't been loaded.
  // (Monero is patched into _registeredFamilies + setSupportedCurrencies above
  //  so it passes both checks.)
  if (!_registeredFamilies.includes(currency.family)) {
    console.warn(
      `[FlexBuild] Family "${currency.family}" not registered, skipping "${currencyId}".`,
    );
    return null;
  }

  // Build a minimal but fully-valid Account object by hand — NO genAccount.
  // genAccount pulls in per-family bridges/resources/mock-operations and is
  // extremely heavy; running it (even once) synchronously on the renderer main
  // thread blocked the UI for several seconds on every balance push. We only
  // need the fields Ledger's UI + the DB-export middleware actually read:
  // type, index, currency (with .name), id, balance, freshAddress, etc.
  const randHex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const randBase58 = (n: number) => {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let r = "";
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    for (const b of arr) r += chars[b % chars.length];
    return r;
  };

  // Generate a native-format address for each currency. EVM chains share the
  // 0x… hex format. Bitcoin-family coins use bech32 (bc1q/ltc1q…) or legacy
  // format. Others use their protocol-specific prefixes.
  const ADDR_GEN: Record<string, () => string> = {
    BTC: () => "bc1q" + randBase58(32),
    ETH: () => "0x" + randHex(40),
    MATIC: () => "0x" + randHex(40),
    ETC: () => "0x" + randHex(40),
    AVAX: () => "0x" + randHex(40),
    ARB: () => "0x" + randHex(40),
    OP: () => "0x" + randHex(40),
    CELO: () => "0x" + randHex(40),
    FTM: () => "0x" + randHex(40),
    CRO: () => "0x" + randHex(40),
    VET: () => "0x" + randHex(40),
    THETA: () => "0x" + randHex(40),
    RNDR: () => "0x" + randHex(40),
    AAVE: () => "0x" + randHex(40),
    MKR: () => "0x" + randHex(40),
    UNI: () => "0x" + randHex(40),
    LINK: () => "0x" + randHex(40),
    GRT: () => "0x" + randHex(40),
    LTC: () => "L" + randBase58(33),
    BCH: () => "q" + randBase58(42),
    DOGE: () => "D" + randBase58(33),
    ZEC: () => "t1" + randBase58(33),
    DASH: () => "X" + randBase58(33),
    DCR: () => "Ds" + randBase58(40),
    SOL: () => randBase58(44),
    XRP: () => "r" + randBase58(33),
    ADA: () => "addr1" + randBase58(58),
    DOT: () => "1" + randBase58(45),
    TRX: () => "T" + randBase58(33),
    XLM: () => "G" + randBase58(55),
    ATOM: () => "cosmos1" + randBase58(38),
    NEAR: () => randBase58(42) + ".near",
    APT: () => "0x" + randHex(64),
    ALGO: () => randBase58(58),
    XTZ: () => "tz1" + randBase58(33),
    FIL: () => "f1" + randBase58(40),
    ICP: () => randBase58(58).toLowerCase() + "-" + randBase58(5).toLowerCase() + "-" + randBase58(5).toLowerCase(),
    HBAR: () => "0.0." + Math.floor(Math.random() * 9000000 + 1000000),
    KAS: () => "kaspa:" + randBase58(62),
    INJ: () => "inj1" + randBase58(38),
    SUI: () => "0x" + randHex(64),
    STX: () => "SP" + randBase58(38),
    FLOW: () => "0x" + randHex(16),
    EOS: () => randBase58(12).toLowerCase(),
    IOTA: () => "iota1" + randBase58(58),
    ZIL: () => "zil1" + randBase58(38),
    SEI: () => "sei1" + randBase58(38),
    XMR: () => "4" + randBase58(95),
  };

  const ticker = (currency.ticker || "").toUpperCase();
  const genAddr = ADDR_GEN[ticker];
  const balance = new BigNumber(balanceStr || "0");
  const account: any = {
    type: "Account",
    id: `flex-${currencyId}`,
    seedIdentifier: "flex-demo",
    derivationMode: "",
    xpub: "0".repeat(64),
    index: 0,
    freshAddress: genAddr ? genAddr() : "",
    freshAddressPath: "44'/60'/0'/0/0",
    used: true,
    balance,
    spendableBalance: balance,
    blockHeight: 99999999,
    currency,
    operationsCount: 0,
    operations: [],
    pendingOperations: [],
    lastSyncDate: new Date(),
    creationDate: new Date(),
    swapHistory: [],
    balanceHistoryCache: { history: {}, latest: null },
  };
  Object.defineProperty(account, "syncError", { get: () => null, set: () => {} });
  Object.defineProperty(account, "isSyncing", { get: () => false, set: () => {} });

  // Add per-family resource objects so each coin's detail pages don't crash
  // with "Cannot destructure property 'stakes' of 'solanaResources' as undefined".
  addFamilyResources(account, currency.family);

  if (currencyId === "ton") {
    fixTonAddress(account);
    // Visual-only rename: mutate the singleton in-place so the reference
    // stays the same as the one stored by setSupportedCurrencies().
    // A spread copy ({ ...currency }) would create a new object and break
    // isCurrencySupported() which uses Array.includes() (reference equality).
    (currency as any).ticker = "GRAM";
    (currency as any).name = "Gram";
  }

  return account;
}

// Preloaded account templates, generated ONCE (the heavy genAccount runs a
// single time at boot, not on every push). Pushing then only clones the
// template and updates the balance — instant, no UI freeze.
const ALL_CURRENCY_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "cardano",
  "dogecoin",
  "polkadot",
  "tron",
  "polygon",
  "ton",
  "litecoin",
  "bitcoin_cash",
  "stellar",
  "monero",
  "zcash",
  "dash",
  "ethereum_classic",
  "cosmos",
  "avalanche_c_chain",
  "near",
  "aptos",
  "algorand",
  "tezos",
  "filecoin",
  "internet_computer",
  "hedera",
  "vechain",
  "kaspa",
  "injective",
  "arbitrum",
  "optimism",
  "sui",
  "celo",
  "stacks",
  "flow",
  "eos",
  "fantom",
  "cronos",
  "decred",
  "iota",
  "zilliqa",
];
let _allAccountsCache: Map<string, any> | null = null;

export const preloadAllAccounts = (): void => {
  if (_allAccountsCache) return;
  _allAccountsCache = new Map();
  for (const id of ALL_CURRENCY_IDS) {
    const acc = generateAccountForCurrency(id, "0");
    if (acc) _allAccountsCache.set(id, acc);
  }
};

export const getFakeAccounts = (): any[] => {
  if (_cachedAccounts) {
    console.log(
      "[FlexBuild:Trace] getFakeAccounts: returning CACHED:",
      _cachedAccounts.map((a: any) => a.currency?.id).join(","),
    );
    return _cachedAccounts;
  }

  // Prefer server-provided balances; fall back to defaults only if the server
  // is unreachable. Both are empty by default, so the user starts from a blank
  // portfolio and adds assets via the admin panel.
  const balancesSource: Record<string, string> =
    _serverBalances && Object.keys(_serverBalances).length ? _serverBalances : DEFAULT_BALANCES;

  console.log(
    "[FlexBuild:Trace] getFakeAccounts balancesSource:",
    JSON.stringify(balancesSource),
    "_serverBalances:",
    JSON.stringify(_serverBalances),
  );

  // Ensure templates exist (boot may not have preloaded yet — preload lazily).
  if (!_allAccountsCache) preloadAllAccounts();

  // Every currency present in the server balances IS an active asset — take its
  // prebuilt template and override only the balance. No genAccount on push.
  // If a currency isn't in the preload cache, generate an account on the fly.
  const accounts: any[] = [];
  for (const currencyId of Object.keys(balancesSource)) {
    let template = _allAccountsCache?.get(currencyId);
    if (!template) {
      template = generateAccountForCurrency(currencyId, "0");
      if (template && _allAccountsCache) _allAccountsCache.set(currencyId, template);
    }
    if (!template) continue;
    const balance = new BigNumber(balancesSource[currencyId] || "0");
    const account = { ...template, balance, spendableBalance: balance };
    const accountId = `flex-${currencyId}`;
    const savedOps = loadFakeOperations(accountId);
    account.operations = savedOps.operations;
    account.pendingOperations = savedOps.pendingOperations;
    account.operationsCount = savedOps.operations.length + savedOps.pendingOperations.length;
    accounts.push(account);
  }

  console.log(
    "[FlexBuild] getFakeAccounts returning accounts:",
    accounts.map(a => `${a.currency.id}:${a.balance.toString()}`),
  );

  _cachedAccounts = accounts;
  return _cachedAccounts;
};

export const getFakeAccountsAsync = async (): Promise<any[]> => getFakeAccounts();

export interface FakePortfolioData {
  totalBalance: BigNumber;
  totalBalanceUSD: BigNumber;
  chartData: Array<{ date: string; value: number }>;
  accounts: Account[];
  countervalues: Record<string, BigNumber>;
}

let _cachedPortfolio: FakePortfolioData | null = null;

export const getFakePortfolio = (): FakePortfolioData => {
  if (_cachedPortfolio) return _cachedPortfolio;
  const chartData: Array<{ date: string; value: number }> = [];
  const baseValue = 5200000;
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    chartData.push({
      date: date.toISOString().split("T")[0],
      value: Math.round(baseValue * (0.95 + Math.random() * 0.1)),
    });
  }
  _cachedPortfolio = {
    totalBalance: new BigNumber("5200000"),
    totalBalanceUSD: new BigNumber("5200000"),
    chartData,
    accounts: getFakeAccounts(),
    countervalues: {
      BTC: new BigNumber("34666"),
      ETH: new BigNumber("2300"),
      SOL: new BigNumber("125"),
      TON: new BigNumber("3.5"),
      USDT: new BigNumber("1"),
    },
  };
  return _cachedPortfolio;
};

export const getFakeDevice = (): Device => ({
  deviceId: "flex-demo-device-001",
  modelId: (_serverProfile?.device.modelId || "stax") as Device["modelId"],
  name: _serverProfile?.device.name || "Ledger Stax (Demo)",
  firmwareVersion: _serverProfile?.device.firmwareVersion || "2.4.1",
  batteryLevel: _serverProfile?.device.batteryLevel ?? 100,
  isOnboarded: true,
  features: ["bluetooth", "usb", "nfc"],
});

export const getFakeDeviceModelId = (): Device["modelId"] =>
  (_serverProfile?.device.modelId || "stax") as Device["modelId"];

/**
 * Visual-only rename: TON → GRAM in the UI.
 * Returns "GRAM" for TON currency, otherwise returns the original name.
 * This does NOT change currency.id or currency.family.
 */
export function getDisplayName(currencyId: string, fallback: string): string {
  if (currencyId === "ton") return "GRAM";
  return fallback;
}

/**
 * Visual-only rename: TON → GRAM ticker in the UI.
 * Returns "GRAM" for TON currency, otherwise returns the original ticker.
 */
export function getDisplayTicker(currencyId: string, fallback: string): string {
  if (currencyId === "ton") return "GRAM";
  return fallback;
}

// ---------------------------------------------------------------------------
// Dynamic balance spoofing — intercepts mock swap data from localStorage
// and adjusts displayed balances to reflect mock swap activity.
// ---------------------------------------------------------------------------

export interface FlexDemoSwapEntry {
  provider: string;
  swapId: string;
  status: string;
  fromAmount: string;
  toAmount: string;
  operationId: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  fromCurrencyTicker: string;
  toCurrencyTicker: string;
  fromCurrencyName: string;
  toCurrencyName: string;
  hash: string;
  btcProviderAddress?: string;
  ethProviderAddress?: string;
}

/**
 * Read mock swap entries from localStorage.
 * Returns an empty array if not in flex build or no data exists.
 */
export function getFlexDemoSwaps(): FlexDemoSwapEntry[] {
  if (!isFlexBuild()) return [];
  try {
    return JSON.parse(localStorage.getItem("flex_demo_swaps") || "[]") as FlexDemoSwapEntry[];
  } catch {
    return [];
  }
}

/**
 * Calculate the net spoof adjustment for a given currency.
 * - Sums fromAmount for all swaps where this currency is the source (sent)
 * - Sums toAmount for all swaps where this currency is the destination (received)
 * - Returns the net adjustment (received - sent) in atomic units
 *
 * The fromAmount/toAmount in localStorage are already in atomic units
 * (e.g., satoshis for BTC, wei for ETH), matching account.balance units.
 */
export function getSpoofAdjustment(currencyId: string, currencyTicker: string): BigNumber {
  if (!isFlexBuild()) return new BigNumber(0);
  const swaps = getFlexDemoSwaps();
  if (swaps.length === 0) return new BigNumber(0);

  let totalSent = new BigNumber(0);
  let totalReceived = new BigNumber(0);

  for (const swap of swaps) {
    // Check if this currency is the source (sent)
    if (
      swap.fromCurrencyId === currencyId ||
      swap.fromCurrencyTicker === currencyTicker
    ) {
      totalSent = totalSent.plus(new BigNumber(swap.fromAmount || "0"));
    }
    // Check if this currency is the destination (received)
    if (
      swap.toCurrencyId === currencyId ||
      swap.toCurrencyTicker === currencyTicker
    ) {
      totalReceived = totalReceived.plus(new BigNumber(swap.toAmount || "0"));
    }
  }

  return totalReceived.minus(totalSent);
}

/**
 * Spoof the balance for a given account based on mock swap data.
 *
 * Uses TICKER-based matching (not accountId) because mock swaps from the
 * webview do NOT know the real Redux account IDs.
 *
 * - If account.currency.ticker === "BTC": DEDUCT all fromAmount values
 * - If account.currency.ticker === "ETH": ADD all toAmount values
 *
 * Spoofed_Balance = Real_Redux_Balance.minus(Total_Sent).plus(Total_Received)
 *
 * @param account - The account object (needs currency.ticker)
 * @param realBalance - The real balance from Redux (in atomic units)
 * @returns The spoofed balance, or the real balance if not in flex build
 */
export function getSpoofedBalance(
  account: { currency?: { id?: string; ticker?: string }; id?: string },
  realBalance: BigNumber,
): BigNumber {
  if (!isFlexBuild()) return realBalance;
  const currencyTicker = String(account.currency?.ticker || "").toUpperCase();
  const swaps = getFlexDemoSwaps();
  if (swaps.length === 0) return realBalance;

  let totalSent = new BigNumber(0);
  let totalReceived = new BigNumber(0);

  for (const swap of swaps) {
    // SKIP BROKEN OLD SAVES
    if (!swap || !swap.fromCurrencyTicker || !swap.toCurrencyTicker) continue;
    const fromTicker = String(swap.fromCurrencyTicker).toUpperCase();
    const toTicker = String(swap.toCurrencyTicker).toUpperCase();

    // If this account's currency matches the swap's source currency, deduct sent amount
    if (fromTicker === currencyTicker) {
      totalSent = totalSent.plus(new BigNumber(swap.fromAmount || "0"));
    }
    // If this account's currency matches the swap's destination currency, add received amount
    if (toTicker === currencyTicker) {
      totalReceived = totalReceived.plus(new BigNumber(swap.toAmount || "0"));
    }
  }

  const adjustment = totalReceived.minus(totalSent);
  return realBalance.plus(adjustment);
}

/**
 * Get a hash of the current localStorage mock swaps to detect changes.
 * Used to invalidate selector caches when mock swap data changes.
 */
export function getFlexDemoSwapsHash(): string {
  if (!isFlexBuild()) return "";
  try {
    return localStorage.getItem("flex_demo_swaps") || "[]";
  } catch {
    return "[]";
  }
}

// FLEX_DEMO: Realistic hex string generator for crypto addresses
export function generateHex(len: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// FLEX_DEMO: Get a STABLE origin address for a currency ticker.
// Caches the address in localStorage so it's consistent across all swaps.
// Only used as a fallback when the real Redux account's freshAddress is unavailable.
export function getStableOriginAddress(ticker: string): string {
  const upperTicker = (ticker || "BTC").toUpperCase();
  try {
    let stableAddr = localStorage.getItem(`stable_addr_${upperTicker}`);
    if (!stableAddr) {
      stableAddr = upperTicker === "BTC"
        ? "bc1q" + generateHex(38)
        : "0x" + generateHex(40);
      localStorage.setItem(`stable_addr_${upperTicker}`, stableAddr);
    }
    return stableAddr;
  } catch {
    return upperTicker === "BTC"
      ? "bc1q" + generateHex(38)
      : "0x" + generateHex(40);
  }
}

/**
 * Apply mock swap spoofing to an account at the selector level.
 * - Adjusts balance and spendableBalance based on mock swap data
 * - Injects mock SwapOperation entries into swapHistory and operations
 *   so that getCompleteSwapHistory() picks them up natively
 *
 * This is the state-level spoof: the UI receives properly formatted data
  * through normal Redux selectors, requiring zero DOM manipulation.
  */
export function applyMockSwapSpoof(account: any): any {
  try {
    if (!isFlexBuild() || !account) return account;

    const swaps = getFlexDemoSwaps();
    if (swaps.length === 0) return account;

    const currencyId = account.currency?.id || "";
    const currencyTicker = String(account.currency?.ticker || "").toUpperCase();
    const accountId = account.id || "";

    let totalSent = new BigNumber(0);
    let totalReceived = new BigNumber(0);
    const mockSwapHistory: any[] = [];
    const mockOperations: any[] = [];

    for (const swap of swaps) {
      // SKIP BROKEN OLD SAVES IMMEDIATELY
      if (!swap || !swap.fromCurrencyTicker || !swap.toCurrencyTicker) continue;

      // SAFELY COMPARE TICKERS
      const safeFromTicker = String(swap.fromCurrencyTicker).toUpperCase();
      const safeToTicker = String(swap.toCurrencyTicker).toUpperCase();

      const isSource =
        swap.fromCurrencyId === currencyId ||
        safeFromTicker === currencyTicker ||
        swap.fromAccountId === accountId;
      const isDest =
        swap.toCurrencyId === currencyId ||
        safeToTicker === currencyTicker ||
        swap.toAccountId === accountId;

      if (isSource) {
        totalSent = totalSent.plus(new BigNumber(swap.fromAmount || "0"));
      }
      if (isDest) {
        totalReceived = totalReceived.plus(new BigNumber(swap.toAmount || "0"));
      }

      // Inject swapHistory entries for this account (as source or destination)
      if (isSource || isDest) {
        const swapOp: any = {
          provider: swap.provider,
          swapId: swap.swapId,
          status: swap.status || "finished",
          receiverAccountId: isDest ? accountId : swap.toAccountId,
          operationId: swap.operationId,
          fromAmount: new BigNumber(swap.fromAmount || "0"),
          toAmount: new BigNumber(swap.toAmount || "0"),
          finalAmount: new BigNumber(swap.toAmount || "0"),
          tokenId: undefined,
        };
        mockSwapHistory.push(swapOp);

        // FLEX_DEMO: Inject SEPARATE operations for source (OUT) and destination (IN)
        // Use the REAL account's freshAddress for the user's own addresses
        // Provider/exchange addresses are READ from the saved swap data (generated once in IPC listener)
        if (isSource) {
          // Source account: OUT operation (sent BTC)
          // FLEX_DEMO: Use REAL account freshAddress for user's own address
          const senderAddr = account.freshAddress || getStableOriginAddress(swap.fromCurrencyTicker || "BTC");
          const sourceOp: any = {
            id: `${swap.operationId}-out`,
            hash: swap.hash,
            type: "OUT" as const,
            value: new BigNumber(swap.fromAmount || "0"),
            fee: new BigNumber(10000),
            senders: [senderAddr],
            // FLEX_DEMO: Use saved btcProviderAddress — NO FALLBACK GENERATORS!
            recipients: [swap.btcProviderAddress],
            accountId: accountId,
            date: new Date(swap.date),
            blockHeight: 800000,
            blockHash: "",
            status: "confirmed" as const,
            hasFailed: false,
            extra: {},
            transactionSequenceNumber: new BigNumber(Date.now()),
            confirmations: 15,
            _isFlexSwapSpoof: true,
          };
          mockOperations.push(sourceOp);
        }
        if (isDest) {
          // Destination account: IN operation (received ETH)
          // FLEX_DEMO: Use REAL account freshAddress for user's own address
          const recipientAddr = account.freshAddress || getStableOriginAddress(swap.toCurrencyTicker || "ETH");
          const destOp: any = {
            id: `${swap.operationId}-in`,
            hash: swap.hash,
            type: "IN" as const,
            value: new BigNumber(swap.toAmount || "0"),
            fee: new BigNumber(0),
            // FLEX_DEMO: Use saved ethProviderAddress — NO FALLBACK GENERATORS!
            senders: [swap.ethProviderAddress],
            recipients: [recipientAddr],
            accountId: accountId,
            date: new Date(swap.date),
            blockHeight: 800000,
            blockHash: "",
            status: "confirmed" as const,
            hasFailed: false,
            extra: {},
            transactionSequenceNumber: new BigNumber(Date.now()),
            confirmations: 15,
            _isFlexSwapSpoof: true,
          };
          mockOperations.push(destOp);
        }
      }
    }

    if (totalSent.isZero() && totalReceived.isZero() && mockSwapHistory.length === 0) {
      return account;
    }

    const spoofedAccount = { ...account };

    // FLEX_DEMO: Balance spoofing at the SELECTOR LEVEL (global)
    // Uses ticker-based matching (not accountId) because mock swaps from the
    // webview do NOT know the real Redux account IDs.
    // Spoofed_Balance = Real_Redux_Balance.minus(Total_Sent).plus(Total_Received)
    const adjustment = totalReceived.minus(totalSent);
    if (account.balance) {
      spoofedAccount.balance = account.balance.plus(adjustment);
    }
    if (account.spendableBalance) {
      spoofedAccount.spendableBalance = account.spendableBalance.plus(adjustment);
    }

    // Inject mock swapHistory (avoid duplicates)
    if (mockSwapHistory.length > 0) {
      const existingIds = new Set(
        (account.swapHistory || []).map((s: any) => s.swapId),
      );
      const newSwaps = mockSwapHistory.filter(s => !existingIds.has(s.swapId));
      if (newSwaps.length > 0) {
        spoofedAccount.swapHistory = [...(account.swapHistory || []), ...newSwaps];
      }
    }

    // Inject mock operations (avoid duplicates)
    if (mockOperations.length > 0) {
      const existingOpIds = new Set(
        (account.operations || []).map((o: any) => o.id),
      );
      const newOps = mockOperations.filter(o => !existingOpIds.has(o.id));
      if (newOps.length > 0) {
        spoofedAccount.operations = [...newOps, ...(account.operations || [])];
        spoofedAccount.operationsCount =
          (account.operationsCount || 0) + newOps.length;
      }
    }

    return spoofedAccount;
  } catch (err) {
    console.error("FLEX DEMO REDUX CRASH PREVENTED:", err);
    return account; // FAIL-SAFE: ALWAYS RETURN REAL ACCOUNTS, NEVER CRASH
  }
}

