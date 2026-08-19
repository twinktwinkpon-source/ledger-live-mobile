/**
 * HWID — stable per-device identifier for the mobile app.
 *
 * Replaced the synchronous react-native-device-info calls (getUniqueIdSync,
 * getDeviceNameSync, etc.) with a persisted in-app UUID. Synchronous native
 * TurboModule calls in the scan hot path raised NSExceptions on iOS 26 New Arch
 * which crashed Hermes natively with EXC_BAD_ACCESS during array iteration.
 *
 * The UUID is generated once upon first call, cached in memory, and asynchronously
 * persisted via LLM/storage. The same device yields the same hash across calls.
 */
import { v4 as uuidv4 } from "uuid";
import { sha256 } from "@ledgerhq/live-common/crypto/index";
import storage from "LLM/storage";
import { FLEX_HWID_SALT } from "./constants";

const FLEX_HWID_STORAGE_KEY = "flex_persistent_hwid";

let _cachedRawHwid: string | null = null;
let _persistAttempted = false;

function initPersistedHwid(): string {
  if (_cachedRawHwid) return _cachedRawHwid;

  // Stable per-session fallback generated immediately
  _cachedRawHwid = `IOS|FLEX_DEVICE|${uuidv4()}`;

  if (!_persistAttempted) {
    _persistAttempted = true;
    // Fire-and-forget async restore/persist
    storage
      .getString(FLEX_HWID_STORAGE_KEY)
      .then(stored => {
        if (stored && typeof stored === "string" && stored.length > 5) {
          _cachedRawHwid = stored;
        } else if (_cachedRawHwid) {
          storage.saveString(FLEX_HWID_STORAGE_KEY, _cachedRawHwid).catch(() => {});
        }
      })
      .catch(() => {});
  }

  return _cachedRawHwid;
}

export function getHwid(): string {
  return initPersistedHwid();
}

export function getHwidHash(): string {
  const raw = getHwid();
  const digest = sha256(`${raw}${FLEX_HWID_SALT}`);
  return Buffer.from(digest).toString("hex");
}
