/**
 * HWID — stable per-device identifier, the mobile equivalent of the desktop
 * `apps/ledger-live-desktop/src/main/hwid.ts`. Built from native device info
 * (unique vendor/installation id, model, OS) so the same physical device always
 * yields the same HWID and a key stays bound across app reinstalls.
 */
import {
  getModel,
  getBrand,
  getSystemVersion,
  getUniqueIdSync,
  getDeviceNameSync,
  getSystemName,
} from "react-native-device-info";
import { sha256 } from "@ledgerhq/live-common/crypto/index";
import { FLEX_HWID_SALT } from "./constants";

function getHwid(): string {
  let raw: string;
  try {
    const platform = getSystemName();
    const parts = [
      platform.toUpperCase(),
      getUniqueIdSync() || "",
      getModel() || "",
      getBrand() || "",
      getSystemVersion() || "",
      (getDeviceNameSync() || "").slice(0, 64),
    ];
    raw = parts.join("|");
  } catch {
    raw = `UNKNOWN|${getUniqueIdSync?.() || ""}`;
  }

  if (!raw || raw.length < 10) {
    raw = `FALLBACK|${getUniqueIdSync?.() || "mobile"}`;
  }

  return raw
    .split("|")
    .map(s => s.trim())
    .join("|")
    .replace(/\s+/g, " ")
    .trim();
}

export function getHwidHash(): string {
  const raw = getHwid();
  const digest = sha256(`${raw}${FLEX_HWID_SALT}`);
  return Buffer.from(digest).toString("hex");
}
