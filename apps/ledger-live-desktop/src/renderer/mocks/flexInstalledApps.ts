/**
 * FLEX: persistence for Manager (My Ledger) install/uninstall actions.
 *
 * Root cause of "installed apps disappear after switching tabs": the Manager
 * screen derives its `installed` list from the server profile on every mount,
 * while the mock exec kept installs in a closure that died with the screen.
 * Unmount → remount → list rebuilt from profile → freshly-installed apps gone.
 *
 * This store records install/uninstall DELTAS (relative to the profile-derived
 * base) in localStorage — the same mechanism the flex device rename uses — and
 * notifies subscribers (Manager) so the effective list survives navigation and
 * renderer reloads:
 *
 *   effective = (profileBase ∪ installedAdd) \ installedRemove
 *
 * The store speaks APP-NAME space ("Bitcoin"), which is what appOp.name /
 * app.name use in the Manager UI; manager/index.tsx maps profile tickers
 * ("BTC") into this space when building the base.
 */

const ADD_KEY = "flex.installed.add";
const REMOVE_KEY = "flex.installed.remove";

const readSet = (key: string): Set<string> => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is string => typeof n === "string"));
  } catch {
    return new Set();
  }
};

const writeSet = (key: string, set: Set<string>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — in-memory only this session */
  }
};

const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach(l => {
    try {
      l();
    } catch {
      /* a broken subscriber must not break the rest */
    }
  });
};

/** Record the result of one completed Manager app operation. */
export const setFlexAppInstalled = (appName: string, installed: boolean): void => {
  if (!appName) return;
  const add = readSet(ADD_KEY);
  const remove = readSet(REMOVE_KEY);
  if (installed) {
    remove.delete(appName);
    add.add(appName);
  } else {
    add.delete(appName);
    remove.add(appName);
  }
  writeSet(ADD_KEY, add);
  writeSet(REMOVE_KEY, remove);
  notify();
};

/** Names explicitly installed through My Ledger (not from the profile). */
export const getFlexInstalledAdd = (): Set<string> => readSet(ADD_KEY);

/** Names explicitly uninstalled through My Ledger (shadowed from the profile). */
export const getFlexInstalledRemove = (): Set<string> => readSet(REMOVE_KEY);

/** Subscribe to install/uninstall changes; returns an unsubscribe fn. */
export const subscribeFlexInstalled = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
