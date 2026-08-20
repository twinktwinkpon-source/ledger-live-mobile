/**
 * License Manager — handles license validation flow.
 *
 * Flow:
 * 1. On app start, check if a license key is stored locally
 * 2. If yes, validate it with the server (key + HWID)
 * 3. If valid, load the app
 * 4. If invalid or missing, show the license window — BLOCKING
 * 5. User enters key → activate with server → if ok, store key and load app
 *
 * NO demo key. NO free subscription. Only Pro (30 days).
 * If server is unreachable AND no stored key → app does NOT start.
 * If server is unreachable AND stored key was previously activated → offline access.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import Store from "electron-store";
import { getHwidHash } from "./hwid";
import * as crypto from "crypto";
import QRCode from "qrcode";

// ── Ensure loopback fetches bypass any HTTP proxy ──────────────────────────
// Some environments expose an HTTP(S) proxy and Node's global fetch (undici)
// honours the *lowercase* `no_proxy`/`NO_PROXY` variables. When only the
// uppercase variant is present (or loopback entries are missing), requests to
// the local license server fail with "TypeError: fetch failed". Normalise both
// casings here so all 127.0.0.1/localhost traffic goes direct.
(function ensureLoopbackBypassProxy(): void {
  const bypass = "127.0.0.1,localhost,::1";
  for (const key of ["no_proxy", "NO_PROXY"]) {
    const current = process.env[key];
    const entries = current ? current.split(",").map(s => s.trim()) : [];
    if (!entries.includes("127.0.0.1")) {
      process.env[key] = current ? `${current},${bypass}` : bypass;
    }
  }
})();

// Resolve the Ledger logo icon regardless of whether we run from source
// (__dirname = src/main in dev) or from the bundled output (__dirname = .webpack
// in production). The icon lives at <appRoot>/build/icons/ledger-logo.png, so we
// walk up from __dirname until we find it — works in every layout.
function resolveIconPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "build/icons/icon.png");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(__dirname, "build/icons/icon.png");
}

// Resolve an HTML asset (license-window.html / admin-panel.html) regardless of
// dev vs bundled layout. In dev __dirname = src/main (file sits next to it);
// in production webpack copies it to <appRoot>/.webpack, while __dirname is
// .webpack/main — so we try both the immediate dir and walk up looking for it.
function resolveHtmlPath(fileName: string): string {
  const immediate = path.join(__dirname, fileName);
  if (fs.existsSync(immediate)) return immediate;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return immediate;
}

// Server URL: defaults to loopback in dev (FLEX_SERVER not set or "local"),
// production URL only when explicitly set via FLEX_SERVER env var.
// Hardcoded production license server (VPS) used when no env override is given.
const PROD_LICENSE_SERVER = "http://94.156.114.31:9000";
const LICENSE_SERVER =
  process.env.FLEX_SERVER === "local"
    ? "http://127.0.0.1:9000"
    : process.env.FLEX_SERVER || PROD_LICENSE_SERVER;

// Compile-time mode: "client" builds have no operator tooling (dead-code
// eliminated). "operator" (default) keeps keygen / offline-activate / admin IPC.
// NOTE: guards MUST test process.env.FLEX_MODE directly (DefinePlugin replaces
// that expression with a string literal that the minifier folds), NOT a named
// const like IS_CLIENT_BUILD — an exported const binding survives minification
// as a variable reference and its guarded code is never eliminated.
const FLEX_MODE: string = process.env.FLEX_MODE || "operator";
export const IS_CLIENT_BUILD = FLEX_MODE === "client";

// Operator admin secret. Client builds MUST NOT embed it: process.env.FLEX_MODE
// is replaced with a literal at build time, so this ternary folds to "" in
// client bundles (dead-code eliminated) and only the operator build keeps the
// value. The value is baked from the build host's FLEX_ADMIN_SECRET env via
// DefinePlugin — there is no hard-coded default anymore.
const FLEX_SECRET =
  process.env.FLEX_MODE === "client" ? "" : (process.env.FLEX_ADMIN_SECRET || "");

// Ed25519 PUBLIC key used to verify license-key signatures locally (operator
// offline path). It is PUBLIC — safe to embed in every build. A leaked client
// cannot mint keys because minting requires the PRIVATE key, which lives only
// on the server (and never in any distributed build).
const FLEX_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAv4kYJ5oB2yldZphqvSdpri1eYdwrgJWvI0vkl+JX1xE=";

// A valid Ed25519-signed key, minted by the server, baked ONLY into the
// operator build so the operator can open their own app offline (no server).
// It is referenced only from operator-only code, so it is dead-code eliminated
// from client bundles. It grants offline access to the operator's own app; it
// does NOT mint keys (that still requires the server's private key).
const OPERATOR_OFFLINE_KEY =
  "FLEX-3S7R-BSVP-47AD6F30158CDB9DDD070469C385F413B2C260ACD5B98EA998A6265AC66A82CDB180F4268F807223ED61343F62CF7C9E96E6204DCB180EFBDEDD87B64C4D9C05";

// Verify a license key's Ed25519 signature using the embedded public key.
// Used for the operator's offline path. Signature is uppercase hex (128 chars);
// legacy HMAC keys (8 hex chars) are not accepted here.
function verifyFlexKeySignature(key: string): boolean {
  if (!key || typeof key !== "string" || !key.startsWith("FLEX-")) return false;
  const parts = key.split("-");
  if (parts.length !== 4) return false;
  const payload = parts.slice(0, 3).join("-");
  const sig = parts[3];
  if (sig.length <= 20) return false;
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.from(FLEX_PUBLIC_KEY, "base64"),
      type: "spki",
      format: "der",
    });
    return crypto.verify(null, Buffer.from(payload), pub, Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}
const store = new Store({ name: "license" });

let licenseWindow: BrowserWindow | null = null;
let adminWindow: BrowserWindow | null = null;
let mainWindowRef: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

// Resolution callback for the in-flight showLicenseWindow() promise. Set while
// the activation window is open so the "Dev License" shortcut can complete it
// without re-running the network activation round-trip.
let licenseWindowResolve: ((result: LicenseResult) => void) | null = null;


// Cached data — fetched after license validation, returned via sync IPC
let cachedBalances: Record<string, string> | null = null;
let cachedTokens: Record<string, string> | null = null;
let cachedProfile: Record<string, unknown> | null = null;
let cachedTonAddress: string | null = null;
// Set to true when the admin panel saves balances. Tells initServerBalances()
// to skip the localStorage merge so the freshly-saved values aren't overridden
// by stale lower values from previous sessions.
let freshAdminPush = false;

let _licenseExpiryTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic license expiry + HWID re-validation checks. Every 60 seconds. */
export function startLicenseTimer(): void {
  stopLicenseTimer();
  _licenseExpiryTimer = setInterval(async () => {
    const key = getStoredKey();
    if (!key) return;
    if (isStoredKeyExpired()) {
      console.log("[License] Subscription expired (local) during session — blocking.");
      clearLicense();
      showExpiredWindow();
      stopLicenseTimer();
      return;
    }
    const result = await validateKey(key);
    if (result.valid && result.expiresAt) {
      setStoredExpiry(result.expiresAt);
      if (new Date(result.expiresAt) < new Date()) {
        console.log("[License] Subscription expired during session — blocking.");
        clearLicense();
        showExpiredWindow();
        stopLicenseTimer();
      }
    } else if (!result.valid && result.error !== "Cannot connect to license server") {
      console.log("[License] Key rejected during session — blocking:", result.error);
      clearLicense();
      showExpiredWindow();
      stopLicenseTimer();
    }
    // Multi-device sync: pull balances and push changes to the renderer so
    // edits made on the phone (or the admin panel) appear on the desktop
    // automatically.
    await syncBalancesFromServer();
  }, 30000);
}

