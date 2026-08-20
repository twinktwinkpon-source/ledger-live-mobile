/* ============================================================
   data.js — asset metadata, rates, formatting, seeded data
   ============================================================ */

const CURRENCIES = [
  { id: "bitcoin", name: "Bitcoin", ticker: "BTC", decimals: 8, usdRate: 64230.5, change7d: 2.84, addrPrefix: "bc1q", addrAlphabet: "bc1qrp0xmku6wdzh2p3s8yf52wnvh34jrfgv5tsa7" },
  { id: "ethereum", name: "Ethereum", ticker: "ETH", decimals: 18, usdRate: 3352.1, change7d: -1.62, addrPrefix: "0x", addrAlphabet: "0123456789abcdef" },
  { id: "ton", name: "Toncoin", ticker: "TON", decimals: 9, usdRate: 7.42, change7d: 5.11, addrPrefix: "UQ", addrAlphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" },
  { id: "solana", name: "Solana", ticker: "SOL", decimals: 9, usdRate: 148.9, change7d: 3.37, addrPrefix: "", addrAlphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" },
  { id: "monero", name: "Monero", ticker: "XMR", decimals: 12, usdRate: 158.2, change7d: -0.74, addrPrefix: "4", addrAlphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" },
  { id: "litecoin", name: "Litecoin", ticker: "LTC", decimals: 8, usdRate: 84.6, change7d: 1.28, addrPrefix: "ltc1", addrAlphabet: "bc1qrp0xmku6wdzh2p3s8yf52wnvh34jrfgv5tsa7" },
  { id: "zcash", name: "Zcash", ticker: "ZEC", decimals: 8, usdRate: 27.4, change7d: -2.15, addrPrefix: "t1", addrAlphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" },
];

const CUR_MAP = Object.fromEntries(CURRENCIES.map(c => [c.id, c]));

/* ---------- Seeded PRNG (mulberry32) ---------- */

function seedFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function hashHex(str) {
  // FNV-1a 64-bit → hex string
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function seededFor(key, salt) {
  return seedFrom(hashHex(key + "::" + salt));
}

/* ---------- Address generation (deterministic) ---------- */

function genAddress(key, cur) {
  const rnd = seededFor(key, "addr:" + cur.id);
  const alphabet = cur.addrAlphabet;
  const prefix = cur.addrPrefix;
  const len = cur.id === "ethereum" ? 40 : cur.id === "solana" ? 44 : cur.id === "ton" ? 46 : 42;
  let body = "";
  for (let i = 0; i < len; i++) body += alphabet[Math.floor(rnd() * alphabet.length)];
  return prefix + body;
}

/* ---------- Formatting ---------- */

function fmtAmount(valueUsd, { compact = false } = {}) {
  const v = Number(valueUsd);
  const abs = Math.abs(v);
  if (compact && abs >= 1000) {
    return (abs >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + "M" : (v / 1e3).toFixed(1) + "k");
  }
  if (abs >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs === 0) return "0.00";
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtUsd(v, { compact = false } = {}) {
  return "$" + fmtAmount(v, { compact });
}

function fmtCoin(balanceBase, cur) {
  const v = Number(balanceBase) / Math.pow(10, cur.decimals);
  if (v === 0) return "0 " + cur.ticker;
  const decimals = v >= 1 ? (v >= 1000 ? 2 : 4) : 6;
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals }) + " " + cur.ticker;
}

function fmtCoinShort(v) {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtChange(v) {
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function dayLabel(ts) {
  const now = new Date();
  const d = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function relDate(ts) {
  const now = Date.now();
  const diff = now - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- Chart series (seeded random walk) ---------- */

function chartSeries(key, cur, points = 90) {
  const rnd = seededFor(key, "chart:" + cur.id);
  const target = cur.change7d / 100;
  const start = 100;
  let v = start;
  const out = [];
  const driftPerStep = target / points;
  for (let i = 0; i < points; i++) {
    v += driftPerStep + (rnd() - 0.5) * 0.9;
    out.push(v);
  }
  // normalize so series ends exactly at 100*(1+change)
  const end = 100 * (1 + target);
  const factor = end / out[out.length - 1];
  for (let i = 0; i < out.length; i++) out[i] *= factor;
  return out;
}

function portfolioSeries(key, assets, points = 90) {
  const rnd = seededFor(key, "chart:portfolio");
  const cur = assets.length ? assets.reduce((s, a) => s + a.valueUsd, 0) : 0;
  const out = [];
  let v = cur;
  const drift = rnd() * 0.2 - 0.05;
  for (let i = 0; i < points; i++) {
    v = Math.max(0, v * (1 + drift / points + (rnd() - 0.5) * 0.01));
    out.push(v);
  }
  return out;
}

/* ---------- Operations (seeded) ---------- */

function opDate(daysAgo, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.getTime();
}

function genOperations(key, cur, balanceBase) {
  const rnd = seededFor(key, "ops:" + cur.id);
  const unit = Math.pow(10, cur.decimals);
  const balance = Number(balanceBase) / unit;
  const ops = [];
  const kinds = [
    { type: "receive", label: "Received " + cur.ticker, days: 1, frac: 0.12, hour: 9 },
    { type: "receive", label: "Received " + cur.ticker, days: 1, frac: 0.2, hour: 14 },
    { type: "send", label: "Sent " + cur.ticker, days: 2, frac: 0.06, hour: 18 },
    { type: "receive", label: "Received " + cur.ticker, days: 3, frac: 0.34, hour: 11 },
    { type: "swap", label: "Swapped to " + cur.ticker, days: 5, frac: 0.08, hour: 16 },
    { type: "send", label: "Sent " + cur.ticker, days: 6, frac: 0.03, hour: 21 },
    { type: "receive", label: "Received " + cur.ticker, days: 8, frac: 0.22, hour: 10 },
    { type: "buy", label: "Bought " + cur.ticker, days: 10, frac: 0.4, hour: 13 },
  ];
  for (const k of kinds) {
    if (balance <= 0) break;
    const amt = balance * k.frac * (0.75 + rnd() * 0.5);
    ops.push({
      id: cur.id + "-" + k.days + "-" + k.hour,
      type: k.type,
      label: k.label,
      ts: opDate(k.days, k.hour),
      amount: amt,
      confirmed: rnd() > 0.12,
    });
  }
  ops.sort((a, b) => b.ts - a.ts);
  return ops;
}

/* ---------- Derived wallet state ---------- */

function buildAssets(balances, key) {
  const out = [];
  for (const [id, balanceBase] of Object.entries(balances || {})) {
    const cur = CUR_MAP[id];
    if (!cur) continue;
    const value = Number(balanceBase) / Math.pow(10, cur.decimals);
    out.push({
      id,
      ...cur,
      balanceBase,
      amount: value,
      valueUsd: value * cur.usdRate,
      address: genAddress(key, cur),
      series: chartSeries(key, cur),
    });
  }
  out.sort((a, b) => b.valueUsd - a.valueUsd);
  return out;
}

export {
  CURRENCIES,
  CUR_MAP,
  buildAssets,
  genAddress,
  genOperations,
  portfolioSeries,
  chartSeries,
  fmtAmount,
  fmtUsd,
  fmtCoin,
  fmtCoinShort,
  fmtChange,
  dayLabel,
  relDate,
};
