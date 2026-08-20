#!/usr/bin/env node
/**
 * Mobile PWA server for the iOS/Android FLEX build.
 *
 * Serves the browser bundle from dist-web/ and proxies /api/* to the
 * license server (server/index.js, port 9000) so the PWA and the license
 * server can live on the same origin.
 *
 * Usage:
 *   node server/mobile-server.js            # port 8081, API → http://localhost:9000
 *   PORT=8090 node server/mobile-server.js  # custom port
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..", "dist-web");
const MOBILE_ROOT = path.resolve(__dirname, "..", "web", "mobile");
const PORT = Number(process.env.PORT || 8081);
const API_TARGET = process.env.API_TARGET || "http://localhost:9000";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".lottie": "application/octet-stream",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".map": "application/json",
};

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  let root = ROOT;
  let fallback = "app.html";

  if (p === "/mobile" || p.startsWith("/mobile/")) {
    root = MOBILE_ROOT;
    fallback = "index.html";
    p = p.replace(/^\/mobile/, "") || "/";
  }
  if (p === "/") p = "/index.html";

  let file = path.join(root, p);
  if (!file.startsWith(root)) return send(res, 403, "Forbidden");

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  if (!fs.existsSync(file)) {
    // SPA fallback per root
    file = path.join(root, fallback);
    if (!fs.existsSync(file)) return send(res, 404, "Not found");
    return send(res, 200, fs.readFileSync(file), MIME[".html"]);
  }

  const type = MIME[path.extname(file)] || "application/octet-stream";
  const cache = /\.(js|css|png|svg|woff2?|webp|jpg|webm|mp4|lottie|map)$/.test(path.extname(file))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
  fs.createReadStream(file).pipe(res);
}

function proxyApi(req, res) {
  const target = new URL(API_TARGET);
  const upstreamPath = req.url.replace(/^\/api/, "");
  const out = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: upstreamPath,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    upstream => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    },
  );
  out.on("error", () => send(res, 502, JSON.stringify({ error: "License server unreachable" }), "application/json"));
  req.pipe(out);
}

const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith("/api/")) return proxyApi(req, res);
    return serveStatic(req, res);
  } catch (err) {
    console.error("[mobile-server]", err);
    try { send(res, 500, "Internal error"); } catch (_) {}
  }
});

function lanAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mobile-server] Serving dist-web on http://0.0.0.0:${PORT}`);
  console.log(`[mobile-server] API proxy → ${API_TARGET}`);
  console.log(`[mobile-server] LAN addresses: ${lanAddresses().map(a => `http://${a}:${PORT}`).join(", ")}`);
  console.log(`[mobile-server] On your iPhone open one of the URLs above in Safari, then "Share → Add to Home Screen".`);
});
