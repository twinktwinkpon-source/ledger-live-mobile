/**
 * FLEX_DEMO License Server вЂ” Full Security Implementation
 * Runs on 94.156.114.31:9000 (or localhost for dev)
 *
 * Features:
 *   - SQLite database (node:sqlite) with AES-256-GCM encrypted sensitive data
 *   - HMAC-SHA256 signed license keys: FLEX-{r4}-{r4}-{hmac8}
 *   - Rate limiting: 20 req/min/IP
 *   - Security headers (no helmet needed вЂ” manual)
 *   - CORS with specific origins (no wildcard)
 *   - Audit logs for all key actions
 *   - TON balance sync from tonviewer.org every 30s
 *   - Atomic transfers between wallets
 *
 * Endpoints:
 *   GET  /health              вЂ” health check
 *   POST /generate-key        вЂ” generate a new key (admin)
 *   POST /activate            вЂ” bind key to HWID + get data
 *   POST /validate            вЂ” validate key+HWID
 *   POST /balances            вЂ” get balances/tokens/profile for key+HWID
 *   POST /admin/set-balances  вЂ” set balances+tokens (requires key+HWID)
 *   POST /admin/set-profile   вЂ” set device profile (requires key+HWID)
 *   POST /transfer            вЂ” transfer asset between wallets
 *   POST /list-keys           вЂ” list all keys (admin)
 *   POST /deactivate-key      вЂ” deactivate a key (admin)
 *   POST /update-balances     вЂ” update balances (admin, legacy)
 */

const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

// в”Ђв”Ђв”Ђ Config в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const PORT = parseInt(process.env.FLEX_PORT || "9000", 10);
const HOST = process.env.FLEX_HOST || "0.0.0.0";

// ── Secrets (MUST come from environment, never hard-coded) ──────────────
// FLEX_ADMIN_SECRET  – operator/admin secret authorizing admin endpoints and
//                      /generate-key. Set the same value on the server env and
//                      in the OPERATOR build (DefinePlugin). Client builds never
//                      embed it.
// FLEX_LEGACY_SECRET – optional. If set, already-issued HMAC keys signed with
//                      this legacy secret still validate during migration. Leave
//                      unset to disable legacy key support entirely.
const FLEX_SECRET = process.env.FLEX_ADMIN_SECRET || "";

// Asymmetric signing (Ed25519). The PRIVATE key lives ONLY on the server; it is
// what produces a valid license key. Clients/operator embed only the PUBLIC key
// to verify — a leaked client cannot mint keys.
// Generate with:
//   node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');console.log('PUB',publicKey.export({type:'spki',format:'der'}).toString('base64'));console.log('PRIV',privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));"
const FLEX_SIGNING_PUBLIC_KEY = process.env.FLEX_SIGNING_PUBLIC_KEY || "";
const FLEX_SIGNING_PRIVATE_KEY = process.env.FLEX_SIGNING_PRIVATE_KEY || "";
const FLEX_LEGACY_SECRET = process.env.FLEX_LEGACY_SECRET || "";
const FLEX_ALLOW_LEGACY = process.env.FLEX_ALLOW_LEGACY !== "0";

// Decode the Ed25519 keypair lazily (the DER strings are kept in env).
let _edPub = null;
let _edPriv = null;
function getEdPublic() {
  if (_edPub !== null) return _edPub;
  try {
    _edPub = FLEX_SIGNING_PUBLIC_KEY
      ? crypto.createPublicKey({ key: Buffer.from(FLEX_SIGNING_PUBLIC_KEY, "base64"), type: "spki", format: "der" })
      : null;
  } catch (e) { _edPub = null; console.error("[FLEX] Bad FLEX_SIGNING_PUBLIC_KEY:", e.message); }
  return _edPub;
}
function getEdPrivate() {
  if (_edPriv !== null) return _edPriv;
  try {
    _edPriv = FLEX_SIGNING_PRIVATE_KEY
      ? crypto.createPrivateKey({ key: Buffer.from(FLEX_SIGNING_PRIVATE_KEY, "base64"), type: "pkcs8", format: "der" })
      : null;
  } catch (e) { _edPriv = null; console.error("[FLEX] Bad FLEX_SIGNING_PRIVATE_KEY:", e.message); }
  return _edPriv;
}