export function stopLicenseTimer(): void {
  if (_licenseExpiryTimer) {
    clearInterval(_licenseExpiryTimer);
    _licenseExpiryTimer = null;
  }
}

function showExpiredWindow(): void {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    licenseWindow.webContents.send("license:expired", "Your subscription has expired. Please enter a new key.");
    return;
  }
  licenseWindow = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: true,
    title: "Ledger Wallet — Subscription Expired",
    icon: resolveIconPath(),
    center: true,
    show: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  const htmlPath = resolveHtmlPath("license-window.html");
  licenseWindow.loadFile(htmlPath).then(() => {
    licenseWindow?.webContents.send("license:expired", "Your subscription has expired. Enter a new key to continue.");
  });
  licenseWindow.on("close", e => {
    if (!licenseWindow) return;
    e.preventDefault();
  });
  // Allow close only when a valid key is entered
  const handler = async (_event: unknown, key: string) => {
    const result = await activateKey(key);
    if (result.valid) {
      licenseWindow?.removeAllListeners("close");
      if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
      ipcMain.removeHandler("license:activate");
      startLicenseTimer();
    } else {
      if (licenseWindow && !licenseWindow.isDestroyed())
        licenseWindow.webContents.send("license:error", result.error);
    }
  };
  ipcMain.handle("license:activate", handler);
  licenseWindow.on("closed", () => {
    ipcMain.removeHandler("license:activate");
    licenseWindow = null;
    ipcMain.removeHandler("license:activate-expired");
  });
}

/** Set reference to the main window (for pushing balance updates to renderer) */
export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export interface LicenseResult {
  valid: boolean;
  key?: string;
  balances?: Record<string, string>;
  sessionToken?: string;
  expiresAt?: string;
  offline?: boolean;
  profile?: Record<string, unknown>;
  error?: string;
}

function getStoredKey(): string | null {
  return (store.get("licenseKey") as string) || null;
}

function setStoredKey(key: string): void {
  store.set("licenseKey", key);
}

// Persist the subscription expiry locally so the client can enforce the cutoff
// even OFFLINE (when the server is unreachable the client would otherwise not
// know the key expired). Written on every successful activate/validate/fetch.
function setStoredExpiry(expiresAt: string | null | undefined): void {
  if (typeof expiresAt === "string" && expiresAt) {
    store.set("licenseExpiry", expiresAt);
  } else {
    store.delete("licenseExpiry");
  }
}

function getStoredExpiry(): string | null {
  return (store.get("licenseExpiry") as string) || null;
}

// True when a stored key exists AND its locally-persisted expiry has passed.
// Used to hard-block (no offline bypass) once a subscription is over.
function isStoredKeyExpired(): boolean {
  const key = getStoredKey();
  if (!key) return true;
  const exp = getStoredExpiry();
  if (!exp) return false; // unknown expiry → don't block on that alone
  return new Date(exp) < new Date();
}

// Persist balances/profile/tokens locally so the portfolio survives a full
// app restart even if the license server is temporarily unreachable. Without
// this the in-memory `cachedBalances` is lost on quit and the user sees an
// empty portfolio until the server answers again.
function persistCachedState(): void {
  try {
    console.log("[BalanceTrace] persistCachedState called, cachedBalances:", JSON.stringify(cachedBalances));
    if (cachedBalances) store.set("cachedBalances", cachedBalances);
    if (cachedProfile) store.set("cachedProfile", cachedProfile);
    if (cachedTokens) store.set("cachedTokens", cachedTokens);
    if (cachedTonAddress) store.set("cachedTonAddress", cachedTonAddress);
    console.log("[BalanceTrace] persistCachedState: wrote to store OK, storePath:", store.path);
  } catch (e) {
    console.error("[BalanceTrace] persistCachedState FAILED:", e);
  }
}

/** Load previously persisted balances into the in-memory cache (offline fallback). */
export function loadPersistedBalances(): void {
  try {
    console.log("[BalanceTrace] loadPersistedBalances: current cachedBalances:", JSON.stringify(cachedBalances));
    const persisted = store.get("cachedBalances") as Record<string, string> | undefined;
    console.log("[BalanceTrace] loadPersistedBalances: persisted from store:", JSON.stringify(persisted), "storePath:", store.path);
    if (!cachedBalances) {
      if (persisted && typeof persisted === "object") {
        cachedBalances = persisted;
        console.log("[BalanceTrace] loadPersistedBalances: LOADED cachedBalances from store:", JSON.stringify(cachedBalances));
      }
    } else {
      console.log("[BalanceTrace] loadPersistedBalances: SKIPPED — cachedBalances already set:", JSON.stringify(cachedBalances));
    }
    if (!cachedProfile) {
      cachedProfile = (store.get("cachedProfile") as Record<string, unknown>) || null;
    }
    if (!cachedTokens) {
      cachedTokens = (store.get("cachedTokens") as Record<string, string>) || null;
    }
    if (!cachedTonAddress) {
      cachedTonAddress = (store.get("cachedTonAddress") as string) || null;
    }
  } catch (e) {
    console.error("[BalanceTrace] loadPersistedBalances FAILED:", e);
  }
}

export function clearLicense(): void {
  store.delete("licenseKey");
  store.delete("licenseExpiry");
}

