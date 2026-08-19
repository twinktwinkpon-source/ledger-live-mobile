/**
 * FLEX account builder — turns server balances into real `Account` objects so
 * the wallet can display them. This is a pure, side-effect-free builder used by
 * the `accounts` selectors overlay: it never touches the store, never reboots
 * the app, and never persists anything. The UI reads the same `Account` shape
 * the app already uses everywhere.
 */
import BigNumber from "bignumber.js";
import { v4 as uuid } from "uuid";
import { Account, BalanceHistoryCache } from "@ledgerhq/types-live";
import {
  getCryptoCurrencyById,
  listSupportedCurrencies,
} from "@ledgerhq/live-common/currencies/index";
import { FlexBalanceMap } from "./constants";
import { wholeToSmallest } from "./server";

/** Cache one generated account template per currency id (created lazily). */
const templateCache = new Map<string, Account>();

const ADDR_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pseudoAddress(): string {
  return `bc1q_${Array.from({ length: 30 }, () =>
    ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)],
  ).join("")}`;
}

const EMPTY_HISTORY_CACHE: BalanceHistoryCache = {
  HOUR: { balances: [], latestDate: null },
  DAY: { balances: [], latestDate: null },
  WEEK: { balances: [], latestDate: null },
};

function getTemplate(currencyId: string): Account | null {
  const cached = templateCache.get(currencyId);
  if (cached) return cached;
  try {
    let currency;
    try {
      currency = getCryptoCurrencyById(currencyId);
    } catch {
      return null;
    }
    const supported = listSupportedCurrencies().some(c => c.id === currencyId);
    if (!supported) return null;
    const id = `flex:${currencyId}:${uuid()}`;
    const address = pseudoAddress();
    const accountName = `${currency.name} 1`;

    const account: Account = {
      type: "Account",
      id,
      seedIdentifier: address,
      derivationMode: "",
      index: 0,
      freshAddress: address,
      freshAddressPath: `44'/${currency.type === "CryptoCurrency" ? (currency as { coinType?: number }).coinType ?? 0 : 0}'/0'/0/0`,
      name: accountName,
      starred: false,
      used: true,
      balance: new BigNumber(0),
      spendableBalance: new BigNumber(0),
      creationDate: new Date(),
      blockHeight: 0,
      currency,
      feesCurrency: undefined,
      operationsCount: 0,
      operations: [],
      pendingOperations: [],
      lastSyncDate: new Date(),
      swapHistory: [],
      balanceHistoryCache: EMPTY_HISTORY_CACHE,
    };
    templateCache.set(currencyId, account);
    return account;
  } catch {
    return null;
  }
}

export function clearFlexAccountTemplates(): void {
  templateCache.clear();
}

/**
 * Build the account list for the given server balances (whole units).
 * Only currencies supported by this build are included.
 */
export function buildFlexAccounts(balancesWhole: FlexBalanceMap): Account[] {
  if (!balancesWhole || typeof balancesWhole !== "object") return [];
  const balancesSmallest = wholeToSmallest(balancesWhole);
  const accounts: Account[] = [];

  for (const currencyId of Object.keys(balancesWhole)) {
    const template = getTemplate(currencyId);
    if (!template) continue;
    const balance = new BigNumber(balancesSmallest[currencyId] || "0");
    const account: Account = {
      ...template,
      balance,
      spendableBalance: balance,
      lastSyncDate: new Date(),
    };
    accounts.push(account);
  }

  return accounts;
}
