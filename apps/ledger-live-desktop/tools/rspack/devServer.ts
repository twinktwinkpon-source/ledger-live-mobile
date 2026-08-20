import { rspack, type RspackOptions, type Watching } from "@rspack/core";
import { RspackDevServer } from "@rspack/dev-server";
import type { Configuration as DevServerConfiguration } from "@rspack/dev-server";
import { createRendererConfig } from "./rspack.renderer";
import { createMainConfig } from "./rspack.main";
import { createPreloaderConfig } from "./rspack.preloader";
import { createWebviewPreloaderConfig } from "./rspack.webviewPreloader";
import { createWebviewDappPreloaderConfig } from "./rspack.webviewDappPreloader";
import { createZcashUtilityConfig } from "./rspack.zcashUtility";
import { lldRoot } from "./utils";
import path from "path";
import { execSync } from "child_process";

export interface DevServerOptions {
  port: number;
  onMainRebuild?: () => void;
}

/**
 * Kills any process currently listening on the given port.
 * This prevents EADDRINUSE errors from zombie processes left by previous dev sessions.
 */
function killPortProcess(port: number): void {
  try {
    if (process.platform === "win32") {
      // On Windows, use netstat to find the PID, then taskkill to terminate it
      const output = execSync(`netstat -ano | findstr :${port}`, {
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
          execSync(`taskkill /F /PID ${pid}`, {
            encoding: "utf-8",
            timeout: 5000,
            stdio: "pipe",
          });
          console.log(`🔪 Killed zombie process (PID ${pid}) on port ${port}`);
        } catch {
          // Process may have already exited
        }
      }
    } else {
      // On Unix-like systems (macOS, Linux), use lsof
      try {
        const output = execSync(`lsof -ti :${port}`, {
          encoding: "utf-8",
          timeout: 5000,
          stdio: "pipe",
        });
        const pids = output
          .split("\n")
          .map(p => p.trim())
          .filter(p => p && /^\d+$/.test(p));
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), "SIGKILL");
            console.log(`🔪 Killed zombie process (PID ${pid}) on port ${port}`);
          } catch {
            // Process may have already exited
          }
        }
      } catch {
        // lsof returns non-zero exit code when no process found — that's fine
      }
    }
  } catch {
    // netstat/lsof failed — no process on the port, nothing to kill
  }
}

/**
 * Creates and starts the rspack dev server for the renderer process
 * with HMR support
 */
export async function createDevServer(options: DevServerOptions): Promise<RspackDevServer> {
  const { port } = options;

  // Create renderer config with dev server options
  const rendererConfig = createRendererConfig("development", { devServer: true });

  // Add dev server configuration
  const devServerConfig: DevServerConfiguration = {
    port,
    hot: true,
    liveReload: true,
    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
      progress: true,
    },
    static: {
      directory: path.join(lldRoot, "src", "renderer"),
      publicPath: "/",
    },
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    historyApiFallback: true,
    devMiddleware: {
      writeToDisk: true,
      stats: "errors-only",
    },
  };

  const compiler = rspack(rendererConfig);
  const server = new RspackDevServer(devServerConfig, compiler);

  return server;
}

/**
 * Creates watchers for main process and preloader builds
 * that restart Electron when changes are detected
 */
export function createMainWatchers(options: DevServerOptions): Promise<Watching[]> {
  const { port, onMainRebuild } = options;
  const argv = { port };

  const configs: RspackOptions[] = [
    createMainConfig("development", argv),
    createPreloaderConfig("development", argv),
    createWebviewPreloaderConfig("development", argv),
    createWebviewDappPreloaderConfig("development", argv),
    createZcashUtilityConfig("development", argv),
  ];

  const watchers = configs.map(config => {
    const compiler = rspack(config);

    return new Promise<Watching>(resolve => {
      const watching = compiler.watch({}, (err, stats) => {
        if (err) {
          console.error(`[${config.name}] Build error:`, err);
          return;
        }

        if (stats?.hasErrors()) {
          console.error(`[${config.name}] Build failed with errors:`);
          console.error(stats.toString({ colors: true, errors: true }));
          return;
        }

        console.log(`[${config.name}] Build completed successfully`);

        // Trigger Electron reload for main process changes
        if (config.name === "main" && onMainRebuild) {
          onMainRebuild();
        }
      });

      // Resolve immediately - watching has started
      resolve(watching);
    });
  });

  return Promise.all(watchers);
}

/**
 * Starts the full development environment.
 */
export async function startDev(options: DevServerOptions): Promise<{
  server: RspackDevServer;
  watchers: Watching[];
  close: () => Promise<void>;
}> {
  console.log("Starting rspack development server...");

  // Kill any zombie process left on the port from a previous dev session
  killPortProcess(options.port);

  // Start renderer dev server
  const server = await createDevServer(options);
  await server.start();

  console.log(`Renderer dev server running at http://localhost:${options.port}`);

  // Start watchers for main process
  const watchers = await createMainWatchers(options);

  console.log("All watchers started successfully");

  return {
    server,
    watchers,
    close: async () => {
      // Close all watchers
      await Promise.all(
        watchers.map(
          watcher =>
            new Promise<void>(resolve => {
              watcher.close(() => {
                resolve();
              });
            }),
        ),
      );
      // Stop dev server
      await server.stop();
    },
  };
}
