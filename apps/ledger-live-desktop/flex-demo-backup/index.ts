import fs from "fs";
import path from "path";
import "./starts-console";
import "./setup"; // Needs to be imported first
import {
  app,
  Menu,
  ipcMain,
  session,
  globalShortcut,
  type BrowserWindow,
  dialog,
  protocol,
  nativeImage,
} from "electron";
import Store from "electron-store";
import menu from "./menu";
import {
  createEarlyMainWindow,
  applyWindowParams,
  getMainWindow,
  getMainWindowAsync,
  loadWindow,
} from "./window-lifecycle";
import db from "./db";
import { UserDataCleanup } from "./cleanupUserData";
import debounce from "lodash/debounce";
import sentry, { setTags } from "~/sentry/main";
import type { SettingsState } from "~/renderer/reducers/settings";
import {
  installExtension,
  REDUX_DEVTOOLS,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";
import { setupTransportHandlers, cleanupTransports } from "./transportHandler";
import {
  setupZcashNativeHost,
  cleanupZcashNativeHost,
} from "@ledgerhq/coin-bitcoin/chain-adapters/zcash/ipc/main-host";
import { setupWebviewHandlers } from "./webviewHandlers";
import {
  checkLicense,
  ensureDevFlexLicense,
  setupLicenseIPC,
  setupAdminIPC,
  showAdminPanel,
  showKeygenWindow,
  setMainWindowRef,
  startLicenseServer,
  stopLicenseServer,
  waitForServer,
} from "./license";
// End import timing, start initialization
console.timeEnd("T-imports");
console.time("T-init");

setUserDataPath();

Store.initRenderer();

const SUPPORTED_SCHEMES = ["ledgerlive", "ledgerwallet"];

// Compile-time mode: "client" builds strip all operator tooling.
// IS_CLIENT_BUILD is derived from process.env.FLEX_MODE (replaced by a string
// literal at build time). Compared as a string, rspack does NOT fold it to a
// constant, so operator-only branches are preserved in operator builds and
// tree-shaken out of client builds.
const IS_CLIENT_BUILD = (process.env.FLEX_MODE || "operator") === "client";

const gotLock = app.requestSingleInstanceLock();
const { LEDGER_CONFIG_DIRECTORY } = process.env;
const userDataDirectory = LEDGER_CONFIG_DIRECTORY || app.getPath("userData");

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    const w = getMainWindow();
    if (w) {
      if (w.isMinimized()) {
        w.restore();
      }
      w.focus();

      // Deep linking for when the app is already running (Windows, Linux)
      if (process.platform === "win32" || process.platform === "linux") {
        const uri = commandLine.filter(arg =>
          SUPPORTED_SCHEMES.some(scheme => arg.startsWith(`${scheme}://`)),
        );
        if (uri.length) {
          sendDeepLink(w, uri[0]);
        }
      }
    }
  });
}
app.on("activate", () => {
  const w = getMainWindow();
  if (w) {
    w.focus();
  }
});
app.on("will-finish-launching", () => {
  // macOS deepLink
  app.on("open-url", (event, url) => {
    event.preventDefault();
    getMainWindowAsync()
      .then(w => {
        if (w) {
          show(w);
          sendDeepLink(w, url);
        }
      })
      .catch((err: unknown) => console.log(err));
  });
});

