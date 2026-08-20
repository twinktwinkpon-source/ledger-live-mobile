/*
 * Browser shim for the `electron` module.
 *
 * The FLEX_DEMO renderer imports `electron` directly (ipcRenderer, webFrame).
 * In the web build this module replaces it so the same renderer code can boot
 * in a plain browser (mobile Safari PWA) without Node/Electron APIs:
 *
 *   - ipcRenderer.invoke  → storage channels are backed by localStorage
 *                           (the desktop main writes app.json via the same
 *                           channels); unknown channels resolve to undefined.
 *   - ipcRenderer.sendSync → license channels read/write the server balances
 *                           cache in localStorage (populated by the web boot
 *                           gate before the renderer bundle loads).
 *   - ipcRenderer.on/send → in-memory event bus, mainly no-ops for the flex
 *                           flows (admin pushes reload the page instead).
 *   - webFrame            → no-op stub (keeps init.tsx import working).
 */

type IpcCallback = (...args: unknown[]) => void;

const STORE_KEY = "llw:web:store";
const BALANCES_KEY = "llw:web:server-balances";

function loadStore(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, unknown>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode errors */
  }
}

function readCachedBalances(): Record<string, string> | undefined {
  try {
    const raw = localStorage.getItem(BALANCES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedBalances(balances: unknown): void {
  if (balances && typeof balances === "object") {
    try {
      localStorage.setItem(BALANCES_KEY, JSON.stringify(balances));
    } catch {
      /* ignore */
    }
  }
}

const listeners: Record<string, IpcCallback[]> = {};

function emit(channel: string, payload: unknown): void {
  for (const cb of listeners[channel] || []) {
    try {
      cb(payload);
    } catch {
      /* ignore listener errors */
    }
  }
}

export const ipcRenderer = {
  send: (channel: string, payload?: unknown): void => {
    emit(channel, payload);
  },

  sendSync: (channel: string, payload?: unknown): unknown => {
    switch (channel) {
      case "license:get-balances-sync":
        return readCachedBalances();
      case "license:set-balances-sync":
        writeCachedBalances(payload);
        return undefined;
      default:
        return undefined;
    }
  },

  invoke: async (channel: string, payload: unknown): Promise<unknown> => {
    switch (channel) {
      case "getKey": {
        const p = (payload || {}) as Record<string, unknown>;
        const { ns, keyPath, defaultValue } = p;
        const store = loadStore();
        const value = store[`${ns}:${keyPath}`];
        return value === undefined ? defaultValue : value;
      }
      case "setKey": {
        const p = (payload || {}) as Record<string, unknown>;
        const { ns, keyPath, value } = p;
        const store = loadStore();
        store[`${ns}:${keyPath}`] = value;
        saveStore(store);
        return undefined;
      }
      case "hasEncryptionKey":
        return false;
      case "setEncryptionKey":
      case "removeEncryptionKey":
      case "resetAll":
      case "cleanCache":
        return undefined;
      case "isEncryptionKeyCorrect":
      case "hasBeenDecrypted":
        return true;
      case "reload":
        window.location.reload();
        return undefined;
      default:
        return undefined;
    }
  },

  on: (channel: string, callback: IpcCallback): void => {
    (listeners[channel] = listeners[channel] || []).push(callback);
  },

  once: (channel: string, callback: IpcCallback): void => {
    const wrapper: IpcCallback = (...args) => {
      ipcRenderer.removeListener(channel, wrapper);
      callback(...args);
    };
    ipcRenderer.on(channel, wrapper);
  },

  removeListener: (channel: string, callback: IpcCallback): void => {
    const list = listeners[channel];
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx >= 0) list.splice(idx, 1);
  },

  removeAllListeners: (channel?: string): void => {
    if (channel) {
      delete listeners[channel];
    } else {
      for (const key of Object.keys(listeners)) delete listeners[key];
    }
  },
};

// The renderer only reads from webFrame during boot (zoom/app details); a
// no-op proxy is enough to keep the import and calls from throwing.
export const webFrame: unknown = new Proxy(
  {},
  {
    get: () => (..._args: unknown[]) => undefined,
    set: () => true,
  },
);

// Clipboard API is async in browsers while the renderer reads it synchronously
// (ReadOnlyAddressField). writeText fires-and-forgets; readText returns "".
export const clipboard = {
  readText: (): string => "",
  writeText: (text: string): void => {
    try {
      navigator.clipboard?.writeText(text).catch(() => {
        /* ignore clipboard permission errors */
      });
    } catch {
      /* ignore */
    }
  },
};

// Mirror the preload's `window.api` surface (src/preloader/index.ts). It is
// what reveals the app once the renderer signals it is ready (TriggerAppReady)
// and what WalletAPIWebview reads for `appDirname`.
let appLoadedFlag = false;
const appLoaded = (): void => {
  if (appLoadedFlag) return;
  appLoadedFlag = true;
  const rendererNode = document.getElementById("react-root");
  const loaderContainer = document.getElementById("loader-container");
  if (rendererNode && loaderContainer) {
    rendererNode.style.visibility = "visible";
    loaderContainer.classList.add("fade-out");
    setTimeout(() => {
      loaderContainer.remove();
    }, 500);
  }
};

const params = new URLSearchParams(window.location.search);
window.api = {
  appDirname: params.get("appDirname") || "",
  appLoaded,
  reloadRenderer: (): void => {
    window.location.reload();
  },
  openWindow: (): void => {
    /* no webview in the browser build */
  },
};

export default { ipcRenderer, webFrame, clipboard };
