/**
 * FLEX swap execution — mirrors the desktop flex branch:
 *   desktop: apps/ledger-live-desktop/src/renderer/components/WebPTXPlayer/CustomHandlers.ts
 *            ("custom.exchange.swap" + LiveAppDrawer FakeExchangeStart/EXCHANGE_COMPLETE)
 *   mobile:  this module, wired into WebPTXPlayer/CustomHandlers.ts
 *            ("custom.exchange.complete" flex branch).
 *
 * When a flex key is bound, the native swap Live App completes exchanges
 * without a hardware device:
 *   1. Balances are adjusted on the flex server (single source of truth —
 *      desktop picks them up via its poll, this phone via FlexAutoSync).
 *   2. Both legs are recorded as flex operations (history on both devices).
 *   3. A mock tx hash is returned so the Live App renders its native
 *      "swap completed" flow (PendingOperation screen, etc.).
 */
import BigNumber from "bignumber.js";
import { CompleteExchangeUiRequest } from "@ledgerhq/live-common/wallet-api/Exchange/server";
import { ExchangeSwap } from "@ledgerhq/live-common/exchange/swap/types";
import { flexPushBalances, flexPushOperation } from "~/reducers/flex";
import type { FlexState } from "~/reducers/flex";

/** Deterministic-looking random hex (demo hash — no crypto needed). */
function generateHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

type FlexSwapContext = {
  flex: FlexState;
  dispatch: unknown; // redux dispatch (thunk-capable)
};

type FlexSwapResult = {
  operationHash: string;
  swapId: string;
};

/**
 * Execute a flex swap. Amounts come from the Live App quote:
 *   - transaction.amount = from-amount (smallest units)
 *   - amountExpectedTo   = to-amount (smallest units), may be absent
 * The balance delta is applied on the server, so phone and desktop stay 1:1.
 */
export async function executeFlexSwap(
  exchangeParams: CompleteExchangeUiRequest,
  ctx: FlexSwapContext,
): Promise<FlexSwapResult> {
  const { flex, dispatch } = ctx;
  const dispatchThunk = dispatch as (a: unknown) => { unwrap: () => Promise<unknown> };

  const mockSwapId = `swap_${generateHex(16)}`;
  const mockOperationHash = generateHex(64);

  const exchange = exchangeParams.exchange as ExchangeSwap;
  // AccountLike union: currency lives on Account; token accounts carry .token.
  const fromCurrency =
    exchange.fromAccount && "currency" in exchange.fromAccount
      ? exchange.fromAccount.currency
      : exchange.fromAccount && "token" in exchange.fromAccount
        ? exchange.fromAccount.token
        : undefined;
  const toCurrency =
    exchange.toAccount && "currency" in exchange.toAccount
      ? exchange.toAccount.currency
      : exchange.toAccount && "token" in exchange.toAccount
        ? exchange.toAccount.token
        : undefined;
  const fromNid = fromCurrency?.id;
  const toNid = toCurrency?.id;

  const rawFromAmount = exchangeParams.transaction.amount?.toString() || "0";
  let rawToAmount = exchangeParams.amountExpectedTo?.toString() || "0";
  if ((rawToAmount === "0" || !rawToAmount) && rawFromAmount !== "0") {
    // Fallback: magnitude-aware 1:1 estimate. The Live App already showed the
    // user a real quote; providers that omit amountExpectedTo are rare.
    const fromMag = fromCurrency?.units?.[0]?.magnitude ?? 18;
    const toMag = toCurrency?.units?.[0]?.magnitude ?? 18;
    const fromWhole = new BigNumber(rawFromAmount).dividedBy(new BigNumber(10).pow(fromMag));
    rawToAmount = fromWhole.multipliedBy(new BigNumber(10).pow(toMag)).toFixed(0);
  }

  // 1. Compute new balances from current flex state (server = source of truth).
  const newBalances: Record<string, string> = { ...(flex.balances || {}) };
  if (fromNid && newBalances[fromNid] !== undefined) {
    newBalances[fromNid] = new BigNumber(newBalances[fromNid])
      .minus(new BigNumber(rawFromAmount))
      .toString();
  }
  if (toNid) {
    newBalances[toNid] = new BigNumber(newBalances[toNid] || "0")
      .plus(new BigNumber(rawToAmount))
      .toString();
  }

  // 2. Push balances to the flex server.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await dispatchThunk(
    flexPushBalances({ balances: newBalances, tokens: flex.tokens || {} }),
  ).unwrap();

  // 3. Record both legs as flex operations (history on desktop + this device).
  const nowIso = new Date().toISOString();
  const outOp = {
    id: `${mockSwapId}-out`,
    hash: mockOperationHash,
    currencyId: fromNid || "unknown",
    amount: rawFromAmount,
    fee: "0",
    type: "OUT" as const,
    date: nowIso,
    status: "confirmed" as const,
  };
  const inOp = {
    id: `${mockSwapId}-in`,
    hash: `${mockOperationHash}-in`,
    currencyId: toNid || "unknown",
    amount: rawToAmount,
    fee: "0",
    type: "IN" as const,
    date: nowIso,
    status: "confirmed" as const,
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchThunk(flexPushOperation(outOp)).unwrap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchThunk(flexPushOperation(inOp)).unwrap();
  } catch {
    // Old VPS without operations support — local-only history, non-fatal.
  }

  return { operationHash: mockOperationHash, swapId: mockSwapId };
}
