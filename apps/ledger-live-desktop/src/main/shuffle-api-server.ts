/**
 * Shuffle / Casino HTTP API Server
 *
 * Listens on localhost:56237 for requests from the browser extension.
 * All crypto values are in smallest units.
 * All fiat values are in USD cents (integer).
 *
 * Endpoints:
 *   GET  /api/ping                 → { ok: true }
 *   GET  /api/address?currency=    → { address }
 *   GET  /api/balance              → { crypto, fiat, vault }
 *   POST /api/balance/set          → { success, fiat, vault }
 *   POST /api/deposit              → { success, txid, fiatBalance }
 *   POST /api/withdraw             → { success, txid, fiatBalance }
 *   POST /api/device/approve       → { approved, txid }
 */

import { BrowserWindow } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as url from "url";

let server: http.Server | null = null;
let mainWin: BrowserWindow | null = null;

let _fiatBalance = 100000000; // $1,000,000
let _vaultBalance = 0;

// Payments the user sent from the Ledger app. The extension matches the
// address against a pending bitrefill invoice to mark it paid.
interface BitrefillPayment {
  address: string;
  amount: number;
  currency: string;
  timestamp: number;
}
const _bitrefillPayments: BitrefillPayment[] = [];

// Payments the user sent from the Ledger app to a shuffle.com deposit address.
// The extension polls this list and turns each new payment into a native
// pending → received deposit flow on the site.
interface ShufflePayment {
  address: string;
  amount: string;
  currency: string;
  timestamp: number;
}
const _shufflePayments: ShufflePayment[] = [];

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function randHex(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function randBase58(n: number): string {
  let r = "";
  const bytes = crypto.randomBytes(n);
  for (const b of bytes) r += BASE58_CHARS[b % 58];
  return r;
}

function generateAddress(currencyTicker: string): string {
  const t = (currencyTicker || "BTC").toUpperCase();
  const addrGen: Record<string, () => string> = {
    BTC: () => "bc1q" + randBase58(32),
    ETH: () => "0x" + randHex(40),
    MATIC: () => "0x" + randHex(40),
    SOL: () => randBase58(44),
    LTC: () => "L" + randBase58(33),
    BCH: () => "q" + randBase58(42),
    DOGE: () => "D" + randBase58(33),
    XRP: () => "r" + randBase58(33),
    ADA: () => "addr1" + randBase58(58),
    DOT: () => "1" + randBase58(45),
    TRX: () => "T" + randBase58(33),
    XLM: () => "G" + randBase58(55),
    ATOM: () => "cosmos1" + randBase58(38),
    NEAR: () => randBase58(42) + ".near",
    APT: () => "0x" + randHex(64),
    ALGO: () => randBase58(58),
    XTZ: () => "tz1" + randBase58(33),
    FIL: () => "f1" + randBase58(40),
    ICP: () => randBase58(58).toLowerCase() + "-" + randBase58(5).toLowerCase() + "-" + randBase58(5).toLowerCase(),
    HBAR: () => "0.0." + Math.floor(Math.random() * 9000000 + 1000000),
    KAS: () => "kaspa:" + randBase58(62),
    INJ: () => "inj1" + randBase58(38),
    SUI: () => "0x" + randHex(64),
    STX: () => "SP" + randBase58(38),
    FLOW: () => "0x" + randHex(16),
    EOS: () => randBase58(12).toLowerCase(),
    IOTA: () => "iota1" + randBase58(58),
    ZIL: () => "zil1" + randBase58(38),
    SEI: () => "sei1" + randBase58(38),
    XMR: () => "4" + randBase58(95),
  };
  return (addrGen[t] || addrGen.BTC)();
}

const PORT = 56237;

export function setMainWindowForShuffle(win: BrowserWindow | null): void {
  mainWin = win;
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data);
  }
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shuffle-Token",
  });
  res.end(body);
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", (c: string) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

async function dispatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = url.parse(req.url || "", true);
  const path = parsed.pathname || "";
  const method = (req.method || "GET").toUpperCase();
  const query = parsed.query as Record<string, string>;

  try {
    switch (true) {
      // ── Health ──
      case method === "GET" && path === "/api/ping":
        return json(res, { ok: true, timestamp: Date.now() });

      // ── Address ──
      case method === "GET" && path === "/api/address":
        return handleGetAddress(res, query);

      // ── Balance ──
      case method === "GET" && path === "/api/balance":
        return handleGetBalance(res);

      case method === "POST" && path === "/api/balance/set":
        return handleSetBalance(res, await parseBody(req));

      // ── Deposit ──
      case method === "POST" && path === "/api/deposit":
        return handleDeposit(res, await parseBody(req));

      // ── Withdraw ──
      case method === "POST" && path === "/api/withdraw":
        return handleWithdraw(res, await parseBody(req));

      // ── Device approve ──
      case method === "POST" && path === "/api/device/approve":
        return json(res, { approved: true, txid: `tx-${Date.now()}` });

      // ── Bitrefill payments (sent from the Ledger app) ──
      case method === "POST" && path === "/api/bitrefill/payment":
        return handleBitrefillPayment(res, await parseBody(req));

      case method === "GET" && path === "/api/bitrefill/payments":
        return json(res, { payments: _bitrefillPayments });

      // ── Shuffle payments (sent from the Ledger app) ──
      case method === "POST" && path === "/api/shuffle/payment":
        return handleShufflePayment(res, await parseBody(req));

      case method === "GET" && path === "/api/shuffle/payments":
        return json(res, { payments: _shufflePayments });

      // ── Fake Etherscan transaction page ──
      case method === "GET" && path === "/etherscan":
        return handleEtherscan(res, query);

      default:
        return json(res, { error: "Not found" }, 404);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, { error: msg }, 500);
  }
}

