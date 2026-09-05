/**
 * FLEX: native Wallet Sync → flex license bridge.
 *
 * Upstream's Wallet Sync drawer (Settings → Ledger Sync → Manage) drives the
 * real Trustchain SDK, which needs a physical device. In flex there is no
 * hardware, so the drawer's upstream steps would dead-end. Instead of mock
 * screens, the NATIVE upstream flow is kept and only the two trustchain
 * entry points are re-routed to our license QR (the same ledgerflex://
 * payload the admin panel shows — the phone already parses it in
 * useSyncWithQrCode and completes the native WalletSyncLoading → Success).
 *
 * Desktop side ("я scanned from settings — will the project show sync?"):
 * after the phone scans, this store records the phone as a wallet-sync
 * instance, so the upstream screens light up system-wide:
 *
 *   - drawer: CreateOrSynchronize → (flex: straight to QR step) →
 *     SyncFinalStep "Sync successful!" (upstream Success component)
 *   - Settings → Ledger Sync row → Manage (upstream Flow.LedgerSyncActivated)
 *   - Manage → "Synchronized instances" lists the phone (upstream instances UI)
 *
 * The desktop instance count includes this desktop as the root member; the
 * phone becomes a second member when it scans. State lives in localStorage so
 * it survives reloads — same mechanism as flexInstalledApps.
 */

const INSTANCE_KEY = "flex.walletsync.instances";
const SCANNED_KEY = "flex.walletsync.scanned";

export type FlexSyncInstance = {
  id: string;
  name: string;
  permissions: number;
  /** ISO date of when the phone scanned the QR. */
  linkedAt?: string;
};

const OWNER_PERMISSIONS = 0xffffffff;

const readJson = <T,>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — in-memory only this session */
  }
};

const subscribers = new Set<() => void>();

const notify = () => subscribers.forEach(fn => fn());

export const subscribeFlexSyncInstances = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/** The desktop itself is always the root member of the flex "trustchain". */
export const DESKTOP_INSTANCE: FlexSyncInstance = {
  id: "flex-desktop-root",
  name: "This computer",
  permissions: OWNER_PERMISSIONS,
};

export const getFlexSyncInstances = (): FlexSyncInstance[] => {
  const linked = readJson<FlexSyncInstance>(INSTANCE_KEY);
  return [DESKTOP_INSTANCE, ...(linked ? [linked] : [])];
};

export const getLinkedPhone = (): FlexSyncInstance | null => {
  return readJson<FlexSyncInstance>(INSTANCE_KEY);
};

/**
 * Called when the phone scans the flex QR (desktop renderer listens to the
 * license activation push — or, in this demo, the QR window observes the
 * server's device count via admin:get-info). Registers the phone as a sync
 * instance and marks the sync as active. Idempotent per phone id.
 */
export const setLinkedPhone = (name: string, id: string): boolean => {
  const existing = getLinkedPhone();
  if (existing && existing.id === id) return false;
  writeJson(INSTANCE_KEY, {
    id,
    name,
    permissions: OWNER_PERMISSIONS,
    linkedAt: new Date().toISOString(),
  } satisfies FlexSyncInstance);
  writeJson(SCANNED_KEY, true);
  notify();
  return true;
};

/** Whether a phone has ever scanned the flex sync QR on this desktop. */
export const hasLinkedPhone = (): boolean => {
  return readJson<boolean>(SCANNED_KEY) === true || getLinkedPhone() !== null;
};

/**
 * Register the phone link from the admin-panel info channel: the server's
 * `devices` count grew above the desktop itself → the phone scanned. Uses the
 * selected device model as the instance name so Manage shows "iPhone · Stax"
 * style rows like upstream does for real instances.
 */
export const maybeLinkPhoneFromServer = (devices: number | null, deviceName: string): boolean => {
  if (devices === null || devices < 2) return false;
  const existing = getLinkedPhone();
  if (existing) return false;
  return setLinkedPhone(deviceName, "flex-phone-1");
};

/** Forget the phone (kept for parity with upstream "delete instance" flows). */
export const clearLinkedPhone = () => {
  try {
    window.localStorage.removeItem(INSTANCE_KEY);
    window.localStorage.removeItem(SCANNED_KEY);
  } catch {
    /* ignore */
  }
  notify();
};