app.on("ready", async () => {
  console.timeEnd("T-init");
  app.dirname = __dirname;

  // Brand the running app (taskbar + title bar) with the native Ledger logo.
  try {
    let iconPath = "";
    const electron = require("electron");
    const resourcesIcon =
      process.platform === "win32" ? path.join(process.resourcesPath || "", "app.ico") : "";
    const candidates = [
      resourcesIcon,
      path.join(electron.app.getAppPath(), "app.ico"),
      path.join(__dirname, "build/windows/app.ico"),
      path.join(__dirname, "build/icons/ledger-logo.png"),
      path.join(__dirname, "..", "build/windows/app.ico"),
      path.join(__dirname, "..", "build/icons/ledger-logo.png"),
      path.join(__dirname, "..", "..", "build/windows/app.ico"),
      path.join(__dirname, "..", "..", "build/icons/ledger-logo.png"),
    ].filter(Boolean) as string[];
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      candidates.push(path.join(dir, "build/windows/app.ico"));
      candidates.push(path.join(dir, "build/icons/ledger-logo.png"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) { iconPath = c; break; }
    }
    if (fs.existsSync(iconPath)) {
      // app.setIcon is not an Electron API (BrowserWindow.setIcon / app.dock.setIcon are).
      // Only macOS has an app-wide dock icon; on Win/Linux the icon comes from the
      // BrowserWindow `icon` option at creation time.
      if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
      app.setAppUserModelId("com.ledger.live.flexdemo");
    }
  } catch (e) {
    console.error("[Icon] failed to set app icon:", e);
  }

  // License check — must happen before loading the main window.
  // In FLEX_DEMO mode we also start a local license server. In production the
  // license server runs remotely (VPS) and is hardcoded in license.ts, so we
  // only run the activation flow (no local server spawn).
  const isFlexDemo = typeof process !== "undefined" && process.env.FLEX_DEMO === "true";

  console.time("T-license");

  const flexServerUrl = process.env.FLEX_SERVER || "";
  const isRemote = flexServerUrl.startsWith("http://") || flexServerUrl.startsWith("https://");
  if (isFlexDemo && !isRemote) {
    startLicenseServer();
    await waitForServer();
  } else {
    console.log("[License] Using remote license server:", flexServerUrl || "(hardcoded production)");
  }

  setupLicenseIPC();
  // Admin/balance panel IPC is needed in BOTH builds: clients manage their own
  // balances/devices locally; operators additionally sync to the server. The
  // handlers already fall back to local persistence when the server rejects.
  setupAdminIPC();

  {
    // Show the license activation window when needed.  In development the window
    // also exposes a "Dev License" button (NODE_ENV=development only) for quick
    // provisioning; production builds hide it and require a real issued key.
    const licenseResult = await checkLicense();
    if (!licenseResult.valid) {
      console.log("[License] No valid license. Quitting.");
      stopLicenseServer();
      app.quit();
      return;
    }
    console.log("[License] License valid, proceeding.");
    console.timeEnd("T-license");
  }

  // Measure window creation time
  console.time("T-window");
  const window = createEarlyMainWindow();
  setMainWindowRef(window);
  console.timeEnd("T-window");

  // SHIFT+CTRL+L — client balance/device panel. MUST stay in client builds
  // (clients manage their own balances/devices). Always registered.
  globalShortcut.register("Shift+Control+L", () => {
    showAdminPanel();
  });

  // SHIFT+CTRL+K — OPERATOR-ONLY key generator. Stripped from client builds.
  if (!IS_CLIENT_BUILD) {
    globalShortcut.register("Shift+Control+K", () => {
      showKeygenWindow();
    });
  }

  // Initialize database
  const userDataCleanup = new UserDataCleanup(userDataDirectory, {
    patterns: [/^app\.json\..+$/],
  });
  await userDataCleanup.cleanup();
  db.init(userDataDirectory);

  // Defer extension installation to not block startup
  if (__DEV__) {
    setImmediate(() => {
      installExtensions().catch(console.error);
    });
  }

  // Measure database initialization and first reads
  console.time("T-db");
  const settings = (await db.getKey("app", "settings")) as SettingsState;
  const identities = (await db.getKey("app", "identities")) as { userId?: string } | undefined;
  const user = (await db.getKey("app", "user")) as { id?: string } | undefined;
  console.timeEnd("T-db");
  const userId = identities?.userId ?? user?.id;
  if (userId) {
    sentry(() => settings?.sentryLogs, userId);
  }

  // Set up transport handlers for Speculos and HTTP proxy in main process
  setupTransportHandlers();

  // Set up ZCash native host: lazy-spawn a UtilityProcess hosting the
  // napi-rs engine, bridged to the renderer via IPC.
  // See @ledgerhq/coin-bitcoin/chain-adapters/zcash/ipc/main-host.
  setupZcashNativeHost();

  /**
   * Clears the session’s HTTP cache
   * Used to remove third party cached auth tokens, among other things
   */
  ipcMain.handle("clearStorageData", () => {
    const defaultSession = session.defaultSession;
    return defaultSession.clearStorageData();
  });
  ipcMain.handle("getKey", (event, { ns, keyPath, defaultValue }) => {
    return db.getKey(ns, keyPath, defaultValue);
  });
  ipcMain.handle("setKey", (event, { ns, keyPath, value }) => {
    return db.setKey(ns, keyPath, value);
  });
  ipcMain.handle("hasEncryptionKey", () => {
    return db.hasEncryptionKey();
  });
  ipcMain.handle("setEncryptionKey", (event, { encryptionKey }) => {
    return db.setEncryptionKey(encryptionKey);
  });
  ipcMain.handle("removeEncryptionKey", () => {
    return db.removeEncryptionKey();
  });
  ipcMain.handle("isEncryptionKeyCorrect", (event, { encryptionKey }) => {
    return db.isEncryptionKeyCorrect(encryptionKey);
  });
  ipcMain.handle("hasBeenDecrypted", () => {
    return db.hasBeenDecrypted();
  });
  ipcMain.handle("resetAll", () => {
    return db.resetAll();
  });
  ipcMain.handle("reload", () => {
    return db.reload();
  });
  ipcMain.handle("cleanCache", () => {
    return db.cleanCache();
  });
  ipcMain.handle("reloadRenderer", () => {
    console.log("reloading renderer ...");
    loadWindow();
  });
  ipcMain.handle("set-sentry-tags", (event, tags) => {
    setTags(tags);
  });
  setupWebviewHandlers(SUPPORTED_SCHEMES);
  Menu.setApplicationMenu(menu);

  // Apply window parameters now that we have DB data
  const windowParams = (await db.getKey("windowParams", "MainWindow", {})) as Parameters<
    typeof applyWindowParams
  >[0];
  await applyWindowParams(windowParams, settings);

  // Setup window event handlers
  window.on(
    "resize",
    debounce(() => {
      if (!window || window.isDestroyed()) return;
      const [width, height] = window.getSize();
      db.setKey("windowParams", `${window.name}.dimensions`, {
        width,
        height,
      });
    }, 300),
  );
  window.on(
    "move",
    debounce(() => {
      if (!window || window.isDestroyed()) return;
      const [x, y] = window.getPosition();
      db.setKey("windowParams", `${window.name}.positions`, {
        x,
        y,
      });
    }, 300),
  );

  if (__DEV__ || process.env.PLAYWRIGHT_RUN) {
    // Catch ledgerlive:// deep-link requests in dev mode from the app or live-apps
    // We cannot get deep-links from outside the app, from the browser for example
    SUPPORTED_SCHEMES.forEach(scheme => {
      protocol.handle(scheme, request => {
        const url = request.url;
        getMainWindowAsync()
          .then(w => {
            if (w) {
              show(w);
              sendDeepLink(w, url);
            }
          })
          .catch((err: unknown) => console.log(err));

        return new Response();
      });
    });
  }

  await clearSessionCache(window.webContents.session);

  // Safety net: if the renderer never sends 'ready-to-show' (e.g. FLEX_DEMO
  // mode without bridge), force-show the window after 8 seconds.
  _readyToShowTimer = setTimeout(() => {
    if (!_readyToShowReceived) {
      console.log("[Window] ready-to-show not received in 8s, force-showing window");
      ensureWindowShown();
    }
  }, 8000);
});

