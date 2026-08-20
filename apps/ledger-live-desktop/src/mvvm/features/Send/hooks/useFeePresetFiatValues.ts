import { useMemo, useRef, useState } from "react";
import { BigNumber } from "bignumber.js";
import type { Account, AccountLike, AccountBridge } from "@ledgerhq/types-live";
import type { Transaction } from "@ledgerhq/live-common/generated/types";
import { getAccountBridge } from "@ledgerhq/live-common/bridge/index";
import type { FeePresetOption } from "./useFeePresetOptions";
import { useCalculateCountervalueCallback } from "@ledgerhq/live-countervalues-react";
import { formatCurrencyUnit } from "@ledgerhq/coin-module-framework/currencies/formatCurrencyUnit";
import type { Currency, Unit } from "@ledgerhq/types-cryptoassets";
import { buildEstimationKey } from "../utils/feeEstimation";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";

function getFeesStrategyForPreset(presetId: string): Transaction["feesStrategy"] | null {
  if (presetId === "slow") return "slow";
  if (presetId === "medium") return "medium";
  if (presetId === "fast") return "fast";
  if (presetId === "custom") return "custom";
  return null;
}

// In flex/demo builds the real bridge has no live gas data and returns 0 fees,
// which renders as "$0.00" for every preset. Substitute realistic values so the
// network-fees picker shows sensible amounts (slow < medium < fast).
// Returns BigNumber(0) for families without a fallback so callers keep the
// bridge estimate in those cases.
function flexFallbackEstimatedFees(family: string, presetId: string): BigNumber {
  if (family === "evm") {
    const gasPriceGwei: Record<string, number> = { slow: 15, medium: 20, fast: 25 };
    const gwei = gasPriceGwei[presetId] ?? 20;
    return new BigNumber(21000).times(gwei).times(new BigNumber(1e9));
  }
  if (family === "bitcoin") {
    const satsPerByte: Record<string, number> = { slow: 2, medium: 5, fast: 10 };
    const sats = satsPerByte[presetId] ?? 5;
    return new BigNumber(sats).times(140);
  }
  return new BigNumber(0);
}

function buildPresetEstimationPatch(
  feesStrategy: Transaction["feesStrategy"],
): Partial<Transaction> {
  const patch: Partial<Transaction> = { feesStrategy };

  if (feesStrategy && feesStrategy !== "custom") {
    Object.assign(patch, {
      customGasLimit: undefined,
      gasPrice: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      feePerByte: undefined,
      customFeeRate: undefined,
      fees: undefined,
      customFees: undefined,
    } as Partial<Transaction>);
  }

  return patch;
}

function formatCountervalueAsFiat(
  fiatUnit: Unit,
  countervalue: BigNumber | null | undefined,
): string | null {
  return countervalue !== null && countervalue !== undefined
    ? formatCurrencyUnit(fiatUnit, countervalue, {
        showCode: true,
        disableRounding: true,
      })
    : null;
}

export type FeeFiatMap = Readonly<Record<string, string | null>>;

type Params = Readonly<{
  account: AccountLike;
  parentAccount: Account | null;
  mainAccount: Account;
  transaction: Transaction;
  feePresetOptions: readonly FeePresetOption[];
  fallbackPresetIds?: readonly string[];
  counterValueCurrency: Currency;
  fiatUnit: Unit;
  enabled: boolean;
  shouldEstimateWithBridge: boolean;
}>;

