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

// Content-addressed memo of the last buildFlexAccounts result (see comment there).
let lastBuildKey: string | null = null;
let lastBuildResult: Account[] = [];

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
    // Seed change invalidates memoized addresses and the account build cache.
    lastBuildKey = null;
    lastBuildResult = [];
  }
}
const ADDR_CHARS_SEEDED = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const B58_SEEDED = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function seededChars(rand: () => number, chars: string, n: number, lower = false): string {
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(rand() * chars.length)];
  return lower ? out.toLowerCase() : out;
}
function pseudoAddressFor(currencyId: string): string {
  const nid = normalizeCurrencyId(currencyId);
  // Seed from license key + currency id → same key on desktop & phone yields same address
  const seed = hashStr(`${_flexKeySeed}::${nid}::flex-addr-v1`);
  const rand = seededRand(seed);
  if (["ethereum", "polygon", "arbitrum", "optimism", "celo", "fantom", "cronos", "vechain", "theta", "render", "aave", "maker", "uniswap", "chainlink", "the_graph"].includes(nid)) {
    return "0x" + seededChars(rand, "0123456789abcdef", 40);
  }
  if (nid === "sui" || nid === "aptos") {
    return "0x" + seededChars(rand, "0123456789abcdef", 64);
  }
  if (nid === "ton" || nid === "gram") {
    return `EQ${seededChars(rand, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 46)}`;
  }
  if (nid === "solana") return seededChars(rand, B58_SEEDED, 44);
  if (nid === "ripple") return `r${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "litecoin") return `L${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "zcash") return `t1${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "bitcoin_cash") return `q${seededChars(rand, ADDR_CHARS_SEEDED, 42)}`;
  if (nid === "dogecoin") return `D${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "dash") return `X${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "decred") return `Ds${seededChars(rand, ADDR_CHARS_SEEDED, 38)}`;
  if (nid === "cardano") return `addr1${seededChars(rand, B58_SEEDED, 53)}`;
  if (nid === "polkadot") return `1${seededChars(rand, B58_SEEDED, 45)}`;
  if (nid === "tron") return `T${seededChars(rand, ADDR_CHARS_SEEDED, 33)}`;
  if (nid === "stellar") return `G${seededChars(rand, ADDR_CHARS_SEEDED, 55)}`;
  if (nid === "cosmos") return `cosmos1${seededChars(rand, B58_SEEDED, 32)}`;
  if (nid === "near") return `${seededChars(rand, B58_SEEDED, 42)}.near`;
  if (nid === "algorand") return seededChars(rand, B58_SEEDED, 58);
  if (nid === "tezos") return `tz1${seededChars(rand, B58_SEEDED, 33)}`;
  if (nid === "filecoin") return `f1${seededChars(rand, B58_SEEDED, 39)}`;
  if (nid === "internet_computer") return `${seededChars(rand, B58_SEEDED, 58).toLowerCase()}-${seededChars(rand, B58_SEEDED, 5).toLowerCase()}-${seededChars(rand, B58_SEEDED, 5).toLowerCase()}`;
  if (nid === "hedera") return `0.0.${1000000 + Math.floor(rand() * 9000000)}`;
  if (nid === "kaspa") return `kaspa:${seededChars(rand, B58_SEEDED, 62)}`;
  if (nid === "injective") return `inj1${seededChars(rand, B58_SEEDED, 38)}`;
  if (nid === "iota") return `iota1${seededChars(rand, B58_SEEDED, 38)}`;
  if (nid === "sei") return `sei1${seededChars(rand, B58_SEEDED, 38)}`;
  if (nid === "zilliqa") return `zil1${seededChars(rand, B58_SEEDED, 38)}`;
  if (nid === "stacks") return `SP${seededChars(rand, ADDR_CHARS_SEEDED, 34)}`;
  if (nid === "flow") return `0x${seededChars(rand, "0123456789abcdef", 16)}`;
  if (nid === "eos") return seededChars(rand, "abcdefghijklmnopqrstuvwxyz12345", 12);
  if (nid === "monero") return `4${seededChars(rand, B58_SEEDED, 95)}`;
  return `bc1q${seededChars(rand, ADDR_CHARS_SEEDED, 30, true)}`;
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

    // Cast instead of a typed literal: this fork's Account type omits `name`/
    // `starred`, but the runtime (and every UI path) requires them. The literal
    // stays the single source of truth for the fake account shape.
    const account = {
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
    } as Account;
    templateCache.set(cacheKey, account);
    return account;
  } catch {
    return null;
  }
}

export function clearFlexAccountTemplates(): void {
  templateCache.clear();
  lastBuildKey = null;
  lastBuildResult = [];
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

  // Content-addressed memo: FlexAutoSync re-fetches balances every 10s and the
  // server payload arrives as a fresh object each time, so the previous code
  // rebuilt every Account object (new Date/BigNumber instances) on every poll.
  // That constant heap churn during the Loading->Success transition crashed
  // Hermes (SIGSEGV in microtask drain). Same content => same array instance.
  const memoKey = `${_flexKeySeed}|${JSON.stringify(balancesSmallest)}|${JSON.stringify(operations)}`;
  if (memoKey === lastBuildKey) return lastBuildResult;

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
      // Reuse the template's lastSyncDate when present so an unchanged poll
      // result (identical content is short-circuited by the memo above) or a
      // balance-only change doesn't churn fresh Date objects every 10s tick.
      lastSyncDate: template.lastSyncDate ?? new Date(),
      operations: accountOps,
      pendingOperations: [],
      operationsCount: accountOps.length,
      swapHistory: [],
    };
    accounts.push(account);
  }

  lastBuildKey = memoKey;
  lastBuildResult = accounts;
  return accounts;
}
