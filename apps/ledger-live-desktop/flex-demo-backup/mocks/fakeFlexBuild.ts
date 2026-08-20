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
  return getRegisteredFamilies();
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
    const balances = ipcRenderer.sendSync("license:get-balances-sync");
    console.log("[FlexBuild:Trace] initServerBalances: got balances:", JSON.stringify(balances));
    if (balances && typeof balances === "object") {
      _serverBalances = balances;
      // Merge with localStorage: use the LOWER of server vs local for each currency
      // (local may be lower due to sends during previous sessions)
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
      operations: serializeOps(operations),
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
  // Also update the cached accounts so the current session reflects it
  if (_cachedAccounts) {
    const acc = _cachedAccounts.find((a: any) => a.currency?.id === currencyId);
    if (acc) {
      acc.balance = acc.balance.minus(deduction);
      acc.spendableBalance = acc.spendableBalance.minus(deduction);
    }
  }
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
  const balance = new BigNumber(balanceStr || "0");
  const account: any = {
    type: "Account",
    id: `flex-${currencyId}`,
    seedIdentifier: "flex-demo",
    derivationMode: "",
    xpub: "0".repeat(64),
    index: 0,
    freshAddress: "",
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

  if (currencyId === "ton") {
    fixTonAddress(account);
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
  "cosmos",
  "near",
  "aptos",
  "avalanche_c_chain",
  "stellar",
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
  const accounts: any[] = [];
  for (const currencyId of Object.keys(balancesSource)) {
    const template = _allAccountsCache?.get(currencyId);
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