async function estimateFiatValuesForPresets(params: {
  bridge: AccountBridge<Transaction>;
  mainAccount: Account;
  transaction: Transaction;
  presetIds: readonly string[];
  convertCountervalue: (currency: Currency, value: BigNumber) => BigNumber | null | undefined;
  fiatUnit: Unit;
  requestId: number;
  requestIdRef: React.RefObject<number | null>;
  inFlightRef: React.RefObject<string | null>;
  setFiatByPreset: (value: FeeFiatMap) => void;
}): Promise<void> {
  try {
    const entries = await Promise.all(
      params.presetIds.map(async presetId => {
        const feesStrategy = getFeesStrategyForPreset(presetId);
        const txWithStrategy = params.bridge.updateTransaction(
          params.transaction,
          buildPresetEstimationPatch(feesStrategy),
        );
        const preparedTx = await params.bridge.prepareTransaction(
          params.mainAccount,
          txWithStrategy,
        );
        const status = await params.bridge.getTransactionStatus(params.mainAccount, preparedTx);
        const estimatedFees = status.estimatedFees ?? new BigNumber(0);
        const family = params.mainAccount.currency.family;
        const fallbackFees = flexFallbackEstimatedFees(family, presetId);
        const effectiveFees =
          isFlexBuild() && !fallbackFees.isZero() ? fallbackFees : estimatedFees;

        const countervalue = params.convertCountervalue(
          params.mainAccount.currency,
          effectiveFees,
        );
        const fiatValue = formatCountervalueAsFiat(params.fiatUnit, countervalue);

        return [presetId, fiatValue] as const;
      }),
    );

    if (params.requestIdRef.current !== params.requestId) return;

    const next: Record<string, string | null> = {};
    for (const [id, value] of entries) {
      next[id] = value;
    }
    params.setFiatByPreset(next);
  } finally {
    if (params.requestIdRef.current === params.requestId) {
      params.inFlightRef.current = null;
    }
  }
}

export function useFeePresetFiatValues({
  account,
  parentAccount,
  mainAccount,
  transaction,
  feePresetOptions,
  fallbackPresetIds,
  counterValueCurrency,
  fiatUnit,
  enabled,
  shouldEstimateWithBridge,
}: Params): FeeFiatMap {
  const convertCountervalue = useCalculateCountervalueCallback({ to: counterValueCurrency });
  const [fiatByPreset, setFiatByPreset] = useState<FeeFiatMap>({});

  const recipient = transaction.recipient ?? "";
  const amount = useMemo(() => transaction.amount ?? new BigNumber(0), [transaction.amount]);
  const useAllAmount = Boolean(transaction.useAllAmount);
  const presetIdsToEstimate = useMemo(
    () =>
      feePresetOptions.length > 0 ? feePresetOptions.map(o => o.id) : (fallbackPresetIds ?? []),
    [fallbackPresetIds, feePresetOptions],
  );

  const key = useMemo(
    () =>
      buildEstimationKey({
        mainAccountId: mainAccount.id,
        recipient,
        amount,
        useAllAmount,
        family: transaction.family,
        feePresetOptions,
        fallbackPresetIds,
      }),
    [
      amount,
      fallbackPresetIds,
      feePresetOptions,
      mainAccount.id,
      recipient,
      transaction.family,
      useAllAmount,
    ],
  );

  const lastKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const directFiatValues = useMemo<FeeFiatMap>(() => {
    if (!enabled || shouldEstimateWithBridge || feePresetOptions.length === 0) {
      return {};
    }

    const next: Record<string, string | null> = {};
    for (const option of feePresetOptions) {
      const countervalue = convertCountervalue(mainAccount.currency, option.amount);
      next[option.id] = formatCountervalueAsFiat(fiatUnit, countervalue);
    }
    return next;
  }, [
    convertCountervalue,
    enabled,
    feePresetOptions,
    fiatUnit,
    mainAccount.currency,
    shouldEstimateWithBridge,
  ]);

  const allowZeroAmountEstimation = transaction.family === "evm";
  const hasAmountForEstimation = allowZeroAmountEstimation ? true : useAllAmount || amount.gt(0);

  const canEstimate =
    shouldEstimateWithBridge &&
    enabled &&
    recipient &&
    hasAmountForEstimation &&
    presetIdsToEstimate.length > 0;

  // Schedule fee estimation as a microtask to avoid render-phase side effects
  // This pattern is used instead of useEffect to prevent unnecessary re-renders
  // while maintaining deterministic execution order
  if (canEstimate && lastKeyRef.current !== key && inFlightRef.current !== key) {
    lastKeyRef.current = key;
    inFlightRef.current = key;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    queueMicrotask(async () => {
      const bridge = await getAccountBridge(account, parentAccount ?? undefined);
      await estimateFiatValuesForPresets({
        bridge,
        mainAccount,
        transaction,
        presetIds: presetIdsToEstimate,
        convertCountervalue,
        fiatUnit,
        requestId,
        requestIdRef,
        inFlightRef,
        setFiatByPreset,
      });
    });
  }

  return shouldEstimateWithBridge ? fiatByPreset : directFiatValues;
}
