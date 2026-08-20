#!/usr/bin/env node
/**
 * Bundles the `qrcode` npm package (browser entry) into a single UMD file
 * consumed by the mobile PWA (web/mobile/js/qrcode.min.js).
 *
 * Usage:
 *   node ./tools/build-mobile-qr.js
 */

const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "production";

const { rspack } = require("@rspack/core");

const appRoot = path.resolve(__dirname, "..");
const store = path.resolve(appRoot, "..", "..", "node_modules", ".pnpm");
const qrDir = fs
  .readdirSync(store)
  .filter(d => d.startsWith("qrcode@") && !d.includes("+"))
  .sort()
  .pop();
if (!qrDir) {
  console.error("qrcode package not found in pnpm store");
  process.exit(1);
}
const qrPkg = path.resolve(store, qrDir, "node_modules", "qrcode");

const outDir = path.join(appRoot, "web", "mobile", "js");
fs.mkdirSync(outDir, { recursive: true });

const entry = path.join(outDir, "_qr-entry.js");
fs.writeFileSync(
  entry,
  `const QRCode = require(${JSON.stringify(qrPkg)});\nmodule.exports = QRCode;\n`,
);

const config = {
  name: "qr",
  target: "web",
  mode: "production",
  entry,
  output: {
    path: outDir,
    filename: "qrcode.min.js",
    library: { type: "umd", name: "QRCode" },
    globalObject: "this",
  },
  optimization: { minimize: true },
  devtool: false,
};

rspack(config, (err, stats) => {
  fs.rmSync(entry, { force: true });
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const info = stats.toJson({ errors: true, warnings: true });
  if (stats.hasErrors()) {
    for (const e of info.errors) console.error("❌", e.message.slice(0, 800));
    process.exit(1);
  }
  const size = fs.statSync(path.join(outDir, "qrcode.min.js")).size;
  console.log(`✅ qrcode.min.js (${(size / 1024).toFixed(1)} KB) → web/mobile/js/`);
});