const HWID_SALT = process.env.HWID_SALT || "ledger-2024";
const ENCRYPT_KEY =
  process.env.FLEX_ENCRYPT_KEY ||
  crypto.createHash("sha256").update("flex-demo-encryption-key").digest("hex").slice(0, 64);
// AES-256-GCM needs a 32-byte key
const AES_KEY = Buffer.from(
  (ENCRYPT_KEY.length === 64 ? ENCRYPT_KEY : crypto.createHash("sha256").update(ENCRYPT_KEY).digest("hex")),
  "hex",
).slice(0, 32);

const DB_PATH = path.join(__dirname, "flex_data.sqlite");

// CORS вЂ” only allow Electron app and admin panel
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3050",
  "file://",
  "null", // file:// origin in Electron
]);

// в”Ђв”Ђв”Ђ Database в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY,
    hwid_hash TEXT,
    activated_at TEXT,
    active INTEGER DEFAULT 1,
    subscription TEXT DEFAULT 'pro',
    expires_at TEXT,
    balances_enc TEXT,
    tokens_enc TEXT,
    profile_enc TEXT,
    ton_address TEXT,
    last_session TEXT,
    last_access TEXT
  );

  CREATE TABLE IF NOT EXISTS hwid_map (
    hwid_hash TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    FOREIGN KEY (key) REFERENCES keys(key)
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    address TEXT NOT NULL,
    asset TEXT NOT NULL,
    balance TEXT DEFAULT '0',
    FOREIGN KEY (key) REFERENCES keys(key),
    UNIQUE(key, address, asset)
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_key TEXT,
    to_key TEXT,
    asset TEXT,
    amount TEXT,
    ts TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    key TEXT,
    ip TEXT,
    detail TEXT,
    ts TEXT DEFAULT (datetime('now'))
  );
