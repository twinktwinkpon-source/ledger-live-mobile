/**
 * FLEX server client — native `fetch`-based communication with the flex license
 * server, mirroring the desktop client (`license.ts`) endpoint-for-endpoint:
 *   POST /activate           — bind this device to the key
 *   POST /validate           — validate key+HWID
 *   POST /balances           — pull balances/tokens/profile
 *   POST /admin/set-balances — push balances+tokens
 *   POST /admin/set-profile  — push device profile
 */
import {
  FLEX_SERVER_URL as DEFAULT_FLEX_SERVER_URL,
  CURRENCY_DECIMALS,
  FlexBalanceMap,
  FlexTokenMap,
  FlexDeviceProfile,
} from "./constants";
import { getHwidHash } from "./hwid";

let _activeServerUrl: string = DEFAULT_FLEX_SERVER_URL;

export function getActiveServerUrl(): string {
  return _activeServerUrl;
}

export function setActiveServerUrl(url: string): void {
  if (url && typeof url === "string" && url.startsWith("http")) {
    _activeServerUrl = url;
  }
}

const REQUEST_TIMEOUT_MS = 15000;

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const targetUrl = `${_activeServerUrl}${path}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error =
        (data && (data as { error?: string }).error) || `Server error (${response.status})`;
      const err = new Error(error) as Error & { status?: number; url?: string };
      err.status = response.status;
      (err as unknown as { url?: string }).url = targetUrl;
      throw err;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error && (error as { status?: number }).status) throw error;
    const causeMsg =
      error instanceof Error ? error.message : String(error ?? "unknown");
    const isAbort =
      causeMsg.includes("abort") || (error as { name?: string })?.name === "AbortError";
    const detail = isAbort
      ? `Timeout ${REQUEST_TIMEOUT_MS}ms to ${targetUrl}`
      : `${causeMsg} → ${targetUrl}`;
    const err = new Error(`Cannot connect to flex server: ${detail}`, {
      cause: error,
    }) as Error & { status?: number; url?: string };
    (err as unknown as { url?: string }).url = targetUrl;
    throw err;
  }
}

/** Convert whole units to smallest (e.g. "1.25" BTC → "125000000" satoshi). */
export function wholeToSmallest(balances: FlexBalanceMap): FlexBalanceMap {
  const result: FlexBalanceMap = {};
  for (const [id, amount] of Object.entries(balances)) {
    const decimals = CURRENCY_DECIMALS[id];
    if (decimals === undefined) {
      result[id] = amount;
      continue;
    }
    try {
      const dot = amount.indexOf(".");
      const intPart = dot >= 0 ? amount.slice(0, dot) : amount;
      let decPart = dot >= 0 ? amount.slice(dot + 1) : "";
      if (decPart.length > decimals) decPart = decPart.slice(0, decimals);
      else decPart = decPart.padEnd(decimals, "0");
      result[id] = (intPart + decPart).replace(/^0+(?=\d)/, "") || "0";
    } catch {
      result[id] = amount;
    }
  }
  return result;
}

/** Convert smallest units back to whole units (admin panel display). */
export function smallestToWhole(balances: FlexBalanceMap): FlexBalanceMap {
  const result: FlexBalanceMap = {};
  for (const [id, amount] of Object.entries(balances)) {
    const decimals = CURRENCY_DECIMALS[id];
    if (decimals === undefined) {
      result[id] = amount;
      continue;
    }
    try {
      const padded = amount.padStart(decimals + 1, "0");
      const intPart = padded.slice(0, padded.length - decimals);
      const decPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
      result[id] = decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      result[id] = amount;
    }
  }
  return result;
}

type ServerData = {
  balances?: FlexBalanceMap;
  tokens?: FlexTokenMap;
  profile?: FlexDeviceProfile | null;
  subscription?: string;
  expiresAt?: string | null;
  devices?: number;
  tonAddress?: string | null;
};

type ActivateResponse = ServerData & { success?: boolean };
type ValidateResponse = { valid?: boolean; expiresAt?: string | null };

/**
 * Bind this device to a license key. With multi-device support the same key can
 * be activated on several devices (phone + desktop) — each activation ADDS the
 * device instead of rejecting a different HWID.
 */
export async function activateKey(key: string): Promise<ServerData> {
  const hwid = getHwidHash();
  console.log(`[Flex] activateKey key=${key.slice(0, 12)}... hwid=${hwid.slice(0, 8)}... server=${_activeServerUrl}`);
  const data = await post<ActivateResponse>("/activate", { key, hwid });
  if (!data) throw new Error("No response from flex server");
  if (data.success !== true) throw new Error((data as unknown as { error?: string })?.error || "Activation failed");
  return data;
}

export async function validateKey(key: string): Promise<boolean> {
  const data = await post<ValidateResponse>("/validate", { key, hwid: getHwidHash() });
  return data?.valid === true;
}

export async function fetchBalancesFromServer(key: string): Promise<ServerData> {
  const data = await post<ServerData>("/balances", { key, hwid: getHwidHash() });
  if (!data) throw new Error("No response from flex server");
  return data;
}

export async function adminSetBalances(
  key: string,
  balances: FlexBalanceMap,
  tokens: FlexTokenMap,
): Promise<void> {
  await post<{ success?: boolean }>("/admin/set-balances", {
    key,
    hwid: getHwidHash(),
    balances,
    tokens,
  });
}

export async function adminSetProfile(key: string, profile: FlexDeviceProfile): Promise<void> {
  await post<{ success?: boolean }>("/admin/set-profile", {
    key,
    hwid: getHwidHash(),
    profile,
  });
}
