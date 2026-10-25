const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PORT = parseInt(process.env.FLEX_PORT || "9000", 10);
const HOST = process.env.FLEX_HOST || "0.0.0.0";
const ADMIN_SECRET = process.env.FLEX_ADMIN_SECRET || (() => {
  // No hardcoded fallback: the secret MUST come from the environment.
  // (An older revision shipped a fallback value here — it has been rotated
  // server-side and is dead. Never commit secrets back into this file.)
  console.warn("[flex-server] FLEX_ADMIN_SECRET is not set — admin endpoints will reject every request.");
  return "";
})();
const HWID_SALT = process.env.HWID_SALT || "ledger-2024";
const ENCRYPT_KEY =
  process.env.FLEX_ENCRYPT_KEY ||
  crypto.createHash("sha256").update("flex-demo-encryption-key").digest("hex").slice(0, 32);

// Resolve the DB next to this script (server/flex_data.sqlite), never the CWD.
// A relative path made the server open/create a DIFFERENT database depending on
// where it was launched from (app root vs server/), which silently lost all keys.
const db = new DatabaseSync(path.join(__dirname, "flex_data.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    hwid_hash TEXT,
    active INTEGER DEFAULT 1,
    subscription TEXT DEFAULT 'pro',
    expires_at TEXT,
    balances_enc TEXT,
    tokens_enc TEXT,
    profile_enc TEXT,
    ton_address TEXT,
    operations_enc TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    activated_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
// Migration: add operations_enc if missing (old DBs)
try { db.exec("ALTER TABLE keys ADD COLUMN operations_enc TEXT"); } catch {}
// Multi-device: one license key can be bound to several devices (desktop + phones).
db.exec(`
  CREATE TABLE IF NOT EXISTS key_devices (
    key TEXT NOT NULL,
    hwid_hash TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (key, hwid_hash)
  )
`);

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3050",
  "file://",
  "null",
];

// Rate limiting: 20 req/min per IP
const rateMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateMap.has(ip)) {
    rateMap.set(ip, []);
  }
  const hits = rateMap.get(ip).filter(t => now - t < 60000);
  if (hits.length >= 20) return false;
  hits.push(now);
  rateMap.set(ip, hits);
  return true;
}

function normalizeHwid(hwid) {
  if (!hwid || typeof hwid !== "string") return "";
  return hwid
    .split("|")
    .map(s => s.trim())
    .join("|")
    .replace(/\s+/g, " ")
    .trim();
}

function hashHwid(hwid) {
  return crypto.createHash("sha256").update(normalizeHwid(hwid) + HWID_SALT).digest("hex");
}

// Returns the set of hwid hashes bound to a key. Backward compatible with the
// legacy single `keys.hwid_hash` column: if there are no rows in key_devices but
// keys.hwid_hash is set, it is treated as the bound device.
function getBoundDevices(key, row) {
  const rows = db.prepare("SELECT hwid_hash FROM key_devices WHERE key = ?").all(key);
  const set = new Set(rows.map(r => r.hwid_hash));
  if (set.size === 0 && row && row.hwid_hash) {
    set.add(row.hwid_hash);
  }
  return set;
}

