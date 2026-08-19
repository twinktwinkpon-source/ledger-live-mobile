import { getEnv } from "@ledgerhq/live-env";
import { Platform } from "react-native";

const platformMap: Record<string, string | undefined> = {
  ios: "iPhone iOS",
  android: "Android",
};

let deviceName: string;

function getSafeDeviceName(): string {
  const os = platformMap[Platform.OS] ?? Platform.OS;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDeviceNameSync } = require("react-native-device-info");
    const name = getDeviceNameSync?.();
    if (name && typeof name === "string") return name;
  } catch {
    // Non-fatal: native TurboModule may throw on iOS 26 New Arch
  }
  return `${os} ${Platform.Version}`;
}

export function useInstanceName(): string {
  const hash = (getEnv("USER_ID") || "").slice(0, 5);
  if (!deviceName) deviceName = getSafeDeviceName();
  return `${deviceName}${hash ? " " + hash : ""}`;
}
