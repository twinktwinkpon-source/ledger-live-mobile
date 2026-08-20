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

/** Cache one generated account template per currency id (created lazily). */
const templateCache = new Map<string, Account>();

const ADDR_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeCurrencyId(id: string): string {
  if (id === "gram") return "ton";
  return id;
}

function pseudoAddressFor(currencyId: string): string {
  const nid = normalizeCurrencyId(currencyId);
  if (nid === "ethereum" || nid === "polygon" || nid === "arbitrum" || nid === "optimism") {
    const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `0x${hex}`;
  }
  if (nid === "ton" || nid === "gram") {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    return `EQ${Array.from({ length: 46 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
  }
  if (nid === "solana") {
    const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return Array.from({ length: 44 }, () => b58[Math.floor(Math.random() * b58.length)]).join("");
  }
  if (nid === "ripple") return `r${Array.from({ length: 33 }, () => ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)]).join("")}`;
  if (nid === "litecoin") return `L${Array.from({ length: 33 }, () => ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)]).join("")}`;
  if (nid === "bitcoin_cash") return `q${Array.from({ length: 42 }, () => ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)]).join("")}`;
  // default bitcoin style
  return `bc1q${Array.from({ length: 30 }, () => ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)]).join("").toLowerCase()}`;
}

function pseudoAddress(): string {
  return pseudoAddressFor("bitcoin");
}

const EMPTY_HISTORY_CACHE: BalanceHistoryCache = {
  HOUR: { balances: [], latestDate: null },
  DAY: { balances: [], latestDate: null },
  WEEK: { balances: [], latestDate: null },
};

function getTemplate(currencyId: string): Account | null {
  const nid = normalizeCurrencyId(currencyId);
  const cached = templateCache.get(nid);
  if (cached) return cached;
  try {
    let currency;
    try {
      currency = getCryptoCurrencyById(nid);
    } catch {
      return null;
    }
    const supported = listSupportedCurrencies().some(c => c.id === nid);
    if (!supported) return null;
    const id = `flex:${nid}:${uuid()}`;
    const address = pseudoAddressFor(nid);
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
    templateCache.set(nid, account);
    return account;
  } catch {
    return null;
  }
}

export function clearFlexAccountTemplates(): void {
  templateCache.clear();
}

/**
 * Build the account list for the given server balances (smallest units, as stored by the flex server).
 * The server persists satoshi/wei/lamports (see desktop license.ts wholeToSmallest).
 * Previous bug: caller passed smallest but this function treated them as whole and did wholeToSmallest again,
 * doubling the conversion (50 BTC → 5e9 sat → 5e17 sat → displayed as 5_000_000_000 BTC).
 */
export function buildFlexAccounts(balancesSmallest: FlexBalanceMap): Account[] {
  if (!balancesSmallest || typeof balancesSmallest !== "object") return [];
  const accounts: Account[] = [];

  for (const currencyId of Object.keys(balancesSmallest)) {
    const template = getTemplate(currencyId);
    if (!template) continue;
    const raw = balancesSmallest[currencyId] || "0";
    // Guard against non-numeric or astronomically large strings that crash Hermes BigNumber/format
    let balance: BigNumber;
    try {
      balance = new BigNumber(raw);
      if (!balance.isFinite() || balance.isNaN()) balance = new BigNumber(0);
      // Clamp to avoid Hermes mapStringMayAllocate SIGSEGV on 1e21+ strings (already fixed by no double-convert, but keep guard)
      if (balance.abs().gt(new BigNumber("1e30"))) balance = new BigNumber(0);
    } catch {
      balance = new BigNumber(0);
    }
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
