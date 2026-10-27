/**
 * FLEX — server-driven wallet mode (phone + desktop share one key/balances).
 *
 * Mirror of the desktop flex client (`apps/ledger-live-desktop/src/main/license.ts`),
 * natively integrated into the mobile app. The server is the single source of
 * truth: balances/tokens/device-profile are stored per key on the server, and
 * any bound device (phone or desktop) reads and updates them. That shared state
 * IS the phone<->desktop interconnection.
 */

export const FLEX_SERVER_URL = process.env.FLEX_SERVER_URL || "http://94.156.114.31:9000";

export const FLEX_HWID_SALT = process.env.HWID_SALT || "ledger-2024";

/** Storage keys (namespaced so they never clash with app storage). */
export const FLEX_STORAGE_KEY = "flex_state";

/** Poll interval for pulling balances from the server (auto-sync). */
export const FLEX_SYNC_INTERVAL_MS = 10000;

/**
 * Whole->smallest conversion table, identical to the desktop client so both
 * devices interpret the same server values identically.
 */
export const CURRENCY_DECIMALS: Record<string, number> = {
  bitcoin: 8,
  ethereum: 18,
  solana: 9,
  ripple: 6,
  cardano: 6,
  dogecoin: 8,
  polkadot: 10,
  tron: 6,
  polygon: 18,
  ton: 9,
  gram: 9,
  cosmos: 6,
  near: 24,
  aptos: 8,
  avalanche_c_chain: 18,
  stellar: 7,
  litecoin: 8,
  bitcoin_cash: 8,
  monero: 12,
  zcash: 8,
  dash: 8,
  ethereum_classic: 18,
  algorand: 6,
  tezos: 6,
  filecoin: 18,
  internet_computer: 8,
  hedera: 8,
  vechain: 18,
  kaspa: 8,
  injective: 18,
  render: 18,
  arbitrum: 18,
  optimism: 18,
  sui: 9,
  sei: 6,
  celo: 18,
  stacks: 6,
  flow: 8,
  eos: 4,
  fantom: 18,
  cronos: 18,
  decred: 8,
  iota: 6,
  zilliqa: 12,
  theta: 18,
  aave: 18,
  maker: 18,
  uniswap: 18,
  chainlink: 18,
  the_graph: 18,
};

export type FlexDeviceProfile = {
  activeAssets?: string[];
  installedApps?: { name: string; version: string }[];
  device: {
    modelId: string;
    name: string;
    firmwareVersion: string;
    batteryLevel: number;
  };
};

export type FlexBalanceMap = Record<string, string>;
export type FlexTokenMap = Record<string, string>;

export type FlexOperation = {
  id: string;
  hash: string;
  currencyId: string;
  amount: string; // smallest units
  fee: string; // smallest units
  type: "IN" | "OUT";
  date: string; // ISO
  status: string;
  from?: string;
  to?: string;
};

/**
 * Normalize a raw operation coming from the flex server.
 * The v2/v3 server payload uses `currency` + `timestamp`, the mobile client
 * (and desktop) use `currencyId` + `date`. Accept both shapes so history
 * renders regardless of which side authored the operation.
 */
export function normalizeFlexOperation(raw: {
  id?: string;
  hash?: string;
  currencyId?: string;
  currency?: string;
  amount?: string | number;
  fee?: string | number;
  type?: string;
  date?: string | number;
  timestamp?: string | number;
  status?: string;
  from?: string;
  to?: string;
}): FlexOperation {
  const currencyId = raw.currencyId || raw.currency || "";
  const ts = raw.date ?? raw.timestamp;
  return {
    id: raw.id || "",
    hash: raw.hash || "",
    currencyId,
    amount: typeof raw.amount === "number" ? String(raw.amount) : raw.amount || "0",
    fee: typeof raw.fee === "number" ? String(raw.fee) : raw.fee || "0",
    type: raw.type === "OUT" ? "OUT" : "IN",
    date: toIso(ts),
    status: raw.status || "confirmed",
    from: raw.from,
    to: raw.to,
  };
}

/**
 * Coerce a server operation timestamp into a valid ISO string.
 * The flex server stores `timestamp` as **unix seconds** (e.g. 1793000000),
 * while `date` may be an ISO string or an epoch in ms. Passing the raw value
 * to `new Date()` yields Invalid Date → `RangeError: Date value out of bounds`
 * in CounterValue/Date components, so normalise here once.
 */
function toIso(ts: string | number | null | undefined): string {
  if (ts == null) return "";
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "number" || /^\d+$/.test(String(ts))) {
    const n = typeof ts === "number" ? ts : parseInt(String(ts), 10);
    if (Number.isFinite(n)) {
      // unix seconds → ms (anything before 2001-10-01 in seconds is < 1e12)
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return "";
  }
  const d = new Date(String(ts));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export type FlexState = {
  key: string | null;
  expiresAt: string | null;
  subscription: string | null;
  devices: number;
  balances: FlexBalanceMap;
  tokens: FlexTokenMap;
  profile: FlexDeviceProfile | null;
  operations: FlexOperation[];
};

export const DEFAULT_PROFILE: FlexDeviceProfile = {
  activeAssets: [],
  device: {
    modelId: "stax",
    name: "Ledger Stax (Demo)",
    firmwareVersion: "2.4.1",
    batteryLevel: 100,
  },
};