`);

// в”Ђв”Ђв”Ђ Encryption (AES-256-GCM) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function encrypt(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(encStr) {
  if (!encStr) return null;
  const [ivHex, tagHex, dataHex] = encStr.split(":");
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

// в”Ђв”Ђв”Ђ Audit Log в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function audit(action, key, ip, detail) {
  db.prepare("INSERT INTO audit_log (action, key, ip, detail) VALUES (?, ?, ?, ?)").run(
    action,
    key || "",
    ip || "",
    detail || "",
  );
}

// в”Ђв”Ђв”Ђ Rate Limiting в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(ip) {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const filtered = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (filtered.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, filtered);
    }
  }
}, 300000).unref();

// в”Ђв”Ђв”Ђ Key Generation & Validation в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing chars (0,O,1,I)
  function randSeg() {
    let seg = "";
    for (let i = 0; i < 4; i++) seg += chars[Math.floor(Math.random() * chars.length)];
    return seg;
  }
  const seg1 = randSeg();
  const seg2 = randSeg();
  const payload = `FLEX-${seg1}-${seg2}`;
  // New keys are signed with the server's Ed25519 private key. A key can only
  // be produced by whoever holds that private key (the server) — a leaked
  // client (which only has the public key) cannot mint valid keys.
  const priv = getEdPrivate();
  if (priv) {
    // Ed25519 signature encoded as uppercase hex: dash-free so the key splits
    // cleanly into exactly 4 segments (FLEX / A / B / sig). Hex sig is 128
    // chars (vs 8 for legacy HMAC), which also distinguishes the two schemes.
    const sig = crypto.sign(null, Buffer.from(payload), priv).toString("hex").toUpperCase();
    return `${payload}-${sig}`;
  }
  // Fallback (dev, no private key configured): HMAC with admin secret.
  const hmac = crypto
    .createHmac("sha256", FLEX_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `${payload}-${hmac}`;
}

function validateKeySignature(key) {
  if (!key || typeof key !== "string" || !key.startsWith("FLEX-")) return false;
  const parts = key.split("-");
  if (parts.length !== 4) return false;
  const payload = parts.slice(0, 3).join("-");
  const sig = parts[3];
  // Ed25519 signature (uppercase hex, 128 chars); legacy HMAC is 8 hex chars.
  if (sig.length > 20) {
    const pub = getEdPublic();
    if (!pub) return false;
    try {
      return crypto.verify(null, Buffer.from(payload), pub, Buffer.from(sig, "hex"));
    } catch {
      return false;
    }
  }
  // Legacy HMAC key (migration support). Only accepted when a legacy secret is
  // configured and legacy keys are not disabled.
  if (FLEX_ALLOW_LEGACY && FLEX_LEGACY_SECRET) {
    const expectedHmac = crypto
      .createHmac("sha256", FLEX_LEGACY_SECRET)
      .update(payload)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    return sig === expectedHmac;
  }
  return false;
}

// Normalize a raw HWID the same way the desktop app (hwid.ts) does, so the
// server-side hash always matches regardless of whitespace drift in any segment.
function normalizeHwid(hwid) {
  if (typeof hwid !== "string") return hwid;
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

// в”Ђв”Ђв”Ђ Default Data в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// Empty by default вЂ” no assets shown until the user adds them in the admin panel.
const DEFAULT_BALANCES = {};

const DEFAULT_PROFILE = {
  activeAssets: [],
  device: {
    modelId: "stax",
    name: "Ledger Stax (Demo)",
    firmwareVersion: "2.4.1",
    batteryLevel: 100,
  },
};

// в”Ђв”Ђв”Ђ DB Helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function getKeyRow(key) {
  return db.prepare("SELECT * FROM keys WHERE key = ?").get(key);
}

function getKeyByHwid(hwidHash) {
  const row = db.prepare("SELECT key FROM hwid_map WHERE hwid_hash = ?").get(hwidHash);
  return row ? row.key : null;
}

function getBalances(keyRow) {
  return decrypt(keyRow.balances_enc) || { ...DEFAULT_BALANCES };
}

function getTokens(keyRow) {
  return decrypt(keyRow.tokens_enc) || {};
}

function getProfile(keyRow) {
  return decrypt(keyRow.profile_enc) || { ...DEFAULT_PROFILE };
}

function isExpired(keyRow) {
  if (!keyRow.expires_at) return false;
  return new Date(keyRow.expires_at) < new Date();
}

function validateKeyAndHwid(key, hwidRaw) {
  if (!key || !hwidRaw) return { error: "Missing key or hwid", status: 400 };
  if (!validateKeySignature(key)) return { error: "Invalid key signature", status: 403 };

  const keyRow = getKeyRow(key);
  if (!keyRow) return { error: "Key not found", status: 404 };
  if (!keyRow.active) return { error: "Key is deactivated", status: 403 };
  if (isExpired(keyRow)) return { error: "Subscription expired", status: 403 };

  const hwidHash = hashHwid(hwidRaw);
  // Multi-device support: accept if this HWID is bound to the key via hwid_map
  // (phone + desktop can share one key), or if it matches the key's primary HWID.
  const bound = db
    .prepare("SELECT 1 FROM hwid_map WHERE hwid_hash = ? AND key = ?")
    .get(hwidHash, key);
  if (!bound && keyRow.hwid_hash !== hwidHash)
    return { error: "Key not bound to this device", status: 403 };

  return { keyRow, hwidHash };
}

// в”Ђв”Ђв”Ђ TON Sync в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const TON_SYNC_INTERVAL = 30000; // 30 seconds
const TON_API_BASE = "https://tonviewer.org/api/v2";

async function fetchTonBalance(address) {
  try {
    const url = `${TON_API_BASE}/account?address=${address}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FLEX-Server/1.0" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    // tonviewer returns balance in nanoTON
    if (data && data.balance !== undefined) {
      return data.balance.toString();
    }
    return null;
  } catch {
    return null;
  }
}

async function syncTonBalances() {
  try {
    // Get all keys with a TON address
    const rows = db
      .prepare("SELECT key, ton_address FROM keys WHERE ton_address IS NOT NULL AND active = 1")
      .all();

    for (const row of rows) {
      const balance = await fetchTonBalance(row.ton_address);
      if (balance !== null) {
        const keyRow = getKeyRow(row.key);
        if (!keyRow) continue;
        const balances = getBalances(keyRow);
        if (balances.ton !== balance) {
          balances.ton = balance;
          db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(
            encrypt(balances),
            row.key,
          );
          console.log(`[TON SYNC] ${row.key} в†’ ${balance} nanoTON`);
        }
      }
    }
  } catch (err) {
    console.error("[TON SYNC] Error:", err.message);
  }
}