// ─── Server Auto-Start ─────────────────────────────────────

/** Kill any zombie license server process on port 9000 (from previous sessions). */
function killZombieServer(): void {
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process");
      const output = execSync("netstat -ano | findstr :9000", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const pids = new Set<string>();
      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && trimmed.includes("LISTENING")) {
          const parts = trimmed.split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          // /T also kills the node child (the actual listener) in case the
          // zombie is a wrapper. Errors are logged, not swallowed, so a failed
          // kill is visible instead of silently leaving a stale server behind.
          execSync(`taskkill /F /T /PID ${pid}`, {
            encoding: "utf-8",
            timeout: 5000,
            stdio: "pipe",
          });
          console.log(`[License] Killed zombie server (PID ${pid}) on port 9000`);
        } catch (e) {
          console.error(`[License] Failed to kill zombie server (PID ${pid}):`, e);
        }
      }
      // Give the OS a moment to release the socket before the new server binds.
      for (let i = 0; i < 5; i++) {
        const stillUp = execSync("netstat -ano | findstr :9000", {
          encoding: "utf-8",
          timeout: 5000,
        });
        if (!/LISTENING/.test(stillUp)) break;
        execSync("ping -n 1 -w 200 127.0.0.1 >nul", { timeout: 2000 });
      }
    } else {
      const { execSync } = require("child_process");
      try {
        const output = execSync("lsof -ti :9000", {
          encoding: "utf-8",
          timeout: 5000,
          stdio: "pipe",
        });
        const pids = output
          .split("\n")
          .map((p: string) => p.trim())
          .filter((p: string) => p && /^\d+$/.test(p));
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), "SIGKILL");
            console.log(`[License] Killed zombie server (PID ${pid}) on port 9000`);
          } catch {
            // ignore
          }
        }
      } catch {
        // no process found — fine
      }
    }
  } catch {
    // netstat/lsof failed — no zombie, nothing to kill
  }
}

/** Start the license server as a child process (local dev mode only). */
export function startLicenseServer(): void {
  // Only auto-start in local dev mode
  if (process.env.FLEX_SERVER === "local" || !process.env.FLEX_SERVER) {
    // Kill any zombie server from a previous session (e.g. after Electron reload)
    killZombieServer();

    // In dev, __dirname is .webpack/ inside the app folder.
    // The server lives at apps/ledger-live-desktop/server/index.js
    // In production, CopyRspackPlugin copies server/ to .webpack/server/
    // asarUnpack in electron-builder.yml extracts .webpack/server/**/* to
    // app.asar.unpacked/ so Node.js spawn() can read the file (spawn cannot
    // read inside app.asar archives).
    const bundledServerPath = path.join(__dirname, "server", "index.js");

    // Redirect asar path to app.asar.unpacked so Node.js can spawn the file.
    const serverPath = bundledServerPath.includes("app.asar")
      ? bundledServerPath.replace("app.asar", "app.asar.unpacked")
      : bundledServerPath;
    try {
      serverProcess = spawn("node", [serverPath], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
      serverProcess.stdout?.on("data", d => {
        const line = d.toString().trim();
        if (line) console.log(`[LicenseServer] ${line}`);
      });
      serverProcess.stderr?.on("data", d => {
        const line = d.toString().trim();
        if (line) console.error(`[LicenseServer] ${line}`);
      });
      serverProcess.on("error", err => {
        console.error("[License] Server process error:", err);
      });
      // Auto-cleanup when the server process exits unexpectedly
      serverProcess.on("exit", code => {
        console.log(`[License] Server process exited with code ${code}`);
        serverProcess = null;
      });
      console.log("[License] Server process started:", serverPath);
    } catch (err) {
      console.error("[License] Failed to start server:", err);
    }
  }
}

/** Stop the license server child process. */
export function stopLicenseServer(): void {
  if (serverProcess) {
    try {
      // On Windows, kill() only terminates the parent, not child processes.
      // Use taskkill /F /T to forcefully kill the entire process tree.
      if (process.platform === "win32" && serverProcess.pid) {
        try {
          const { execSync } = require("child_process");
          execSync(`taskkill /F /T /PID ${serverProcess.pid}`, {
            encoding: "utf-8",
            timeout: 5000,
            stdio: "pipe",
          });
        } catch {
          // Process may have already exited — fall through to kill()
          serverProcess.kill();
        }
      } else {
        serverProcess.kill();
      }
    } catch {
      // ignore
    }
    serverProcess = null;
    console.log("[License] Server process stopped");
  }
}

/**
 * Wait for the license server to be ready (poll /health).
 * Returns true if server is ready, false if timeout reached.
 */
export async function waitForServer(maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${LICENSE_SERVER}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        console.log(`[License] Server ready after ${i * intervalMs}ms`);
        return true;
      }
    } catch {
      // Server not ready yet — keep polling
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  console.warn("[License] Server did not become ready in time");
  return false;
}

// ─── Unit Conversion ────────────────────────────────────────
// The admin panel sends/receives WHOLE units (BTC, ETH, etc), but the
// system stores SMALLEST units (satoshi, wei, lamports). Convert here.

const CURRENCY_DECIMALS: Record<string, number> = {
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

/** Convert whole units (e.g. "13124" BTC) to smallest units ("1312400000000" satoshi).
 *  Works with arbitrarily large integers via string manipulation — no BigNumber dependency. */
function wholeToSmallest(balances: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, amount] of Object.entries(balances)) {
    const decimals = CURRENCY_DECIMALS[id];
    if (decimals === undefined) { result[id] = amount; continue; }
    try {
      const dot = amount.indexOf(".");
      const intPart = dot >= 0 ? amount.slice(0, dot) : amount;
      let decPart = dot >= 0 ? amount.slice(dot + 1) : "";
      if (decPart.length > decimals) decPart = decPart.slice(0, decimals);
      else decPart = decPart.padEnd(decimals, "0");
      result[id] = (intPart + decPart).replace(/^0+(?=\d)/, "") || "0";
    } catch {
      result[id] = amount;
    }
  }
  return result;
}

/** Convert smallest units back to whole units for admin panel display.
 *  e.g. "1312400000000" satoshi → "13124" BTC */
function smallestToWhole(balances: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, amount] of Object.entries(balances)) {
    const decimals = CURRENCY_DECIMALS[id];
    if (decimals === undefined) { result[id] = amount; continue; }
    try {
      const padded = amount.padStart(decimals + 1, "0");
      const intPart = padded.slice(0, padded.length - decimals);
      const decPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
      result[id] = decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      result[id] = amount;
    }
  }
  return result;
}

