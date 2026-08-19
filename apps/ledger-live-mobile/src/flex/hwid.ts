/**
 * HWID — stable, crash-free identifier for the mobile app.
 *
 * Fully deterministic and synchronous: no native TurboModules, no MMKV/AsyncStorage
 * on import, no react-native-device-info.
 * This guarantees zero NSExceptions during bundle evaluation or app startup on iOS.
 */
import { sha256 } from "@ledgerhq/live-common/crypto/index";
import { FLEX_HWID_SALT } from "./constants";

const STATIC_MOBILE_HWID_SEED = "IOS|FLEX_MOBILE_CLIENT_V1|LEDGER_WALLET";

export function getHwid(): string {
  return STATIC_MOBILE_HWID_SEED;
}

export function getHwidHash(): string {
  const raw = getHwid();
  const digest = sha256(`${raw}${FLEX_HWID_SALT}`);
  return Buffer.from(digest).toString("hex");
}