// Start TON sync interval
setInterval(syncTonBalances, TON_SYNC_INTERVAL);
console.log("[TON] Sync started, interval:", TON_SYNC_INTERVAL, "ms");

// в”Ђв”Ђв”Ђ HTTP Helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data, req) {
  const json = JSON.stringify(data);
  const origin = req?.headers?.origin || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // Security headers
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
  // CORS вЂ” only allow known origins
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  } else if (!origin) {
    // Non-browser requests (Electron main process) вЂ” allow
    headers["Access-Control-Allow-Origin"] = "*";
  }
  res.writeHead(status, headers);
  res.end(json);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// в”Ђв”Ђв”Ђ Server в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const server = http.createServer(async (req, res) => {
  try {
  // CORS preflight
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {}, req);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = getClientIp(req);

  // Rate limiting
  if (!checkRateLimit(ip)) {
    sendJson(res, 429, { error: "Too many requests" }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Health Check в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", timestamp: Date.now() }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Generate Key (admin only) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/generate-key") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      audit("generate-key-denied", null, ip, "wrong admin secret");
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    // If HWID provided, check for existing active key
    if (body.hwid) {
      const hwidHash = hashHwid(body.hwid);
      const existingKey = getKeyByHwid(hwidHash);
      if (existingKey) {
        const existingRow = getKeyRow(existingKey);
        // Dev/demo mode: force-regenerate вЂ” clear any stale binding first so
        // the subsequent /activate never hits "Device already has a different key".
        if (body.force) {
          db.prepare("UPDATE keys SET active = 0, hwid_hash = NULL WHERE key = ?").run(existingKey);
          db.prepare("DELETE FROM hwid_map WHERE hwid_hash = ?").run(hwidHash);
          audit("generate-key-force-clear", existingKey, ip, "cleared stale binding");
        } else if (existingRow && existingRow.active && !isExpired(existingRow)) {
          audit("generate-key-reuse", existingKey, ip, "existing key for HWID");
          sendJson(
            res,
            200,
            {
              key: existingKey,
              balances: getBalances(existingRow),
              tokens: getTokens(existingRow),
              profile: getProfile(existingRow),
              subscription: existingRow.subscription || "pro",
              expiresAt: existingRow.expires_at,
            },
            req,
          );
          return;
        }
      }
    }

    const key = generateKey();
    const now = new Date();
    // Allow admin to override expiry (e.g. for testing expired keys). Falls
    // back to +30 days when expiresAt is not provided or invalid.
    let expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (!isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
    }
    const balances = { ...DEFAULT_BALANCES, ...(body.customBalances || {}) };
    const tokens = body.customTokens || {};
    const profile = { ...DEFAULT_PROFILE, ...(body.profile || {}) };

    db.prepare(
      `INSERT INTO keys (key, hwid_hash, activated_at, active, subscription, expires_at, balances_enc, tokens_enc, profile_enc, ton_address)
       VALUES (?, NULL, NULL, 1, 'pro', ?, ?, ?, ?, ?)`,
    ).run(key, expiresAt, encrypt(balances), encrypt(tokens), encrypt(profile), body.tonAddress || null);

    audit("generate-key", key, ip, `sub=pro expires=${expiresAt}`);
    console.log(`[KEY GEN] ${key} sub=pro expires=${expiresAt}`);

    sendJson(
      res,
      200,
      { key, balances, tokens, profile, subscription: "pro", expiresAt },
      req,
    );
    return;
  }

  // в”Ђв”Ђв”Ђ Activate Key (bind to HWID) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/activate") {
    const body = await readBody(req);
    const { key, hwid } = body;

    if (!key || !hwid) {
      sendJson(res, 400, { error: "Missing key or hwid" }, req);
      return;
    }
    if (!validateKeySignature(key)) {
      audit("activate-invalid-sig", key, ip, "bad HMAC");
      sendJson(res, 403, { error: "Invalid key signature" }, req);
      return;
    }

    const keyRow = getKeyRow(key);
    if (!keyRow) {
      sendJson(res, 404, { error: "Key not found" }, req);
      return;
    }
    if (!keyRow.active) {
      sendJson(res, 403, { error: "Key is deactivated" }, req);
      return;
    }
    if (isExpired(keyRow)) {
      sendJson(res, 403, { error: "Subscription expired" }, req);
      return;
    }

    const hwidHash = hashHwid(hwid);

    // Multi-device support: if the key is already bound to a different HWID,
    // still allow this device to join (add it to hwid_map) instead of rejecting.
    // Only the first activation sets the primary hwid_hash.
    if (keyRow.hwid_hash && keyRow.hwid_hash !== hwidHash) {
      audit("activate-multi-device", key, ip, `primary=${keyRow.hwid_hash?.slice(0, 16)} add=${hwidHash.slice(0, 16)}`);
    }

    // Check if HWID is already mapped to a different ACTIVE key.
    // Deactivated/old keys must not block re-activation (force-regeneration
    // clears their hwid_hash too, see /generate-key).
    const conflictRow = db
      .prepare("SELECT key FROM keys WHERE hwid_hash = ? AND key != ? AND active = 1")
      .get(hwidHash, key);
    if (conflictRow) {
      sendJson(res, 403, { error: "Device already has a different key" }, req);
      return;
    }

    // Bind key to HWID (primary only if not already set)
    const activatedAt = new Date().toISOString();
    db.prepare("UPDATE keys SET hwid_hash = COALESCE(hwid_hash, ?), activated_at = ? WHERE key = ?").run(
      hwidHash,
      activatedAt,
      key,
    );
    db.prepare("INSERT OR REPLACE INTO hwid_map (hwid_hash, key) VALUES (?, ?)").run(hwidHash, key);

    // If key has a TON address, trigger immediate sync
    if (keyRow.ton_address) {
      fetchTonBalance(keyRow.ton_address).then(balance => {
        if (balance !== null) {
          const freshRow = getKeyRow(key);
          const balances = getBalances(freshRow);
          balances.ton = balance;
          db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(encrypt(balances), key);
          console.log(`[TON SYNC] Initial sync for ${key}: ${balance}`);
        }
      });
    }

    audit("activate", key, ip, `hwid=${hwidHash.slice(0, 16)}...`);
    console.log(`[ACTIVATE] key=${key} hwid=${hwidHash.slice(0, 16)}...`);

    sendJson(
      res,
      200,
      {
        success: true,
        balances: getBalances(keyRow),
        tokens: getTokens(keyRow),
        profile: getProfile(keyRow),
        subscription: keyRow.subscription || "pro",
        expiresAt: keyRow.expires_at,
        tonAddress: keyRow.ton_address,
      },
      req,
    );
    return;
  }

  // в”Ђв”Ђв”Ђ Validate Key в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/validate") {
    const body = await readBody(req);
    const { key, hwid } = body;

    const validation = validateKeyAndHwid(key, hwid);
    if (validation.error) {
      sendJson(res, validation.status, { error: validation.error }, req);
      return;
    }

    sendJson(
      res,
      200,
      { valid: true, expiresAt: validation.keyRow.expires_at },
      req,
    );
    return;
  }

  // в”Ђв”Ђв”Ђ Get Balances в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/balances") {
    const body = await readBody(req);
    const { key, hwid } = body;

    const validation = validateKeyAndHwid(key, hwid);
    if (validation.error) {
      sendJson(res, validation.status, { error: validation.error }, req);
      return;
    }

    const keyRow = validation.keyRow;
    const sessionToken = crypto.randomBytes(32).toString("hex");

    db.prepare("UPDATE keys SET last_session = ?, last_access = ? WHERE key = ?").run(
      sessionToken,
      new Date().toISOString(),
      key,
    );

    audit("balances", key, ip, `session=${sessionToken.slice(0, 8)}...`);
    console.log(`[BALANCES] key=${key} session=${sessionToken.slice(0, 8)}...`);

    sendJson(
      res,
      200,
      {
        balances: getBalances(keyRow),
        tokens: getTokens(keyRow),
        profile: getProfile(keyRow),
        subscription: keyRow.subscription || "pro",
        expiresAt: keyRow.expires_at,
        sessionToken,
        tonAddress: keyRow.ton_address,
      },
      req,
    );
    return;
  }

  // в”Ђв”Ђв”Ђ Admin: Set Balances + Tokens в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/admin/set-balances") {
    const body = await readBody(req);
    const { key, hwid, balances, tokens } = body;

    const validation = validateKeyAndHwid(key, hwid);
    if (validation.error) {
      sendJson(res, validation.status, { error: validation.error }, req);
      return;
    }

    const keyRow = validation.keyRow;
    const currentBalances = getBalances(keyRow);
    const currentTokens = getTokens(keyRow);

    // REPLACE semantics вЂ” admin panel sends the COMPLETE desired list.
    // When balances = {} the user wants to clear all assets; a truthy check
    // on {} would skip the update and preserve stale keys.
    const newBalances = balances !== undefined ? balances : currentBalances;
    const newTokens = tokens !== undefined ? tokens : currentTokens;

    db.prepare("UPDATE keys SET balances_enc = ?, tokens_enc = ? WHERE key = ?").run(
      encrypt(newBalances),
      encrypt(newTokens),
      key,
    );

    audit("admin-set-balances", key, ip, `assets=${Object.keys(newBalances).length}`);
    console.log(`[ADMIN SET] key=${key} balances+tokens updated`);

    sendJson(res, 200, { success: true, balances: newBalances, tokens: newTokens }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Admin: Set Profile в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/admin/set-profile") {
    const body = await readBody(req);
    const { key, hwid, profile, tonAddress } = body;

    const validation = validateKeyAndHwid(key, hwid);
    if (validation.error) {
      sendJson(res, validation.status, { error: validation.error }, req);
      return;
    }

    const keyRow = validation.keyRow;
    const currentProfile = getProfile(keyRow);

    const activeAssets = Array.isArray(profile?.activeAssets)
      ? [...new Set(profile.activeAssets.filter(a => typeof a === "string"))]
      : currentProfile.activeAssets || DEFAULT_PROFILE.activeAssets;

    const device = profile?.device || currentProfile.device || {};
    const newProfile = {
      activeAssets,
      device: {
        modelId: typeof device.modelId === "string" ? device.modelId : "stax",
        name: typeof device.name === "string" ? device.name : "Ledger Stax (Demo)",
        firmwareVersion: typeof device.firmwareVersion === "string" ? device.firmwareVersion : "2.4.1",
        batteryLevel: typeof device.batteryLevel === "number" ? Math.max(0, Math.min(100, device.batteryLevel)) : 100,
      },
    };

    db.prepare("UPDATE keys SET profile_enc = ?, ton_address = ? WHERE key = ?").run(
      encrypt(newProfile),
      tonAddress || keyRow.ton_address,
      key,
    );

    // If TON address changed, trigger immediate sync
    if (tonAddress && tonAddress !== keyRow.ton_address) {
      fetchTonBalance(tonAddress).then(balance => {
        if (balance !== null) {
          const freshRow = getKeyRow(key);
          const balances = getBalances(freshRow);
          balances.ton = balance;
          db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(encrypt(balances), key);
          console.log(`[TON SYNC] After profile update for ${key}: ${balance}`);
        }
      });
    }

    audit("admin-set-profile", key, ip, `device=${newProfile.device.modelId} ton=${tonAddress || "unchanged"}`);
    sendJson(res, 200, { success: true, profile: newProfile }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Transfer Between Wallets в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/transfer") {
    const body = await readBody(req);
    const { key, hwid, toAddress, asset, amount } = body;

    const validation = validateKeyAndHwid(key, hwid);
    if (validation.error) {
      sendJson(res, validation.status, { error: validation.error }, req);
      return;
    }

    if (!toAddress || !asset || !amount) {
      sendJson(res, 400, { error: "Missing toAddress, asset, or amount" }, req);
      return;
    }

    // Find recipient by TON address (stored in ton_address column)
    const recipientRow = db
      .prepare("SELECT * FROM keys WHERE ton_address = ? AND active = 1")
      .get(toAddress);

    if (!recipientRow) {
      sendJson(res, 404, { error: "Recipient not found" }, req);
      return;
    }

    if (recipientRow.key === key) {
      sendJson(res, 400, { error: "Cannot transfer to yourself" }, req);
      return;
    }

    // Check sender balance
    const senderBalances = getBalances(validation.keyRow);
    const senderBalance = BigInt(senderBalances[asset] || "0");
    const transferAmount = BigInt(amount);

    if (senderBalance < transferAmount) {
      sendJson(res, 400, { error: "Insufficient balance" }, req);
      return;
    }

    // Atomic transfer
    db.exec("BEGIN TRANSACTION");
    try {
      // Debit sender
      senderBalances[asset] = (senderBalance - transferAmount).toString();
      db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(
        encrypt(senderBalances),
        key,
      );

      // Credit recipient
      const recipientBalances = getBalances(recipientRow);
      const recipBalance = BigInt(recipientBalances[asset] || "0");
      recipientBalances[asset] = (recipBalance + transferAmount).toString();
      db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(
        encrypt(recipientBalances),
        recipientRow.key,
      );

      // Record transfer
      db.prepare(
        "INSERT INTO transfers (from_key, to_key, asset, amount) VALUES (?, ?, ?, ?)",
      ).run(key, recipientRow.key, asset, amount);

      db.exec("COMMIT");

      audit("transfer", key, ip, `to=${recipientRow.key.slice(0, 16)}... asset=${asset} amount=${amount}`);
      console.log(`[TRANSFER] ${key} в†’ ${recipientRow.key} ${asset} ${amount}`);

      sendJson(
        res,
        200,
        {
          success: true,
          senderBalances: senderBalances,
          recipientKey: recipientRow.key,
        },
        req,
      );
    } catch (err) {
      db.exec("ROLLBACK");
      sendJson(res, 500, { error: "Transfer failed: " + err.message }, req);
      return;
    }
    return;
  }

  // в”Ђв”Ђв”Ђ List all keys (admin only) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/list-keys") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    const rows = db.prepare("SELECT * FROM keys").all();
    const keys = rows.map(row => ({
      key: row.key,
      active: row.active === 1 && !isExpired(row),
      expired: isExpired(row),
      hwid: row.hwid_hash ? row.hwid_hash.slice(0, 16) + "..." : null,
      activatedAt: row.activated_at,
      expiresAt: row.expires_at,
      subscription: row.subscription || "pro",
      tonAddress: row.ton_address,
    }));

    sendJson(res, 200, { keys }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Deactivate Key (admin only) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/deactivate-key") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    const row = getKeyRow(body.key);
    if (!row) {
      sendJson(res, 404, { error: "Key not found" }, req);
      return;
    }

    db.prepare("UPDATE keys SET active = 0 WHERE key = ?").run(body.key);
    audit("deactivate", body.key, ip, "admin");
    console.log(`[DEACTIVATE] ${body.key}`);
    sendJson(res, 200, { success: true }, req);
    return;
  }

  // ───── Deactivate key by raw HWID (admin only) ─────
  // Replicates how /activate stores the hash: client sends getHwidHash() =
  // sha256(normalize(raw) + HWID_SALT), and the server stores hashHwid(that) =
  // sha256(hash + HWID_SALT). We recompute the same double-hash to find and
  // deactivate the active key bound to that exact device, then drop the map.
  if (req.method === "POST" && url.pathname === "/deactivate-by-hwid") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    const raw = String(body.hwid || "").trim();
    if (!raw) {
      sendJson(res, 400, { error: "Missing hwid" }, req);
      return;
    }

    const clientHash = crypto
      .createHash("sha256")
      .update(normalizeHwid(raw) + HWID_SALT)
      .digest("hex");
    const storedHash = crypto
      .createHash("sha256")
      .update(clientHash + HWID_SALT)
      .digest("hex");

    const row = db
      .prepare("SELECT key FROM keys WHERE hwid_hash = ? AND active = 1")
      .get(storedHash);
    if (!row) {
      audit("deactivate-by-hwid-miss", null, ip, "no active key for hwid");
      sendJson(res, 404, { error: "No active key for this HWID" }, req);
      return;
    }

    db.prepare("UPDATE keys SET active = 0 WHERE key = ?").run(row.key);
    db.prepare("DELETE FROM hwid_map WHERE hwid_hash = ?").run(storedHash);
    audit("deactivate-by-hwid", row.key, ip, "admin");
    console.log(`[DEACTIVATE-BY-HWID] ${row.key}`);
    sendJson(res, 200, { success: true, key: row.key }, req);
    return;
  }

  // ───── Unbind key from its current HWID (admin only) ─────
  // Clears hwid_hash so the key can be re-activated from another device.
  if (req.method === "POST" && url.pathname === "/unbind-key") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    const keyRow = getKeyRow(body.key);
    if (!keyRow) {
      sendJson(res, 404, { error: "Key not found" }, req);
      return;
    }

    const oldHash = keyRow.hwid_hash;
    db.prepare("UPDATE keys SET hwid_hash = NULL WHERE key = ?").run(body.key);
    if (oldHash) {
      db.prepare("DELETE FROM hwid_map WHERE hwid_hash = ?").run(oldHash);
    }
    audit("unbind-key", body.key, ip, oldHash ? `cleared ${oldHash.slice(0, 16)}...` : "no binding");
    console.log(`[UNBIND] ${body.key}`);
    sendJson(res, 200, { success: true }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ Update Balances (admin, legacy compat) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (req.method === "POST" && url.pathname === "/update-balances") {
    const body = await readBody(req);
    if (!FLEX_SECRET || body.adminSecret !== FLEX_SECRET) {
      sendJson(res, 403, { error: "Forbidden" }, req);
      return;
    }

    const keyRow = getKeyRow(body.key);
    if (!keyRow) {
      sendJson(res, 404, { error: "Key not found" }, req);
      return;
    }

    const balances = getBalances(keyRow);
    const newBalances = { ...balances, ...(body.balances || {}) };
    db.prepare("UPDATE keys SET balances_enc = ? WHERE key = ?").run(
      encrypt(newBalances),
      body.key,
    );

    audit("update-balances", body.key, ip, "admin legacy");
    console.log(`[UPDATE] ${body.key} balances updated`);
    sendJson(res, 200, { success: true, balances: newBalances }, req);
    return;
  }

  // в”Ђв”Ђв”Ђ 404 в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  sendJson(res, 404, { error: "Not found" }, req);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    const message = status === 400 ? "Invalid JSON" : "Internal server error";
    console.error("[SERVER ERROR]", status, message);
    if (status === 500) console.error(err);
    try {
      sendJson(res, status, { error: message }, req);
    } catch (_) {
      if (!res.headersSent) {
        try { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: message })); } catch (_) {}
      } else {
        try { res.end(); } catch (_) {}
      }
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`в•”в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•—`);
  console.log(`в•‘  FLEX License Server v2.0                       в•‘`);
  console.log(`в•‘  Listening: http://${HOST}:${PORT}                     в•‘`);
  console.log(`в•‘  DB: ${DB_PATH.slice(-40).padStart(40)} в•‘`);
  console.log(`в•‘  Encryption: AES-256-GCM                        в•‘`);
  console.log(`в•‘  Key signing: ${getEdPrivate() ? "Ed25519" : "UNSECURED (no private key)"}                       в•‘`);
  console.log(`в•‘  Admin secret: ${FLEX_SECRET ? "configured" : "MISSING (admin endpoints disabled)"}            в•‘`);
  console.log(`в•‘  Rate limit: ${RATE_LIMIT_MAX} req/min/IP                    в•‘`);
  console.log(`в•‘  TON sync: every ${TON_SYNC_INTERVAL / 1000}s                      в•‘`);
  console.log(`в•љв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ќ`);
  console.log(`Endpoints:
  GET  /health              вЂ” health check
  POST /generate-key        вЂ” generate a new key (admin)
  POST /activate            вЂ” bind key to HWID + get data
  POST /validate            вЂ” validate key+HWID
  POST /balances            вЂ” get balances/tokens/profile
  POST /admin/set-balances  вЂ” set balances+tokens (key+HWID auth)
  POST /admin/set-profile   вЂ” set device profile (key+HWID auth)
  POST /transfer            вЂ” transfer asset between wallets
  POST /list-keys           вЂ” list all keys (admin)
  POST /deactivate-key      вЂ” deactivate a key (admin)
  POST /update-balances     вЂ” update balances (admin, legacy)`);
});

// Graceful shutdown
function shutdown() {
  console.log("[License Server] Shutting down...");
  try { syncTonBalances(); } catch {} // Final sync attempt
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);