// ─── Server Communication ─────────────────────────────────

export async function fetchBalancesFromServer(): Promise<Record<string, string> | null> {
  const key = getStoredKey();
  if (!key) { console.log("[BalanceTrace] fetchBalancesFromServer: no key, returning null"); return null; }
  const hwid = getHwidHash();
  console.log("[BalanceTrace] fetchBalancesFromServer: fetching from", LICENSE_SERVER, "key:", key.substring(0, 12) + "...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${LICENSE_SERVER}/balances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, hwid }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.error("[BalanceTrace] fetchBalancesFromServer: FAILED status:", response.status);
      return null;
    }
    const data = await response.json();
    console.log("[BalanceTrace] fetchBalancesFromServer: response.balances:", JSON.stringify(data.balances));
    if (data.balances) {
      if (data.sessionToken) store.set("sessionToken", data.sessionToken);
      cachedProfile = data.profile || null;
      cachedTokens = data.tokens || null;
      cachedTonAddress = data.tonAddress || null;
      persistCachedState();
      return data.balances;
    }
    return null;
  } catch (_err) {
    console.error("[BalanceTrace] fetchBalancesFromServer: ERROR:", String(_err));
    return null;
  }
}

/**
 * Pull balances/tokens/profile from the server and, if they changed, push them
 * to the renderer (which reloads and re-renders the portfolio). This is the
 * desktop side of the phone<->desktop interconnection: edits made on either
 * device propagate to the other.
 */
async function syncBalancesFromServer(): Promise<void> {
  const key = getStoredKey();
  if (!key) return;
  const before = JSON.stringify(cachedBalances);
  const balances = await fetchBalancesFromServer();
  // Refresh the in-memory cache + local store, but DO NOT pushToApp/reload the
  // renderer here. This runs on a 30s background poll and the server updates
  // e.g. TON every 30s, so reloading would loop forever / hang on the splash.
  // The renderer is reloaded explicitly on admin actions (Ctrl+Shift+L) instead.
  if (balances && JSON.stringify(balances) !== before) {
    cachedBalances = balances;
    persistCachedState();
    console.log("[FlexSync] balances changed on server — cached (no renderer reload)");
  }
}

async function validateKey(key: string): Promise<LicenseResult> {
  const hwid = getHwidHash();

  // Local signature check: a key carrying a valid Ed25519 signature (produced
  // by the server's private key) is valid even when the server is unreachable
  // (operator offline access). Operator-only — client builds MUST validate
  // against the server so expiry/HWID binding hold.
  if (process.env.FLEX_MODE !== "client" && key && typeof key === "string" && key.startsWith("FLEX-")) {
    if (verifyFlexKeySignature(key)) {
      return { valid: true, key, offline: true, expiresAt: undefined };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${LICENSE_SERVER}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, hwid }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { valid: false, error: data.error || "Validation failed" };
    }
    const data = await response.json();
    if (data.expiresAt) setStoredExpiry(data.expiresAt);
    return { valid: data.valid === true, key, expiresAt: data.expiresAt };
  } catch (_err) {
    return { valid: false, error: "Cannot connect to license server" };
  }
}

async function activateKey(key: string): Promise<LicenseResult> {
  const hwid = getHwidHash();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${LICENSE_SERVER}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, hwid }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      // Map server errors to user-friendly messages (English UI).
      let msg = data.error || `Activation failed (${response.status})`;
      if (response.status === 403) {
        if (/expir/i.test(msg)) msg = "Subscription expired. Enter a new activation key.";
        else if (/deactivat/i.test(msg)) msg = "Key deactivated. Contact the operator.";
        else if (/bound|device/i.test(msg)) msg = "Key is bound to another device.";
        else msg = "Invalid or unauthorized key.";
      }
      return { valid: false, error: msg };
    }
    const data = await response.json();
    if (data.success) {
      setStoredKey(key);
      setStoredExpiry(data.expiresAt);
      return { valid: true, key, balances: data.balances, profile: data.profile, expiresAt: data.expiresAt };
    }
    return { valid: false, error: "Activation failed" };
  } catch (_err) {
    return { valid: false, error: "Cannot connect to license server" };
  }
}

/**
 * Provision a local development license for FLEX_DEMO.
 *
 * This path is intentionally restricted to the explicit development command
 * (`NODE_ENV=development` + `FLEX_DEMO=true`). Production builds still require
 * a real user-provided key and go through the normal activation flow.
 */
