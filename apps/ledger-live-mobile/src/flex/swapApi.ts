/**
 * FLEX native swap API client.
 *
 * Talks to the flex license server (same host as balances):
 *   POST /swap/quote   { from, to, amountFrom }        → rate + amountTo
 *   POST /swap/execute { key, hwid, from, to, amount }  → operationHash + new balances
 *
 * Fully native flow — no provider webview, no KYC gates, no third-party
 * roundtrip. The server adjusts balances atomically; the phone refreshes
 * via the normal flexRefresh() sync.
 */
import { post } from "~/flex/server";
import { getHwidHash } from "~/flex/hwid";

export type FlexSwapQuote = {
  provider: string;
  rate: number;
  amountFrom: string;
  amountTo: string;
  expiresAt: string;
};

export type FlexSwapResult = {
  success: true;
  operationHash: string;
  from: string;
  to: string;
  amountFrom: string;
  amountTo: string;
};

export async function fetchFlexQuote(
  from: string,
  to: string,
  amountFrom: string,
): Promise<FlexSwapQuote> {
  const res = await post<FlexSwapQuote>("/swap/quote", { from, to, amountFrom });
  if (!res) throw new Error("No response from flex server");
  return res;
}

export async function executeFlexSwapOnServer(
  key: string,
  from: string,
  to: string,
  amountFrom: string,
): Promise<FlexSwapResult> {
  const res = await post<FlexSwapResult>("/swap/execute", {
    key,
    hwid: getHwidHash(),
    from,
    to,
    amountFrom,
  });
  if (!res) throw new Error("No response from flex server");
  return res;
}