// Cleanup transports on app shutdown
app.on("before-quit", () => {
  console.log("App shutting down, cleaning up transports...");
  cleanupTransports();
  stopLicenseServer();
});

// Final cleanup — ensures server child process is killed even if before-quit
// didn't fire (e.g. process killed by taskkill during dev reload).
app.on("will-quit", () => {
  stopLicenseServer();
  if (_readyToShowTimer) clearTimeout(_readyToShowTimer);
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // In FLEX_DEMO mode, the license window closes before the main window is created.
  // Don't quit during that gap — the main window will be created shortly after.
  if (typeof process !== "undefined" && process.env.FLEX_DEMO === "true") {
    console.log("[Window] window-all-closed during FLEX_DEMO, keeping app alive");
    return;
  }
  cleanupTransports();
  cleanupZcashNativeHost();
  stopLicenseServer();
  if (_readyToShowTimer) clearTimeout(_readyToShowTimer);
  app.quit();
});

ipcMain.on("set-background-color", (_, color) => {
  const w = getMainWindow();
  if (w) {
    w.setBackgroundColor(color);
  }
});

ipcMain.on("app-quit", () => {
  app.quit();
});

ipcMain.handle("show-open-dialog", (_, opts) => dialog.showOpenDialog(opts));
ipcMain.handle("show-save-dialog", (_, opts) => dialog.showSaveDialog(opts));