export async function ensureDevFlexLicense(): Promise<LicenseResult> {
  const isDevFlex = process.env.FLEX_DEMO === "true";
  if (!isDevFlex) {
    return { valid: false, error: "Development FLEX license is disabled" };
  }

  const storedKey = getStoredKey();
  if (storedKey) {
    const validation = await validateKey(storedKey);
    if (validation.valid) {
      cachedBalances = await fetchBalancesFromServer();
      return validation;
    }
    clearLicense();
  }

  try {
    const response = await fetch(`${LICENSE_SERVER}/generate-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: FLEX_SECRET, hwid: getHwidHash(), force: true }),
    });
    if (!response.ok) {
      return { valid: false, error: `Development license generation failed (${response.status})` };
    }

    const generated = (await response.json()) as { key?: string };
    if (!generated.key) return { valid: false, error: "Development license key was not returned" };

    const activated = await activateKey(generated.key);
    if (activated.valid) {
      cachedBalances = activated.balances ?? (await fetchBalancesFromServer());
    }
    return activated;
  } catch (error) {
    return { valid: false, error: `Development license server unavailable: ${String(error)}` };
  }
}

// ─── License Window ────────────────────────────────────────

export function showLicenseWindow(): Promise<LicenseResult> {
  return new Promise(resolve => {
    licenseWindowResolve = resolve;
    if (licenseWindow && !licenseWindow.isDestroyed()) {
      licenseWindow.focus();
      // Resolve with invalid so caller knows no activation happened via this path.
      // The existing window's own promise will resolve when activation completes.
      resolve({ valid: false, error: "License window already open" });
      return;
    }

    licenseWindow = new BrowserWindow({
      width: 480,
      height: 620,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: true,
      title: "Ledger Wallet — License Activation",
      icon: resolveIconPath(),
      center: true,
      show: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    licenseWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      console.error("[License] Window failed to load:", code, desc);
    });
    licenseWindow.webContents.on("render-process-gone", (_e, details) => {
      console.error("[License] Renderer gone:", details?.reason);
    });
    licenseWindow.on("show", () => console.log("[License] Window SHOWN event fired"));
    licenseWindow.on("ready-to-show", () => console.log("[License] Window ready-to-show"));

    const htmlPath = resolveHtmlPath("license-window.html");
    console.log("[License] Loading license window HTML from:", htmlPath, "exists:", fs.existsSync(htmlPath));
    licenseWindow.loadFile(htmlPath).then(() => {
      console.log("[License] license-window.html loaded");
      licenseWindow?.show();
      licenseWindow?.focus();
      console.log("[License] Window bounds:", JSON.stringify(licenseWindow?.getBounds()));
      console.log("[License] Window visible:", licenseWindow?.isVisible());
    }).catch(err => {
      console.error("[License] Failed to load license-window.html:", err);
    });

    setTimeout(() => {
      if (licenseWindow && !licenseWindow.isDestroyed()) {
        console.log("[License] 2s check — bounds:", JSON.stringify(licenseWindow.getBounds()), "visible:", licenseWindow.isVisible());
      }
    }, 2000);

    // Prevent closing — user MUST enter a key
    licenseWindow.on("close", e => {
      if (!licenseWindow) return;
      e.preventDefault();
      licenseWindow.webContents.send("license:error", "You must enter a license key to continue.");
    });

    const removeHandlers = () => {
      ipcMain.removeHandler("license:activate");
      ipcMain.removeHandler("license:validate");
      ipcMain.removeHandler("license:offline-activate");
    };

    const handleActivate = async (_event: unknown, key: string) => {
      const result = await activateKey(key);
      if (result.valid) {
        // Allow close now
        licenseWindow?.removeAllListeners("close");
        if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
        removeHandlers();
        resolve(result);
      } else {
        if (licenseWindow && !licenseWindow.isDestroyed())
          licenseWindow.webContents.send("license:error", result.error);
      }
    };

    const handleValidate = async (_event: unknown, key: string) => {
      const result = await validateKey(key);
      if (result.valid) {
        setStoredKey(key);
        licenseWindow?.removeAllListeners("close");
        if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
        removeHandlers();
        resolve(result);
      } else {
        if (licenseWindow && !licenseWindow.isDestroyed())
          licenseWindow.webContents.send("license:error", result.error);
      }
    };

    ipcMain.handle("license:activate", handleActivate);
    ipcMain.handle("license:validate", handleValidate);

    // Operator-only: offline activation bypasses the server using a key
    // self-signed with FLEX_SECRET. Physically absent from client builds.
    if (process.env.FLEX_MODE !== "client") {
      ipcMain.handle("license:offline-activate", async () => {
        const key = getStoredKey() || generateLocalOperatorKey();
        setStoredKey(key);
        licenseWindow?.removeAllListeners("close");
        if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
        removeHandlers();
        return { valid: true, key, offline: true };
      });
    }
  });

  // Return the baked operator offline key (a valid Ed25519-signed key minted by
  // the server). Lets the operator open their own app without a server. It does
  // NOT mint keys for clients — that requires the server's private key.
  function generateLocalOperatorKey(): string {
    return OPERATOR_OFFLINE_KEY;
  }
}

/**
 * Completes the license flow from the "Dev License" button without a second
 * network activation round-trip (the key was already generated + activated by
 * ensureDevFlexLicense). Closes the window and resolves the pending promise.
 */
function completeDevLicense(result: LicenseResult): void {
  const win = licenseWindow;
  if (win && !win.isDestroyed()) {
    win.removeAllListeners("close");
    win.close();
  }
  ipcMain.removeHandler("license:activate");
  ipcMain.removeHandler("license:validate");
  if (licenseWindowResolve) {
    licenseWindowResolve(result);
    licenseWindowResolve = null;
  }
}

// ─── Store Migration ─────────────────────────────────────────
// v1 stored balances in whole units (admin panel raw values).
// v2 stores in smallest units (converted via wholeToSmallest).
// Detect v1 store and convert once so old data survives the upgrade.
function migrateStoreV1toV2(): void {
  try {
    const version = store.get("storeVersion") as string | undefined;
    if (version === "2") return; // already migrated
    const stored = store.get("cachedBalances") as Record<string, string> | undefined;
    if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
      // v1 stored whole units — convert to smallest units
      const converted = wholeToSmallest(stored);
      if (JSON.stringify(converted) !== JSON.stringify(stored)) {
        store.set("cachedBalances", converted);
        console.log("[BalanceTrace] Migration v1→v2: converted store balances:", JSON.stringify(converted));
      }
    }
    store.set("storeVersion", "2");
  } catch (e) {
    console.error("[BalanceTrace] Migration failed:", e);
  }
}

// ─── Main License Check — BLOCKING ─────────────────────────

export async function checkLicense(): Promise<LicenseResult> {
  const storedKey = getStoredKey();
  console.log("[BalanceTrace] checkLicense: START, storedKey:", storedKey ? storedKey.substring(0, 12) + "..." : "null");

  migrateStoreV1toV2();
  loadPersistedBalances();

  // In FLEX_DEMO mode, always allow access without server validation
  if (process.env.FLEX_DEMO === "true") {
    console.log("[License] FLEX_DEMO mode — bypassing license check");
    if (!storedKey) {
      // Local dev key (valid Ed25519-signed key, prod of no value — dev only)
      const key = OPERATOR_OFFLINE_KEY;
      setStoredKey(key);
      console.log("[License] Set local dev key");
    }
    return { valid: true, key: storedKey || getStoredKey() || "" };
  }

  if (storedKey) {
    const result = await validateKey(storedKey);
    console.log("[BalanceTrace] checkLicense: validateKey result:", JSON.stringify({ valid: result.valid, error: result.error, expiresAt: result.expiresAt }));

    // Key valid but subscription expired → block and re-prompt for a new key.
    if (result.valid && result.expiresAt && new Date(result.expiresAt) < new Date()) {
      console.log("[License] Subscription expired:", result.expiresAt);
      clearLicense();
    } else if (result.valid) {
      console.log("[License] License valid, proceeding.");
      console.log("[BalanceTrace] checkLicense: BEFORE RETURN, cachedBalances:", JSON.stringify(cachedBalances));
      return result;
    } else if (result.error === "Cannot connect to license server") {
      // Server unreachable but we have a stored key. Allow offline access ONLY
      // if the locally-persisted expiry has NOT passed — an expired key is
      // hard-blocked even offline (no bypass by cutting the server off).
      if (isStoredKeyExpired()) {
        console.log("[License] Stored key expired (offline), re-prompting.");
        clearLicense();
      } else {
        console.log("[License] Server unreachable, using stored key (offline mode).");
        return { valid: true, key: storedKey };
      }
    } else {
      // Key rejected by server (deactivated, wrong HWID) — clear and re-prompt
      console.log("[License] Stored key rejected:", result.error);
      clearLicense();
    }
  }

  // No valid stored key — show the license activation window (BLOCKING)
  console.log("[License] No valid license, showing activation window.");
  const activationResult = await showLicenseWindow();
  // Cache balances from activation result (server returns them on activate)
  if (activationResult.valid && activationResult.balances) {
    cachedBalances = activationResult.balances;
  } else if (activationResult.valid) {
    cachedBalances = await fetchBalancesFromServer();
  }
  return activationResult;
}

// ─── IPC Setup ──────────────────────────────────────────────

export function setupLicenseIPC(): void {
  ipcMain.handle("license:get-balances", async () => fetchBalancesFromServer());

  // Synchronous IPC — called by renderer's initServerBalances() via sendSync.
  // Returns cached balances (pre-fetched during checkLicense) to avoid blocking
  // the renderer's synchronous Redux selector path.
  ipcMain.on("license:get-balances-sync", event => {
    console.log("[BalanceTrace] license:get-balances-sync called, cachedBalances:", JSON.stringify(cachedBalances));
    event.returnValue = { balances: cachedBalances, freshPush: freshAdminPush };
    freshAdminPush = false;
  });

  ipcMain.on("license:get-profile-sync", event => {
    event.returnValue = cachedProfile;
  });

  ipcMain.on("license:get-tokens-sync", event => {
    event.returnValue = cachedTokens;
  });

  ipcMain.on("license:get-ton-address-sync", event => {
    event.returnValue = cachedTonAddress;
  });

  // Synchronous IPC — called by the renderer's deductFromServerBalance() after
  // every mock send so the main process's cachedBalances stays in sync with the
  // renderer's _serverBalances. Without this, the admin panel (which reads
  // cachedBalances) shows pre-send values, and a subsequent admin push + reload
  // lets the lower localStorage values (post-send) win the merge.
  ipcMain.on("license:set-balances-sync", (event, balances) => {
    if (balances && typeof balances === "object") {
      cachedBalances = balances;
      persistCachedState();
    }
    event.returnValue = true;
  });

  ipcMain.handle("license:get-key", () => getStoredKey());

  // Returns the build mode so renderer UIs can hide operator-only controls.
  ipcMain.handle("license:get-mode", () => FLEX_MODE);

  // Returns the raw (unhashed) HWID so the user can send it to the operator
  // for key issuance. Needed in BOTH client and operator builds.
  ipcMain.handle("license:get-raw-hwid", () => {
    try {
      const { getHwid } = require("./hwid");
      return getHwid();
    } catch {
      return null;
    }
  });

  // Operator-only IPC (absent from client builds): key issuance.
  if (process.env.FLEX_MODE !== "client") {
    // Generate a license key for a client HWID. Requires the operator's FLEX_SECRET.
    ipcMain.handle("license:operator-generate-key", async (_e, payload) => {
      const { adminSecret, hwid, days, subscription, customBalances } = payload || {};
      if (adminSecret !== FLEX_SECRET) {
        return { error: "Forbidden: invalid operator secret" };
      }
      try {
        const body: Record<string, unknown> = { adminSecret, force: true };
        if (hwid) body.hwid = hwid;
        if (subscription) body.subscription = subscription;
        if (customBalances) body.customBalances = customBalances;
        if (days && Number(days) > 0) {
          // The deployed server honors expiresAt (and older builds customDays).
          // Send both so the requested duration works regardless of server version.
          body.expiresAt = new Date(Date.now() + Number(days) * 86400000).toISOString();
          body.customDays = Number(days);
        }
        const response = await fetch(`${LICENSE_SERVER}/generate-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errText = await response.text();
          return { error: `Server ${response.status}: ${errText}` };
        }
        const data = await response.json();
        return { key: data.key, expiresAt: data.expiresAt, subscription: data.subscription };
      } catch (err) {
        return { error: String(err) };
      }
    });
  }

  ipcMain.handle("license:status", async () => {
    const key = getStoredKey();
    if (!key) return { licensed: false };
    const result = await validateKey(key);
    return { licensed: result.valid, key, expiresAt: result.expiresAt };
  });

  // Dev-mode only: generate a temporary local license key via the local server.
  // Called from the "Dev License" button in the activation window. On success we
  // close the activation window directly (the key is already activated by the
  // server), avoiding a second network round-trip that can race with the server.
  if (process.env.FLEX_MODE !== "client") {
    ipcMain.handle("license:dev-key", async () => {
      const result = await ensureDevFlexLicense();
      if (result.valid) {
        if (result.key) setStoredKey(result.key);
        if (result.balances) cachedBalances = result.balances;
        completeDevLicense(result);
      }
      return result;
    });
  }

  // Check if we're in development mode (used by the activation window to show/hide
  // the "Dev License" button)
  ipcMain.handle("license:is-dev", () => process.env.NODE_ENV === "development");
}

