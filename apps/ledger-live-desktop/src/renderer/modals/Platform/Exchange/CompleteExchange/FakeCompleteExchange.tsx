/**
 * FakeCompleteExchange - FLEX builds only.
 *
 * Mirrors the native swap "Broadcasting / Confirm on device" screen but signs
 * and broadcasts via a fake flow (no physical Ledger). Resolves with a fake
 * Operation so the UI shows the native Swap success state.
 */
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Spinner, Text } from "@ledgerhq/react-ui";
import DeviceIllustration from "~/renderer/components/DeviceIllustration";
import type { Operation } from "@ledgerhq/types-live";

type Props = {
  data: {
    onResult: (operation: Operation) => void;
    onCancel?: (e: Error) => void;
    exchange?: any;
  };
  onClose?: () => void;
};

function randomHash(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}

export function FakeCompleteExchange({ data, onClose }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const steps = [
    t("swap.exchange.broadcasting"),
    t("swap.exchange.confirming"),
    t("swap.exchange.success"),
  ];

  useEffect(() => {
    const timers = [600, 1400].map(d => setTimeout(() => setStep(s => s + 1), d));
    const finalTimer = setTimeout(() => {
      const operation: Operation = {
        id: `flex-swap-${Date.now()}-OUT`,
        hash: randomHash(),
        type: "OUT",
        value: data.exchange?.fromAccount?.balance || (0 as any),
        fee: 0 as any,
        date: new Date(),
        blockHeight: 0,
        senders: [],
        recipients: [],
        status: "confirmed",
        extra: {},
        blockHash: "",
        subOperations: [],
        accountId: data.exchange?.fromAccount?.id ?? "",
      } as Operation;
      data.onResult(operation);
    }, 2000);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(finalTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flex={1} alignItems="center" justifyContent="center" px={6} py={8}>
      <Box alignItems="center" justifyContent="center" mb={6}>
        <DeviceIllustration size={120} deviceId="nanoX" />
      </Box>
      <Text variant="h3" mb={3} textAlign="center">
        {t("swap.exchange.title", { device: "Ledger" })}
      </Text>
      <Spinner size={32} mb={4} />
      <Text variant="bodyLineHeight" color="palette.text.shade60" textAlign="center">
        {steps[Math.min(step, steps.length - 1)]}
      </Text>
      <Box mt={2} alignItems="center">
        {steps.map((_, i) => (
          <Box
            key={i}
            width={40}
            height={4}
            mx={1}
            borderRadius={2}
            backgroundColor={i <= step ? "palette.primary.main" : "palette.divider"}
          />
        ))}
      </Box>
    </Box>
  );
}

export default FakeCompleteExchange;
