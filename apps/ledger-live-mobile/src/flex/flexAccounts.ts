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
import { FlexBalanceMap, FlexOperation } from "./constants";

/** Cache one generated account template per currency id (created lazily). */
const templateCache = new Map<string, Account>();

const ADDR_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeCurrencyId(id: string): string {
  if (id === "gram") return "ton";
  return id;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seededRand(seed: number): () => number {
  let x = seed || 123456789;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
// Shared flex address seed — MUST match desktop fakeFlexBuild.ts so phone and
// desktop show identical addresses for the same key+currency.
let _flexKeySeed = "";
export function setFlexKeySeed(key: string | null): void {
  const next = key || "";
  if (next !== _flexKeySeed) {
    _flexKeySeed = next;
    templateCache.clear();
  }
}
function pseudoAddressFor(currencyId: string): string {
  const nid = normalizeCurrencyId(currencyId);
  // Seed from license key + currency → same key on desktop & phone yields same address
  const seed = hashStr(`${_flexKeySeed}::${nid}::flex-addr-v1`);
  const rand = seededRand(seed);
  if (nid === "ethereum" || nid === "polygon" || nid === "arbitrum" || nid === "optimism") {
    const hex = Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join("");
    return `0x${hex}`;
  }
  if (nid === "ton" || nid === "gram") {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    return `EQ${Array.from({ length: 46 }, () => chars[Math.floor(rand() * chars.length)]).join("")}`;
  }
  if (nid === "solana") {
    const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return Array.from({ length: 44 }, () => b58[Math.floor(rand() * b58.length)]).join("");
  }
  if (nid === "ripple") return `r${Array.from({ length: 33 }, () => ADDR_CHARS[Math.floor(rand() * ADDR_CHARS.length)]).join("")}`;
  if (nid === "litecoin") return `L${Array.from({ length: 33 }, () => ADDR_CHARS[Math.floor(rand() * ADDR_CHARS.length)]).join("")}`;
  if (nid === "zcash") return `t1${Array.from({ length: 33 }, () => ADDR_CHARS[Math.floor(rand() * ADDR_CHARS.length)]).join("")}`;
  if (nid === "bitcoin_cash") return `q${Array.from({ length: 42 }, () => ADDR_CHARS[Math.floor(rand() * ADDR_CHARS.length)]).join("")}`;
  // default bitcoin style
  return `bc1q${Array.from({ length: 30 }, () => ADDR_CHARS[Math.floor(rand() * ADDR_CHARS.length)]).join("").toLowerCase()}`;
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
  const cacheKey = nid === "ton" ? "gram" : nid;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;
  try {
    let currency;
    try {
      currency = getCryptoCurrencyById(nid);
    } catch {
      return null;
    }
    // GRAM rebrand 2026-06-15: TON → GRAM, display as GRAM (prev. TON) per user request
    if (nid === "ton") {
      currency = { ...currency, ticker: "GRAM", name: "Gram" } as typeof currency;
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
    templateCache.set(cacheKey, account);
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
export function buildFlexAccounts(
  balancesSmallest: FlexBalanceMap,
  operations: FlexOperation[] = [],
): Account[] {
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
    // Build operations for this currency (filtered)
    const nid = normalizeCurrencyId(currencyId);
    const opsForCurrency = operations.filter(op => normalizeCurrencyId(op.currencyId) === nid);
    const accountOps = opsForCurrency.map(op => {
      const isOut = op.type === "OUT";
      return {
        id: op.id,
        hash: op.hash,
        type: isOut ? "OUT" : "IN",
        value: new BigNumber(op.amount),
        fee: new BigNumber(op.fee || "0"),
        blockHeight: 800000,
        blockHash: null,
        accountId: template.id,
        senders: op.from ? [op.from] : [template.freshAddress],
        recipients: op.to ? [op.to] : [op.from || template.freshAddress],
        date: new Date(op.date),
        extra: {},
        hasFailed: false,
        transactionSequenceNumber: undefined,
      } as unknown as Account["operations"][number];
    });
    const account: Account = {
      ...template,
      balance,
      spendableBalance: balance,
      lastSyncDate: new Date(),
      operations: accountOps,
      pendingOperations: [],
      operationsCount: accountOps.length,
      swapHistory: [],
    };
    accounts.push(account);
  }

  return accounts;
}
