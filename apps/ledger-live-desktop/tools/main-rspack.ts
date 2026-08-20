#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "fs";
import path from "path";
import { rspack } from "@rspack/core";

import {
  createMainConfig,
  createRendererConfig,
  createPreloaderConfig,
  createWebviewPreloaderConfig,
  createWebviewDappPreloaderConfig,
  createWorkerConfig,
  createZcashUtilityConfig,
  startDev,
  lldRoot,
} from "./rspack";

const yargs = require("yargs");
const processReleaseNotes = require("./utils/processReleaseNotes");

// Electron process manager
class Electron {
  private instance: any = null;
  private bundlePath: string;
  private electronPath: string;
  private execa: any;
  private exitHandler: ((result: { exitCode?: number; signal?: string }) => void) | undefined;

  constructor(
    bundlePath: string,
    execa: any,
    electronPath: string = path.join(
      lldRoot,
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
  ) {
    this.bundlePath = bundlePath;
    this.electronPath = electronPath;
    this.execa = execa;
  }

  start(exitHandler?: (result: { exitCode?: number; signal?: string }) => void) {
    if (!this.instance) {
      if (exitHandler) this.exitHandler = exitHandler;
      const args = (process.env.ELECTRON_ARGS || "").split(/[ ]+/).filter(Boolean);
      if (args.length) console.log("Electron starts with", args);
      // ELECTRON_RUN_AS_NODE can be inherited from a developer shell or an
      // IDE. When set, Electron intentionally behaves like plain Node.js,
      // which makes electron-is-dev reject the main process.
      const electronEnv = { ...process.env };
      // Windows environment variable names are case-insensitive. Remove all
      // casing variants so Electron cannot accidentally inherit Node mode
      // from an IDE or from a previous `electron` shell command.
      for (const key of Object.keys(electronEnv)) {
        if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete electronEnv[key];
      }
      // reject: false prevents throwing when process is killed during reload
      const instance = this.execa(this.electronPath, [this.bundlePath, ...args], {
        reject: false,
        env: electronEnv,
        // Do not merge the parent environment back into electronEnv: that
        // would reintroduce ELECTRON_RUN_AS_NODE after it was removed above.
        extendEnv: false,
      });
      this.instance = instance;
      instance.stdout?.pipe(process.stdout);
      instance.stderr?.pipe(process.stderr);
      instance.then((result: { exitCode?: number; signal?: string }) => {
        // Ignore the result of a process intentionally stopped for HMR.
        if (this.instance === instance) this.exitHandler?.(result);
      });
    }
  }

  async stop() {
    if (this.instance) {
      const instance = this.instance;
      this.instance = null;

      // On Windows, kill() doesn't properly terminate the process tree.
      // Use taskkill /F /T to forcefully kill the process and all children.
      // This prevents "Lock file can not be created" and cache access errors on reload.
      if (process.platform === "win32" && instance.pid) {
        try {
          const { execSync } = await import("child_process");
          execSync(`taskkill /F /T /PID ${instance.pid}`, {
            encoding: "utf-8",
            timeout: 5000,
            stdio: "pipe",
          });
        } catch {
          // Process may have already exited — fall through to kill()
          instance.kill();
        }
      } else {
        instance.kill();
      }

      // Wait for the process to fully exit so lock files and caches are released
      try {
        await instance;
      } catch {
        // ignore — reject: false was set, but just in case
      }

      // Small delay to let the OS release file locks (especially on Windows)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async reload() {
    if (this.instance) {
      await this.stop();
      this.start();
    }
  }
}

/**
 * Start development mode with HMR.
 */
const startDevMode = async (argv: { port: number }) => {
  try {
    await processReleaseNotes();
  } catch (error) {
    console.log("Warning: Could not process release notes:", error);
  }

  const execa = await import("execa").then(mod => mod.execa);
  const electron = new Electron("./.webpack/main.bundle.js", execa);

  console.log("🚀 Starting rspack development environment...\n");

  // Track whether the main process has been built at least once.
  // We only start Electron AFTER the first main build completes, so
  // the license window (if shown) is not immediately killed by a reload.
  let mainBuilt = false;
  let firstBuildResolve: () => void;
  const firstBuildPromise = new Promise<void>(resolve => {
    firstBuildResolve = resolve;
  });

  // Start the development server and watchers
  const { close } = await startDev({
    port: argv.port,
    onMainRebuild: async () => {
      if (!mainBuilt) {
        // First build just completed — don't reload, just signal readiness.
        mainBuilt = true;
        firstBuildResolve();
        return;
      }
      console.log("♻️  Reloading Electron...");
      await electron.reload();
    },
  });

  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n🛑 Shutting down...");
    await electron.stop();
    await close();
    process.exit(exitCode);
  };

  // Wait for the first main build to complete before starting Electron.
  // This prevents the license window from being killed by an immediate reload.
  console.log("⏳ Waiting for initial main build to complete...");
  await firstBuildPromise;
  console.log("✅ Initial main build complete, starting Electron...");

  // When FLEX_DEMO=true, the app expects a fake device/portfolio and the
  // Electron window must open. We still launch Electron normally here; the
  // FLEX_DEMO runtime checks live inside the renderer code (fakeFlexBuild.ts).
  // Any Electron exit must close the Rspack server and watchers. Otherwise NX
  // can report an opaque ELIFECYCLE error and leave port 8080/license-server
  // processes behind, which breaks the next `pnpm dev:lld` invocation.
  electron.start(result => {
    if (!shuttingDown) {
      console.error(
        `[Electron] exited unexpectedly (code=${result?.exitCode ?? "unknown"}, signal=${result?.signal ?? "none"})`,
      );
      void shutdown(result?.exitCode ?? 1);
    }
  });

  console.log("\n✅ Development environment ready!");
  console.log(`   Renderer: http://localhost:${argv.port}`);
  console.log("   Press Ctrl+C to stop\n");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

/**
 * Build for production
 */
const build = async (argv: { port?: number }) => {
  try {
    await processReleaseNotes();
  } catch (error) {
    console.log("Warning: Could not process release notes:", error);
  }

  console.log("🔨 Building for production with rspack...\n");

  const configs = [
    { name: "main", config: createMainConfig("production", argv) },
    { name: "renderer", config: createRendererConfig("production", { devServer: false }) },
    { name: "preloader", config: createPreloaderConfig("production", argv) },
    { name: "webviewPreloader", config: createWebviewPreloaderConfig("production", argv) },
    { name: "webviewDappPreloader", config: createWebviewDappPreloaderConfig("production", argv) },
    { name: "workers", config: createWorkerConfig("production") },
    { name: "zcashUtility", config: createZcashUtilityConfig("production", argv) },
  ];

  const results = await Promise.all(
    configs.map(async ({ name, config }) => {
      return new Promise<{ name: string; stats: any }>((resolve, reject) => {
        rspack(config, (err, stats) => {
          if (err) {
            console.error(`❌ ${name} build failed:`, err);
            reject(err);
            return;
          }

          if (stats?.hasErrors()) {
            // Log to stdout first so CI always shows a readable summary (stderr may be dropped or truncated)
            const json = stats?.toJson({ all: false, errors: true });
            const errors = json?.errors || [];
            console.log(`\n❌ ${name} build failed with ${errors.length} error(s):`);
            errors.forEach((e: { message?: string; moduleName?: string }, i: number) => {
              const msg = typeof e.message === "string" ? e.message : String(e.message ?? e);
              const truncated = msg.length > 500 ? msg.slice(0, 500) + "\n... [truncated]" : msg;
              console.log(`  ${i + 1}. ${e.moduleName || "?"}: ${truncated.split("\n").join(" ")}`);
            });
            console.error(`❌ ${name} build failed with errors:`);
            console.error(stats.toString({ colors: true, errors: true }));
            reject(new Error(`${name} build failed`));
            return;
          }

          const assets = stats?.toJson({ assets: true })?.assets || [];
          const mainAsset = assets.find((a: { name: string }) => a.name.endsWith(".bundle.js"));
          if (mainAsset) {
            const sizeMB = (mainAsset.size / 1024 / 1024).toFixed(2);
            console.log(`✅ ${mainAsset.name}: ${sizeMB} MB`);
          } else {
            console.log(`✅ ${name} built successfully`);
          }
          resolve({ name, stats });
        });
      });
    }),
  );

  // Generate metafiles if requested
  if (process.env.GENERATE_METAFILES) {
    const isLite = process.env.GENERATE_METAFILES === "lite";
    console.log(`\n📊 Generating metafiles${isLite ? " (lite mode)" : ""}...`);

    results.forEach(({ name, stats }) => {
      if (stats) {
        const metafile = stats.toJson({
          assets: true,
          chunks: !isLite, // Include chunks in full mode for tools like statoscope
          modules: true,
        });

        // In lite mode, minimize metafile: keep only essential data for bundle size and duplicate detection
        // This removes sourcemaps, reasons, and other verbose data that makes files huge
        const finalMetafile = isLite
          ? {
              assets: (metafile.assets || []).map((asset: any) => ({
                name: asset.name,
                size: asset.size,
              })),
              modules: (metafile.modules || [])
                .map((mod: any) => ({
                  ...(mod.identifier && { identifier: mod.identifier }),
                  ...(mod.name && { name: mod.name }),
                }))
                .filter((mod: any) => mod.identifier || mod.name),
            }
          : metafile;

        const metafilePath = path.join(lldRoot, `metafile.${name}.json`);
        fs.writeFileSync(metafilePath, JSON.stringify(finalMetafile, null, 2), "utf-8");
        console.log(`   Written: metafile.${name}.json`);
      }
    });
  }

  console.log("\n🎉 Production build complete!");
};

// CLI setup
yargs
  .usage("Usage: $0 <command> [options]")
  .command({
    command: ["dev", "$0"],
    desc: "Start the development workflow with HMR",
    builder: (y: any) =>
      y.option("port", {
        alias: "p",
        type: "number",
        default: 8080,
        description: "Development server port",
      }),
    handler: startDevMode,
  })
  .command({
    command: "build",
    desc: "Build the app for production",
    handler: build,
  })
  .help("h")
  .alias("h", "help")
  .parse();