// Bind a device (hwid hash) to a key. If the key has no devices bound yet and a
// legacy keys.hwid_hash exists, migrate it into key_devices first. Returns true on
// success, or false if the device was already bound ("idempotent").
function bindDevice(key, row, hwidHash) {
  if (!hwidHash) return true;
  // migrate legacy single-hwid
  if (row && row.hwid_hash) {
    db.prepare("INSERT OR IGNORE INTO key_devices (key, hwid_hash) VALUES (?, ?)").run(
      key,
      row.hwid_hash,
    );
  }
  const existing = db.prepare("SELECT 1 FROM key_devices WHERE key = ? AND hwid_hash = ?").get(
    key,
    hwidHash,
  );
  if (!existing) {
    db.prepare("INSERT OR IGNORE INTO key_devices (key, hwid_hash) VALUES (?, ?)").run(
      key,
      hwidHash,
    );
  }
  return true;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPT_KEY, "utf8"), iv);
  let encrypted = cipher.update(JSON.stringify(plaintext), "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decrypt(stored) {
  if (!stored) return null;
  try {
    const [ivHex, tagHex, ciphertext] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPT_KEY, "utf8"), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

function generateKey(adminSecret, hwid, customDays, customBalances, customTokens, profile, tonAddress) {
  if (adminSecret !== ADMIN_SECRET) return { error: "Forbidden: invalid admin secret" };
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randSeg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const payload = `FLEX-${randSeg()}-${randSeg()}`;
  const hmac = crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest("hex").slice(0, 8).toUpperCase();
  const key = `${payload}-${hmac}`;
  const expiresAt = customDays
    ? new Date(Date.now() + customDays * 86400000).toISOString()
    : new Date(Date.now() + 30 * 86400000).toISOString();
  const hwidHash = hwid ? hashHwid(hwid) : null;
  const balancesEnc = customBalances ? encrypt(customBalances) : encrypt({});
  const tokensEnc = customTokens ? encrypt(customTokens) : encrypt({});
  const profileEnc = profile ? encrypt(profile) : encrypt({});
  const opsEnc = encrypt([]);
  db.prepare(`
    INSERT INTO keys (key, hwid_hash, expires_at, balances_enc, tokens_enc, profile_enc, ton_address, operations_enc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, hwidHash, expiresAt, balancesEnc, tokensEnc, profileEnc, tonAddress || null, opsEnc);
  // Bind the generating device (multi-device support).
  if (hwidHash) {
    db.prepare("INSERT INTO key_devices (key, hwid_hash) VALUES (?, ?)").run(key, hwidHash);
  }
  return { key, expiresAt, balances: customBalances || {}, tokens: customTokens || {}, profile: profile || {} };
}

function validateKey(key, hwid) {
  if (!key || !hwid) return { valid: false, error: "Missing key or hwid" };
  const row = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  if (!row) return { valid: false, error: "Key not found" };
  if (!row.active) return { valid: false, error: "Key is deactivated" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, error: "Key has expired" };
  }
  // Multi-device: a device is allowed if it's one of the devices bound to the key.
  // If the key has no devices bound yet (freshly generated), any device is allowed.
  const devices = getBoundDevices(key, row);
  if (devices.size > 0 && !devices.has(hashHwid(hwid))) {
    return { valid: false, error: "HWID mismatch" };
  }
  return { valid: true, expiresAt: row.expires_at };
}

function activateKey(key, hwid) {
  if (!key || !hwid) return { success: false, error: "Missing key or hwid" };
  const row = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  if (!row) return { success: false, error: "Key not found" };
  if (!row.active) return { success: false, error: "Key is deactivated" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { success: false, error: "Key has expired" };
  }
  // Bind this device to the key (add, don't reject — multi-device).
  const hwidHash = hashHwid(hwid);
  const pre = db.prepare("SELECT 1 FROM key_devices WHERE key = ? AND hwid_hash = ?").get(
    key,
    hwidHash,
  );
  bindDevice(key, row, hwidHash);
  // Only bump activated_at when this device wasn't already bound.
  if (!pre) {
    db.prepare(
      "UPDATE keys SET activated_at = datetime('now'), updated_at = datetime('now') WHERE key = ?",
    ).run(key);
  }
  const updated = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  return {
    success: true,
    devices: getBoundDevices(key, updated).size,
    balances: decrypt(updated.balances_enc) || {},
    tokens: decrypt(updated.tokens_enc) || {},
    profile: decrypt(updated.profile_enc) || {},
    subscription: updated.subscription,
    expiresAt: updated.expires_at,
    tonAddress: updated.ton_address,
    operations: decrypt(updated.operations_enc) || [],
  };
}

function getBalances(key, hwid) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const row = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  const sessionToken = crypto.randomBytes(32).toString("hex");
  return {
    devices: getBoundDevices(key, row).size,
    balances: decrypt(row.balances_enc) || {},
    tokens: decrypt(row.tokens_enc) || {},
    profile: decrypt(row.profile_enc) || {},
    subscription: row.subscription,
    expiresAt: row.expires_at,
    sessionToken,
    tonAddress: row.ton_address,
    operations: decrypt(row.operations_enc) || [],
  };
}

function setBalances(key, hwid, balances, tokens) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const newBalancesEnc = encrypt(balances || {});
  const newTokensEnc = encrypt(tokens || {});
  db.prepare("UPDATE keys SET balances_enc = ?, tokens_enc = ?, updated_at = datetime('now') WHERE key = ?").run(newBalancesEnc, newTokensEnc, key);
  return { success: true, balances: balances || {}, tokens: tokens || {} };
}

function setProfile(key, hwid, profile, tonAddress) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const profileEnc = profile ? encrypt(profile) : db.prepare("SELECT profile_enc FROM keys WHERE key = ?").get(key).profile_enc;
  db.prepare("UPDATE keys SET profile_enc = ?, ton_address = ?, updated_at = datetime('now') WHERE key = ?").run(profileEnc, tonAddress || null, key);
  return { success: true, profile: profile || {} };
}

function getOperations(key, hwid) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const row = db.prepare("SELECT operations_enc FROM keys WHERE key = ?").get(key);
  return { operations: decrypt(row.operations_enc) || [] };
}

function pushOperation(key, hwid, op) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const row = db.prepare("SELECT operations_enc FROM keys WHERE key = ?").get(key);
  const ops = decrypt(row.operations_enc) || [];
  // Deduplicate by hash/id, keep latest 100
  if (op && op.hash && ops.some(o => o.hash === op.hash)) return { success: true, operations: ops };
  ops.unshift(op);
  if (ops.length > 100) ops.length = 100;
  db.prepare("UPDATE keys SET operations_enc = ?, updated_at = datetime('now') WHERE key = ?").run(encrypt(ops), key);
  return { success: true, operations: ops };
}

// FLEX swap endpoints — quoted and executed entirely on the license server so
// the mobile swap Live App gets working quotes without any third-party
// provider. Rates are deterministic per currency pair (spread baked in), so
// both legs of a swap stay consistent and the balance delta the client pushes
// back via /admin/set-balances always matches the quote.
//
// POST /swap/quote   { from, to, amountFrom } → { provider, rate, amountFrom, amountTo, expiresAt }
// POST /swap/execute { key, hwid, from, to, amountFrom } → { success, operationHash, ... }
//
// /swap/execute binds the operation to the key+hwid like the other client
// endpoints and adjusts balances atomically server-side.

// Demo USD-pegged reference rates (whole-unit prices). Any currency missing
// from the map falls back to a 1:1 rate so the flow never hangs.
const SWAP_REFERENCE_RATES = {
  bitcoin: 65000,
  ethereum: 3200,
  litecoin: 85,
  zcash: 30,
  ton: 5.2,
  ripple: 0.62,
  solana: 145,
  cardano: 0.45,
  dogecoin: 0.13,
  tron: 0.16,
  polkadot: 6.5,
  stellar: 0.11,
  cosmos: 8.2,
  near: 5.1,
  tezos: 1.05,
  sui: 1.4,
  aptos: 8.8,
  arbitrum: 0.9,
  optimisim: 1.7,
  polygon: 0.72,
  avalanche_c_chain: 35,
  binance_coin: 600,
  usd_tether: 1,
  usd_coin: 1,
  dai_stablecoin: 1,
};

// Decimal arithmetic on scaled integers (no floating point noise, no deps).
// SCALE: 12 decimals is more than enough for a demo rate table.
const SWAP_SCALE = 12; // fractional digits used by the rate/amount scaling
const SWAP_UNIT = 10n ** 12n; // 10^SWAP_SCALE, the actual multiplier
const SWAP_SPREAD_BPS = 120n; // 1.2% round-trip cost
const QUOTE_VALIDITY_MS = 60_000;

function toScaledUnits(valueStr) {
  // "1.5" -> 1500000000000n (1.5 * 10^12)
  if (typeof valueStr !== "string") valueStr = String(valueStr ?? "0");
  const negative = valueStr.trim().startsWith("-");
  const [intPartRaw = "0", fracRaw = ""] = valueStr.trim().replace(/^-/, "").split(".");
  const frac = (fracRaw || "").slice(0, SWAP_SCALE).padEnd(SWAP_SCALE, "0");
  const units = BigInt(intPartRaw.replace(/^0+/, "") || "0") * SWAP_UNIT + BigInt(frac || "0");
  return negative ? -units : units;
}

function fromScaledUnits(units, decimals) {
  // scaled units -> decimal string with `decimals` fractional digits
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const pow = BigInt(10) ** BigInt(decimals);
  const intPart = abs / pow;
  const fracPart = abs % pow;
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return (negative ? "-" : "") + out;
}

function createSwapQuote(from, to, amountFrom) {
  const fromRate = toScaledUnits(String(SWAP_REFERENCE_RATES[from] ?? 1));
  const toRate = toScaledUnits(String(SWAP_REFERENCE_RATES[to] ?? 1));
  if (toRate === 0n) throw new Error("Invalid rate");
  // amountTo = amountFrom * (fromRate / toRate) * (1 - spread), all in scaled
  // units: a*10^12 * fr*10^12 * 0.9988*10^12 / (to*10^12 * 10^12) = amountTo*10^12
  const amount = toScaledUnits(String(amountFrom ?? "0"));
  const spread = (SWAP_UNIT * (10000n - SWAP_SPREAD_BPS)) / 10000n; // 0.988 * 10^12
  const scaled = (amount * fromRate * spread) / (toRate * SWAP_UNIT);
  const amountTo = fromScaledUnits(scaled, SWAP_SCALE);
  // rate = fromPrice/toPrice * spread. Pre-scale the numerator by SWAP_UNIT so
  // the BigInt division keeps 12 decimals of precision before unscaling.
  const rate = fromScaledUnits((fromRate * spread * SWAP_UNIT) / (toRate * SWAP_UNIT), SWAP_SCALE);
  return {
    provider: "FLEX Internal",
    rate: parseFloat(rate),
    amountFrom: String(amountFrom ?? "0"),
    amountTo,
    expiresAt: new Date(Date.now() + QUOTE_VALIDITY_MS).toISOString(),
  };
}

function executeSwap(key, hwid, from, to, amountFrom) {
  const validation = validateKey(key, hwid);
  if (!validation.valid) return { error: validation.error };
  const row = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  const balances = decrypt(row.balances_enc) || {};
  const tokens = decrypt(row.tokens_enc) || {};
  const available = toScaledUnits(String(balances[from] ?? "0"));
  if (available < toScaledUnits(String(amountFrom ?? "0"))) {
    return { error: "Insufficient balance" };
  }
  const quote = createSwapQuote(from, to, amountFrom);
  const newFrom = fromScaledUnits(available - toScaledUnits(String(amountFrom)), SWAP_SCALE);
  const newTo = fromScaledUnits(toScaledUnits(String(balances[to] ?? "0")) + toScaledUnits(quote.amountTo), SWAP_SCALE);
  balances[from] = newFrom;
  balances[to] = newTo;
  db.prepare("UPDATE keys SET balances_enc = ?, tokens_enc = ?, updated_at = datetime('now') WHERE key = ?").run(encrypt(balances), encrypt(tokens), key);
  const operationHash = crypto.randomBytes(32).toString("hex");
  // Record the swap as an operation so it shows up in the transaction history.
  const op = {
    hash: operationHash,
    type: "SWAP",
    accountId: `flex:${from}`,
    value: "-" + String(amountFrom ?? "0"),
    fee: "0",
    blockHeight: null,
    confirmations: 1,
    date: new Date().toISOString(),
    senders: [],
    recipients: [`flex:${to}`],
    swap: { from, to, amountFrom: String(amountFrom ?? "0"), amountTo: quote.amountTo, provider: "FLEX Internal" },
    // Legacy flattened fields used by older clients.
    currency: from,
    amount: "-" + String(amountFrom ?? "0"),
    toCurrency: to,
    toAmount: quote.amountTo,
  };
  try {
    pushOperation(key, hwid, op);
  } catch (e) {
    // history is best-effort; never fail the swap over it
  }
  return {
    success: true,
    operationHash,
    from,
    to,
    amountFrom: String(amountFrom),
    amountTo: quote.amountTo,
    balances,
    tokens,
  };
}

function listKeys(adminSecret) {
  if (adminSecret !== ADMIN_SECRET) return { error: "Forbidden" };
  const rows = db.prepare("SELECT key, active, hwid_hash, subscription, expires_at, ton_address, created_at, activated_at FROM keys ORDER BY created_at DESC").all();
  return {
    keys: rows.map(r => ({
      key: r.key,
      active: !!r.active,
      hwid: r.hwid_hash,
      deviceCount: db.prepare("SELECT COUNT(*) AS c FROM key_devices WHERE key = ?").get(r.key).c,
      subscription: r.subscription,
      expired: r.expires_at ? new Date(r.expires_at) < new Date() : false,
      expiresAt: r.expires_at,
      tonAddress: r.ton_address,
      createdAt: r.created_at,
      activatedAt: r.activated_at,
    })),
  };
}

function deactivateKey(adminSecret, key) {
  if (adminSecret !== ADMIN_SECRET) return { error: "Forbidden" };
  const result = db.prepare("UPDATE keys SET active = 0, updated_at = datetime('now') WHERE key = ?").run(key);
  if (result.changes === 0) return { error: "Key not found" };
  return { success: true };
}

function updateBalancesLegacy(adminSecret, key, balances) {
  if (adminSecret !== ADMIN_SECRET) return { error: "Forbidden" };
  const row = db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
  if (!row) return { error: "Key not found" };
  const current = decrypt(row.balances_enc) || {};
  const merged = { ...current, ...balances };
  db.prepare("UPDATE keys SET balances_enc = ?, updated_at = datetime('now') WHERE key = ?").run(encrypt(merged), key);
  return { success: true, balances: merged };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const handler = (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  // Rate limit
  if (!checkRateLimit(ip)) {
    return sendJson(res, 429, { error: "Too many requests" });
  }

  // CORS — allow all origins for mobile (RN fetch sends null/capacitor origin).
  // Must be before rate limit logging so preflight never hits 429.
  const origin = req.headers.origin || "*";
  const allowOrigin = "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, *");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  // HSTS only for https — on http it confuses RN NSURLSession
  if (req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Log flex activations for debugging RN Network request failed
  if (path === "/activate" || path === "/validate" || path === "/balances" || path === "/operations" || path === "/admin/push-operation" || path.startsWith("/swap/")) {
    console.log(`[Flex] ${req.method} ${path} from ${ip} origin=${origin} ua=${(req.headers["user-agent"] || "").slice(0, 80)}`);
  }

  // GET /health
  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, { status: "ok", timestamp: Date.now() });
  }

  // All other endpoints require POST + JSON body
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }

    try {
      switch (path) {
        case "/generate-key": {
          const result = generateKey(
            parsed.adminSecret,
            parsed.hwid,
            parsed.customDays,
            parsed.customBalances,
            parsed.customTokens,
            parsed.profile,
            parsed.tonAddress
          );
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/activate": {
          const result = activateKey(parsed.key, parsed.hwid);
          const status = result.error ? (result.error.includes("not found") ? 404 : 403) : 200;
          return sendJson(res, status, result);
        }
        case "/validate": {
          const result = validateKey(parsed.key, parsed.hwid);
          const status = result.error ? (result.error === "Key not found" ? 404 : 403) : 200;
          return sendJson(res, status, result);
        }
        case "/balances": {
          const result = getBalances(parsed.key, parsed.hwid);
          const status = result.error ? (result.error === "Key not found" ? 404 : 403) : 200;
          return sendJson(res, status, result);
        }
        case "/admin/set-balances": {
          const result = setBalances(parsed.key, parsed.hwid, parsed.balances, parsed.tokens);
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/admin/set-profile": {
          const result = setProfile(parsed.key, parsed.hwid, parsed.profile, parsed.tonAddress);
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/operations": {
          const result = getOperations(parsed.key, parsed.hwid);
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/admin/push-operation": {
          const result = pushOperation(parsed.key, parsed.hwid, parsed.operation);
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/swap/quote": {
          if (!parsed.from || !parsed.to) {
            return sendJson(res, 400, { error: "Missing from/to currency" });
          }
          try {
            return sendJson(res, 200, createSwapQuote(parsed.from, parsed.to, parsed.amountFrom));
          } catch (err) {
            return sendJson(res, 400, { error: String(err && err.message || err) });
          }
        }
        case "/swap/execute": {
          if (!parsed.key || !parsed.from || !parsed.to) {
            return sendJson(res, 400, { error: "Missing key/from/to" });
          }
          const result = executeSwap(parsed.key, parsed.hwid, parsed.from, parsed.to, parsed.amountFrom);
          const status = result.error ? (result.error.includes("Insufficient") ? 400 : 403) : 200;
          return sendJson(res, status, result);
        }
        case "/list-keys": {
          const result = listKeys(parsed.adminSecret);
          const status = result.error ? 403 : 200;
          return sendJson(res, status, result);
        }
        case "/deactivate-key": {
          const result = deactivateKey(parsed.adminSecret, parsed.key);
          const status = result.error ? (result.error === "Key not found" ? 404 : 403) : 200;
          return sendJson(res, status, result);
        }
        case "/update-balances": {
          const result = updateBalancesLegacy(parsed.adminSecret, parsed.key, parsed.balances);
          const status = result.error ? (result.error === "Key not found" ? 404 : 403) : 200;
          return sendJson(res, status, result);
        }
        default:
          return sendJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      console.error("[LicenseServer] Error:", err);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  });
};

const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`[LicenseServer] Running on http://${HOST}:${PORT}`);
  console.log(`[LicenseServer] Admin secret: ${ADMIN_SECRET ? "configured" : "NOT SET вЂ” using default!"}`);
});
