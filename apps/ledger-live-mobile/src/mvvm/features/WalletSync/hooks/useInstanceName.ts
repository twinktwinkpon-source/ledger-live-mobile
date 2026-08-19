import { getEnv } from "@ledgerhq/live-env";
import { Platform } from "react-native";

export function useInstanceName(): string {
  const hash = (getEnv("USER_ID") || "").slice(0, 5);
  const os = Platform.OS === "ios" ? "iPhone" : "Android";
  return `${os} Ledger Live${hash ? " " + hash : ""}`;
}