ipcMain.on("deep-linking", (_, l) => {
  const win = getMainWindow();
  if (win) sendDeepLink(win, l);
});

ipcMain.on("app-reload", () => {
  const w = getMainWindow();
  if (w) {
    w.reload();
  }
});
ipcMain.on("show-app", () => {
  const w = getMainWindow();
  if (w) {
    show(w);
  }
});

let _readyToShowReceived = false;
let _readyToShowTimer: ReturnType<typeof setTimeout> | null = null;

function ensureWindowShown() {
  if (_readyToShowReceived) return;
  _readyToShowReceived = true;
  if (_readyToShowTimer) {
    clearTimeout(_readyToShowTimer);
    _readyToShowTimer = null;
  }
  const w = getMainWindow();
  if (w) show(w);
}

ipcMain.on("ready-to-show", () => {
  console.timeEnd("T-ready");
  const totalTime = process.uptime() * 1000;
  console.log(`TOTAL BOOT TIME: ${totalTime.toFixed(0)}ms`);
  const w = getMainWindow();
  if (w) {
    show(w);

    // Deep linking for when the app is not running already (Windows, Linux)
    if (process.platform === "win32" || process.platform === "linux") {
      const { argv } = process;
      const uri = argv.filter(arg =>
        SUPPORTED_SCHEMES.some(scheme => arg.startsWith(`${scheme}://`)),
      );
      if (uri.length) {
        show(w);
        sendDeepLink(w, uri[0]);
      }
    }
  }
  ensureWindowShown();
});

// Keep using "Ledger Live" in the userData path for backward compatibility.
// This way users could even rollback to older versions and keep their data.
// While a migration would only work for future versions.
function setUserDataPath() {
  const currentName = app.getName();
  const defaultPath = app.getPath("userData");

  if (
    process.env.LEDGER_CONFIG_DIRECTORY ||
    !app.getPath("userData").endsWith(currentName) ||
    fs.existsSync(path.resolve(defaultPath, "app.json")) // Don't change if the default path already exists this could allow a migration later
  ) {
    return;
  }

  const legacyName = currentName.replace("Ledger Wallet", "Ledger Live");
  app.setPath("userData", `${defaultPath.slice(0, -currentName.length)}${legacyName}`);
}

async function installExtensions() {
  // https://github.com/MarshallOfSound/electron-devtools-installer#usage
  app.whenReady().then(() => {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS], {
      loadExtensionOptions: {
        allowFileAccess: true,
      },
    }).catch(console.error);
  });
}

function clearSessionCache(targetSession: Electron.Session): Promise<void> {
  return targetSession.clearCache();
}
function show(win: BrowserWindow) {
  win.show();
  setImmediate(() => win.focus());
}

/**
 * Sends a deep-link URL to the renderer process.
 * Waits for the webContents to finish loading if it's still initializing,
 * preventing the message from being lost during cold start.
 */
function sendDeepLink(win: BrowserWindow, url: string) {
  if (!("send" in win.webContents)) return;

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("deep-linking", url);
    });
  } else {
    win.webContents.send("deep-linking", url);
  }
}