// ─── Handlers ────────────────────────────────────────────────

async function handleGetAddress(
  res: http.ServerResponse,
  query: Record<string, string>,
): Promise<void> {
  const currencyId = (query.currency || "bitcoin").toLowerCase();
  const tickerMap: Record<string, string> = {
    bitcoin: "BTC",
    ethereum: "ETH",
    solana: "SOL",
    litecoin: "LTC",
    dogecoin: "DOGE",
    polkadot: "DOT",
    cardano: "ADA",
    ripple: "XRP",
    tron: "TRX",
    stellar: "XLM",
    cosmos: "ATOM",
    near: "NEAR",
    aptos: "APT",
    algorand: "ALGO",
    tezos: "XTZ",
    filecoin: "FIL",
    "internet-computer": "ICP",
    hedera: "HBAR",
    kaspa: "KAS",
    injective: "INJ",
    sui: "SUI",
    stacks: "STX",
    flow: "FLOW",
    eos: "EOS",
    iota: "IOTA",
    zilliqa: "ZIL",
    sei: "SEI",
    monero: "XMR",
    bitcoin_cash: "BCH",
    polygon: "MATIC",
    avalanche: "AVAX",
    arbitrum: "ARB",
    optimism: "OP",
    celo: "CELO",
    fantom: "FTM",
    cronos: "CRO",
    vechain: "VET",
    theta: "THETA",
    render: "RNDR",
    aave: "AAVE",
    maker: "MKR",
    uniswap: "UNI",
    chainlink: "LINK",
    graph: "GRT",
    decred: "DCR",
    dash: "DASH",
    zcash: "ZEC",
  };
  const ticker = tickerMap[currencyId] || "BTC";
  const address = generateAddress(ticker);
  json(res, { address });
}

async function handleGetBalance(res: http.ServerResponse): Promise<void> {
  json(res, {
    crypto: {}, // renderer sends update via shuffle:crypto-balances
    fiat: _fiatBalance,
    vault: _vaultBalance,
  });
}

async function handleSetBalance(
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  if (typeof body.fiat === "number") _fiatBalance = body.fiat;
  if (typeof body.vault === "number") _vaultBalance = body.vault;
  notifyRenderer("shuffle:balance-updated", {
    fiat: _fiatBalance,
    vault: _vaultBalance,
  });
  json(res, { success: true, fiat: _fiatBalance, vault: _vaultBalance });
}

async function handleDeposit(
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  const amount = Number(body.amount) || 0; // USD cents
  if (amount <= 0) return json(res, { error: "Invalid amount" }, 400);

  _fiatBalance += amount;
  const txid = `dep-${Date.now().toString(36)}`;

  notifyRenderer("shuffle:deposit", {
    currencyId: (body.currency as string) || "bitcoin",
    cryptoAmount: String(body.cryptoAmount || "0"),
    txid,
  });

  json(res, { success: true, txid, fiatBalance: _fiatBalance });
}

async function handleWithdraw(
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  const amount = Number(body.amount) || 0; // USD cents
  if (amount <= 0 || amount > _fiatBalance) {
    return json(res, { error: "Invalid amount" }, 400);
  }

  _fiatBalance -= amount;
  const txid = `wd-${Date.now().toString(36)}`;

  notifyRenderer("shuffle:withdraw", {
    currencyId: body.currency || "bitcoin",
    cryptoAmount: String(body.cryptoAmount || "0"),
    txid,
  });

  json(res, { success: true, txid, fiatBalance: _fiatBalance });
}

async function handleBitrefillPayment(
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  const address = String(body.address || "").trim();
  if (!address) return json(res, { error: "Missing address" }, 400);

  _bitrefillPayments.push({
    address,
    amount: Number(body.amount) || 0,
    currency: String(body.currency || "ETH"),
    timestamp: Date.now(),
  });

  json(res, { success: true, payments: _bitrefillPayments.length });
}

async function handleShufflePayment(
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  const address = String(body.address || "").trim();
  if (!address) return json(res, { error: "Missing address" }, 400);

  const payment: ShufflePayment = {
    address,
    amount: String(body.amount != null ? body.amount : "0"),
    currency: String(body.currency || "ETH"),
    timestamp: Date.now(),
  };
  _shufflePayments.push(payment);

  // Push the payment to any renderer so the app can surface it too.
  notifyRenderer("shuffle:deposit", {
    currencyId: String(body.currency || "ethereum"),
    cryptoAmount: payment.amount,
    txid: `sh-${Date.now().toString(36)}`,
  });

  json(res, { success: true, payments: _shufflePayments.length });
}

async function handleEtherscan(
  res: http.ServerResponse,
  query: Record<string, string>,
): Promise<void> {
  const filePath = "C:\\Users\\user\\Desktop\\Новая папка\\Новая папка\\etherscan\\index.html";
  try {
    const html = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(html);
  } catch {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><body><h2>Etherscan page not found</h2><p>Expected at: ${filePath}</p></body></html>`);
  }
}

// ─── Lifecycle ───────────────────────────────────────────────

export function startShuffleApiServer(): void {
  if (server) return;

  server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Shuffle-Token",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }
    dispatch(req, res);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[ShuffleAPI] Server on 127.0.0.1:${PORT}`);
  });
  server.on("error", (err: Error) => {
    console.error("[ShuffleAPI] Error:", err);
  });
}

export function stopShuffleApiServer(): void {
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
}