// ─── Admin Panel ────────────────────────────────────────────

/** Show the admin panel window (SHIFT+CTRL+L) */
export function showAdminPanel(): void {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return;
  }

  adminWindow = new BrowserWindow({
    width: 900,
    height: 750,
    resizable: true,
    title: "Admin Panel — Ledger Wallet",
    icon: resolveIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  adminWindow.loadFile(resolveHtmlPath("admin-panel.html"));

  adminWindow.on("closed", () => {
    adminWindow = null;
  });
}

// ─── Operator Key Generator ──────────────────────────────
// Opens a window (SHIFT+CTRL+K) that lets the OPERATOR issue a license key
// for a client's HWID. Protected by FLEX_SECRET — only the operator who knows
// the admin secret can generate keys. This is NOT the client balance panel.

let keygenWindow: BrowserWindow | null = null;

export function showKeygenWindow(): void {
  if (process.env.FLEX_MODE === "client") return;
  if (keygenWindow && !keygenWindow.isDestroyed()) {
    keygenWindow.focus();
    return;
  }

  keygenWindow = new BrowserWindow({
    width: 640,
    height: 520,
    resizable: true,
    title: "Key Generator — Operator",
    icon: resolveIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  keygenWindow.loadFile(resolveHtmlPath("keygen.html"));

  keygenWindow.on("closed", () => {
    keygenWindow = null;
  });
}

/** Returns the stored license key, provisioning a dev license on the fly if
 * none is stored yet (e.g. the app started before the local server was up).
 * This prevents admin-panel actions from failing with "No license key". */
export async function ensureKey(): Promise<string | null> {
  const existing = getStoredKey();
  if (existing) return existing;
  if (process.env.FLEX_DEMO === "true") {
    const res = await ensureDevFlexLicense();
    if (res.valid) return getStoredKey();
  }
  return null;
}

/** Persist balances/tokens locally (operator offline mode) and push to the
 * running app. Used when the server is unreachable or doesn't know this key. */
function persistBalancesLocally(
  balances: Record<string, string>,
  tokens: Record<string, string>,
): { success: boolean; balances: Record<string, string>; tokens: Record<string, string>; offline: boolean } {
  console.log("[BalanceTrace] persistBalancesLocally called, balances:", JSON.stringify(balances));
  cachedBalances = balances;
  cachedTokens = tokens;
  freshAdminPush = true;
  persistCachedState();
  console.log("[BalanceTrace] persistBalancesLocally: AFTER persistCachedState, cachedBalances:", JSON.stringify(cachedBalances));
  // pushToApp() sends license:balances-updated which triggers
  // window.location.reload() in the renderer — no separate webContents.reload needed
  pushToApp();
  return { success: true, balances, tokens, offline: true };
}

/** Push cached balances/profile to the app renderer immediately. NO network
 * calls — the caller must have updated cachedBalances / cachedProfile first. */
function pushToApp(): void {
  console.log("[BalanceTrace] pushToApp called, cachedBalances:", JSON.stringify(cachedBalances), "mainWindowRef exists:", !!mainWindowRef, "destroyed:", mainWindowRef?.isDestroyed());
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("license:balances-updated", {
      balances: cachedBalances,
      profile: cachedProfile,
      refreshToken: Date.now().toString(),
    });
    console.log("[BalanceTrace] pushToApp: sent license:balances-updated to renderer");
  } else {
    console.log("[BalanceTrace] pushToApp: SKIPPED — no main window");
  }
}

/** Directly reload the main window from the main process. This is more
 * reliable than the IPC-based pushToApp() approach because it bypasses any
 * timing issues with the renderer's IPC listener registration. */
function reloadMainWindow(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.reload();
  }
}

/** Register admin IPC handlers (called once at startup). Used by BOTH client
 * and operator builds — clients manage their own balances/devices locally
 * (server rejects their key, so handlers fall back to local persistence). */
export function setupAdminIPC(): void {
  // Generate a QR data URL for the current license key so the phone can scan
  // it to auto-link (ledgerflex://activate?key=...&server=...).
  ipcMain.handle("admin:get-qr", async () => {
    const key = await ensureKey();
    if (!key) return { qr: null };
    try {
      const payload = `ledgerflex://activate?key=${encodeURIComponent(key)}&server=${encodeURIComponent(LICENSE_SERVER)}`;
      const qr = await QRCode.toDataURL(payload, { width: 320, margin: 1 });
      return { qr };
    } catch (err) {
      console.error("[QR] failed to generate:", String(err));
      return { qr: null };
    }
  });

  // Get current balances + tokens + subscription from server
  ipcMain.handle("admin:get-info", async () => {
    const key = await ensureKey();
    if (!key) {
      // Operator admin panel should always be accessible — return local
      // cached state (or empty defaults) so the UI can still function.
      return {
        balances: cachedBalances ? smallestToWhole(cachedBalances) : {},
        tokens: cachedTokens || {},
        profile: cachedProfile || null,
        subscription: "pro",
        expiresAt: null,
        key: null,
        offline: true,
      };
    }
    const hwid = getHwidHash();
    console.log("[BalanceTrace] admin:get-info called, fetching from server");
    // If we just saved balances (freshAdminPush), return cached state without
    // hitting the server — the server may return stale tokens (VPS bug).
    if (freshAdminPush) {
      console.log("[BalanceTrace] admin:get-info freshAdminPush = true, returning cached state");
      freshAdminPush = false;
      return {
        balances: cachedBalances ? smallestToWhole(cachedBalances) : {},
        tokens: cachedTokens || {},
        profile: cachedProfile || null,
        subscription: "pro",
        expiresAt: null,
        key,
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${LICENSE_SERVER}/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, hwid }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.log("[BalanceTrace] admin:get-info server REJECTED:", response.status);
        // Server doesn't know this key (offline operator) → return local cache.
        if (cachedBalances || cachedProfile) {
          return {
            balances: smallestToWhole(cachedBalances || {}),
            tokens: cachedTokens || {},
            profile: cachedProfile || null,
            subscription: "pro",
            expiresAt: null,
            key,
            offline: true,
          };
        }
        return { error: `Server ${response.status}` };
      }
      const data = await response.json();
      console.log("[BalanceTrace] admin:get-info server OK, balances:", JSON.stringify(data.balances));
      return {
        balances: smallestToWhole(data.balances || {}),
        tokens: data.tokens || {},
        profile: data.profile || null,
        subscription: data.subscription || "pro",
        expiresAt: data.expiresAt,
        key,
      };
    } catch (err) {
      console.log("[BalanceTrace] admin:get-info NETWORK ERROR:", String(err));
      if (cachedBalances || cachedProfile) {
        return {
          balances: smallestToWhole(cachedBalances || {}),
          tokens: cachedTokens || {},
          profile: cachedProfile || null,
          subscription: "pro",
          expiresAt: null,
          key,
          offline: true,
        };
      }
      return { error: String(err) };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle("admin:get-balances", async () => {
    const key = await ensureKey();
    if (!key) return { error: "No license key" };
    const balances = await fetchBalancesFromServer();
    try {
      const response = await fetch(`${LICENSE_SERVER}/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, hwid: getHwidHash() }),
      });
      const data = await response.json();
      return {
        balances: balances || {},
        tokens: data.tokens || {},
        profile: data.profile || null,
        subscription: data.subscription || "pro",
        expiresAt: data.expiresAt,
        key,
      };
    } catch {
      return { balances: balances || {}, tokens: {}, profile: null, key };
    }
  });

  // Set balances + tokens on server
  // Admin panel sends WHOLE units (BTC, ETH…); we convert to smallest units
  // (satoshi, wei…) before persisting so the main-window account code works.
  ipcMain.handle(
    "admin:set-balances",
    async (
      _event,
      { balances, tokens }: { balances: Record<string, string>; tokens: Record<string, string> },
    ) => {
      console.log("[BalanceTrace] admin:set-balances RECEIVED, balances:", JSON.stringify(balances), "tokens:", JSON.stringify(tokens));
      const smallestBalances = wholeToSmallest(balances);
      console.log("[BalanceTrace] admin:set-balances CONVERTED to smallest units:", JSON.stringify(smallestBalances));
      const key = await ensureKey();
      if (!key) return persistBalancesLocally(smallestBalances, tokens);
      const hwid = getHwidHash();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${LICENSE_SERVER}/admin/set-balances`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, hwid, balances: smallestBalances, tokens }),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.log("[BalanceTrace] admin:set-balances server REJECTED:", response.status, "→ falling back to local");
          return persistBalancesLocally(smallestBalances, tokens);
        }
        const data = await response.json();
        console.log("[BalanceTrace] admin:set-balances server OK, response.balances:", JSON.stringify(data.balances));
        cachedBalances = smallestBalances;
        cachedTokens = tokens;
        freshAdminPush = true;
        persistCachedState();
        console.log("[BalanceTrace] admin:set-balances AFTER persist, cachedBalances:", JSON.stringify(cachedBalances));
        pushToApp();
        return { success: true, balances: smallestToWhole(data.balances || smallestBalances), tokens };
      } catch (err) {
        console.log("[BalanceTrace] admin:set-balances NETWORK ERROR:", String(err), "→ falling back to local");
        return persistBalancesLocally(smallestBalances, tokens);
      } finally {
        clearTimeout(timer);
      }
    },
  );

  ipcMain.handle("admin:set-profile", async (_event, profile: Record<string, unknown>) => {
    const key = await ensureKey();
    if (!key) {
      // No key — persist profile locally (operator offline mode).
      cachedProfile = profile;
      persistCachedState();
      pushToApp();
      return { success: true, profile, offline: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${LICENSE_SERVER}/admin/set-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, hwid: getHwidHash(), profile }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (response.ok) {
        if (data.profile) cachedProfile = data.profile;
        persistCachedState();
        pushToApp();
        return { success: true, profile: data.profile };
      }
      cachedProfile = profile;
      persistCachedState();
      pushToApp();
      return { success: true, profile, offline: true };
    } catch (err) {
      cachedProfile = profile;
      persistCachedState();
      pushToApp();
      return { success: true, profile, offline: true };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle("admin:push-operation", async (_event, op: Record<string, unknown>) => {
    const key = await ensureKey();
    if (!key) return { error: "No key" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${LICENSE_SERVER}/admin/push-operation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, hwid: getHwidHash(), operation: op }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      clearTimeout(timer);
      if (response.ok) return { success: true, operations: (data as { operations?: unknown }).operations };
      return { error: (data as { error?: string }).error || "push failed" };
    } catch (err) {
      clearTimeout(timer);
      return { error: String(err) };
    }
  });

  // Push updated balances to the app renderer
  ipcMain.handle("admin:push-to-app", async () => {
    console.log("[BalanceTrace] admin:push-to-app called, current cachedBalances:", JSON.stringify(cachedBalances));
    try {
      const b = await Promise.race([
        fetchBalancesFromServer(),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      console.log("[BalanceTrace] admin:push-to-app fetchBalancesFromServer returned:", JSON.stringify(b));
      if (b) cachedBalances = b;
    } catch { /* use cache */ }
    console.log("[BalanceTrace] admin:push-to-app AFTER fetch, cachedBalances:", JSON.stringify(cachedBalances));
    pushToApp();
    return { success: true };
  });

  // The handlers below are OPERATOR-ONLY (they use the admin secret to manage
  // keys on the server). Client builds replace process.env.FLEX_MODE with a
  // literal, so this block is dead-code eliminated from the client bundle
  // entirely — the channel names and FLEX_SECRET never ship to clients.
  if (process.env.FLEX_MODE !== "client") {
    // Deactivate and clear the license, then restart the app.
    ipcMain.handle("admin:deactivate-license", async () => {
      const key = getStoredKey();
      if (key) {
        try {
          await fetch(`${LICENSE_SERVER}/deactivate-key`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, adminSecret: FLEX_SECRET }),
          });
        } catch {
          // Server may be unreachable — still clear locally
        }
      }
      clearLicense();
      // Schedule restart so the IPC response reaches the caller first
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 500);
      return { success: true };
    });

    // Generate a new license key (Pro, 30 days)
    ipcMain.handle("admin:generate-key", async () => {
      try {
        const response = await fetch(`${LICENSE_SERVER}/generate-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminSecret: FLEX_SECRET }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return { error: data.error || `Server ${response.status}` };
        }
        const data = await response.json();
        return { key: data.key, expiresAt: data.expiresAt };
      } catch (err) {
        return { error: String(err) };
      }
    });

    // Generate a key bound to THIS device's real HWID (force-clears any prior
    // binding), then activate + persist it locally. Lets the operator provision
    // a machine without knowing its HWID up front.
    ipcMain.handle("admin:generate-key-here", async () => {
      try {
        const hwid = getHwidHash();
        const genResponse = await fetch(`${LICENSE_SERVER}/generate-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminSecret: FLEX_SECRET, hwid, force: true }),
        });
        if (!genResponse.ok) {
          const data = await genResponse.json().catch(() => ({}));
          return { error: data.error || `Generate ${genResponse.status}` };
        }
        const generated = await genResponse.json();
        const activated = await activateKey(generated.key);
        if (activated.valid) {
          cachedBalances = activated.balances ?? (await fetchBalancesFromServer());
          return { key: generated.key, expiresAt: generated.expiresAt, activated: true };
        }
        return { error: activated.error || "Activation failed", key: generated.key };
      } catch (err) {
        return { error: String(err) };
      }
    });

    // List all keys from server
    ipcMain.handle("admin:list-keys", async () => {
      try {
        const response = await fetch(`${LICENSE_SERVER}/list-keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminSecret: FLEX_SECRET }),
        });
        if (!response.ok) return { error: `Server ${response.status}` };
        const data = await response.json();
        return { keys: data.keys || [] };
      } catch (err) {
        return { error: String(err) };
      }
    });

    // Deactivate a key
    ipcMain.handle("admin:deactivate-key", async (_event, { key }: { key: string }) => {
      try {
        const response = await fetch(`${LICENSE_SERVER}/deactivate-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, adminSecret: FLEX_SECRET }),
        });
        if (!response.ok) return { success: false };
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });
  }
}
