import path from "path";
import fs from "fs";
import { rspack, type RspackOptions } from "@rspack/core";
import { rootFolder, commonConfig } from "./rspack.common";
import {
  buildRendererEnv,
  buildDotEnvDefine,
  DOTENV_FILE,
  getRsdoctorPlugin,
} from "./utils";
import { createRendererConfig } from "./rspack.renderer";

/**
 * Locate a package inside the pnpm store (node_modules/.pnpm/<name>@<version>).
 * pnpm does not hoist transitive deps to the app's node_modules, so we resolve
 * browser polyfills directly from the store. Returns the newest matching dir so
 * we get the most modern API surface for the polyfill.
 */
function parseStoreVersion(d: string): [number, number, number] {
  const m = d.match(/@(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function pnpmPkg(pkgName: string, file: string): string {
  const store = path.resolve(rootFolder, "..", "..", "node_modules", ".pnpm");
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(store).filter(d => d.startsWith(`${pkgName}@`));
  } catch {
    dirs = [];
  }
  dirs.sort((a, b) => {
    const [amaj, amin, apat] = parseStoreVersion(a);
    const [bmaj, bmin, bpat] = parseStoreVersion(b);
    return bmaj - amaj || bmin - amin || bpat - apat;
  });
  const dir = dirs[0];
  if (!dir) {
    throw new Error(`pnpm package not found in store: ${pkgName}`);
  }
  const pkgRoot = path.resolve(store, dir, "node_modules", pkgName);
  if (file && fs.existsSync(path.resolve(pkgRoot, file))) {
    return path.resolve(pkgRoot, file);
  }
  const pkgJson = path.resolve(pkgRoot, "package.json");
  try {
    const main: string | undefined = JSON.parse(fs.readFileSync(pkgJson, "utf8")).main;
    if (typeof main === "string" && main) {
      return path.resolve(pkgRoot, main);
    }
  } catch {
    // fall through to index.js
  }
  return path.resolve(pkgRoot, "index.js");
}

/**
 * Creates the rspack configuration for the browser build of the FLEX_DEMO
 * renderer (iOS PWA). Same source as the Electron renderer, but:
 *   - target "web" (no ElectronTargetPlugin / node runtime)
 *   - the `electron` module is aliased to a browser shim
 *   - node built-ins are polyfilled via the pnpm store
 *   - the HTML template is the PWA shell (web/app.html)
 */
export function createWebConfig(mode: "development" | "production"): RspackOptions {
  const isDev = mode === "development";
  const renderer = createRendererConfig(mode, { devServer: false });

  // In production the Electron renderer emits `.json` files under `src/` as
  // assets loaded via `__non_webpack_require__` (animationJsonLoader.cjs). The
  // browser build has no Node `require`, so drop that rule and let rspack's
  // default handler inline the JSON modules instead.
  const jsonAssetLoader = path.resolve(__dirname, "animationJsonLoader.cjs");
  const rendererRules = renderer.module?.rules || [];
  const webRules = rendererRules.filter(rule => {
    const r = rule as { test?: RegExp; use?: Array<{ loader?: string } | string> };
    if (r.test instanceof RegExp && r.test.test("x.json")) {
      const uses = Array.isArray(r.use) ? r.use : [];
      const usesJsonLoader = uses.some(u => (typeof u === "string" ? u : u.loader) === jsonAssetLoader);
      if (usesJsonLoader) return false;
    }
    return true;
  });

  const electronShim = path.resolve(rootFolder, "src", "renderer", "web", "electron-shim.ts");
  const electronStoreShim = path.resolve(rootFolder, "src", "renderer", "web", "electron-store-shim.ts");
  const nodeHttpStub = path.resolve(rootFolder, "src", "renderer", "web", "node-http-stub.ts");
  const nodeOsStub = path.resolve(rootFolder, "src", "renderer", "web", "node-os-stub.ts");
  const webTemplate = path.resolve(rootFolder, "web", "app.html");

  const processPolyfill = pnpmPkg("process", "browser.js");
  const bufferPolyfill = pnpmPkg("buffer", "index.js");
  const pathPolyfill = pnpmPkg("path-browserify", "index.js");
  const streamPolyfill = pnpmPkg("stream-browserify", "index.js");
  const eventsPolyfill = pnpmPkg("events", "events.js");
  const utilPolyfill = pnpmPkg("util", "util.js");
  const assertPolyfill = pnpmPkg("assert", "assert.js");
  const cryptoPolyfill = pnpmPkg("crypto-browserify", "index.js");
  const urlPolyfill = pnpmPkg("url", "url.js");
  const querystringPolyfill = pnpmPkg("querystring-es3", "index.js");
  const stringDecoderPolyfill = pnpmPkg("string_decoder", "index.js");

  return {
    ...renderer,
    name: "renderer-web",
    target: "web",
    entry: {
      renderer: path.resolve(rootFolder, "src", "renderer", "index.ts"),
    },
    module: {
      ...renderer.module,
      rules: webRules,
    },
    output: {
      ...commonConfig.output,
      path: path.resolve(rootFolder, "dist-web"),
      filename: "renderer.bundle.js",
      publicPath: "./",
      assetModuleFilename: "assets/[name]-[hash][ext]",
    },
    node: {
      global: true,
      __dirname: false,
      __filename: false,
    },
    resolve: {
      ...renderer.resolve,
      alias: {
        ...(renderer.resolve?.alias || {}),
        electron: electronShim,
        "electron-store": electronStoreShim,
      },
      fallback: {
        ...(renderer.resolve?.fallback || {}),
        process: processPolyfill,
        buffer: bufferPolyfill,
        path: pathPolyfill,
        stream: streamPolyfill,
        events: eventsPolyfill,
        util: utilPolyfill,
        assert: assertPolyfill,
        crypto: cryptoPolyfill,
        url: urlPolyfill,
        querystring: querystringPolyfill,
        string_decoder: stringDecoderPolyfill,
        // Node built-ins that have no meaningful browser equivalent: resolve to
        // an empty module so the bundle builds; any runtime use will fail loudly
        // in the console instead of blocking the entire app.
        fs: false,
        os: nodeOsStub,
        http: nodeHttpStub,
        https: nodeHttpStub,
        http2: false,
        net: false,
        tls: false,
        child_process: false,
        zlib: false,
        dns: false,
        vm: false,
      },
    },
    plugins: [
      ...getRsdoctorPlugin("renderer-web"),
      new rspack.DefinePlugin({
        ...buildRendererEnv(mode),
        ...buildDotEnvDefine(DOTENV_FILE),
      }),
      new rspack.ProvidePlugin({
        process: processPolyfill,
        // The `buffer` package exports `{ Buffer, ... }`, not the class itself.
        Buffer: [bufferPolyfill, "Buffer"],
      }),
      new rspack.HtmlRspackPlugin({
        template: webTemplate,
        filename: "app.html",
        title: "Ledger Wallet",
        inject: "body",
        scriptLoading: "defer",
      }),
    ],
    optimization: {
      minimize: !isDev,
    },
    stats: isDev ? "errors-warnings" : "normal",
  };
}

export default createWebConfig;
