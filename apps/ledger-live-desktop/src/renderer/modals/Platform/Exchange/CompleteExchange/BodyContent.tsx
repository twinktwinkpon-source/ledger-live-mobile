import React, { useEffect } from "react";
import { Exchange } from "@ledgerhq/live-common/exchange/types";
import { Account, AccountLike, Operation, SignedOperation } from "@ledgerhq/types-live";
import { Transaction } from "@ledgerhq/live-common/generated/types";
import { createAction } from "@ledgerhq/live-common/hw/actions/completeExchange";
import completeExchange from "@ledgerhq/live-common/exchange/platform/completeExchange";
import { Currency, TokenCurrency } from "@ledgerhq/types-cryptoassets";
import { Trans } from "react-i18next";
import { Flex, Text } from "@ledgerhq/react-ui";
import useTheme from "~/renderer/hooks/useTheme";
import { getDeviceAnimation } from "~/renderer/components/DeviceAction/animations";
import Animation from "~/renderer/animations";
import BigSpinner from "~/renderer/components/BigSpinner";
import ErrorDisplay from "~/renderer/components/ErrorDisplay";
import DeviceAction from "~/renderer/components/DeviceAction";
import { TransactionBroadcastedContent } from "./TransactionBroadcastedContent";
import { ExchangeMode } from "./Body";
import { useTransactionAction } from "~/renderer/hooks/useConnectAppAction";
import { isFlexBuild, getFakeDevice } from "~/renderer/mocks/fakeFlexBuild";

const exchangeAction = createAction(completeExchange);

export type BodyContentProps = {
  error?: Error;
  signedOperation?: SignedOperation;
  signRequest?: {
    tokenCurrency: TokenCurrency | undefined;
    parentAccount: Account | null | undefined;
    account: AccountLike;
    transaction: Transaction;
    appName: string;
  } | null;
  request: {
    provider: string;
    exchange: Exchange;
    transaction: Transaction;
    binaryPayload: string;
    signature: string;
    exchangeType: number;
    rateType?: number;
    amountExpectedTo?: number;
  };
  result?: {
    swapId?: string;
    mode: ExchangeMode;
    provider: string;
    sourceCurrency: Currency;
    targetCurrency?: Currency;
    isEmbeddedSwap?: boolean;
    sponsored?: boolean;
  };
  onOperationSigned: (value: SignedOperation) => void;
  onTransactionComplete: (value: Transaction) => void;
  onViewDetails: (id: string) => void;
  onError: (error: Error) => void;
  onClose?: () => void;
};

export const BodyContent = (props: BodyContentProps) => {
  const action = useTransactionAction();
  const flex = isFlexBuild();
  const theme = useTheme().theme;
  const fakeDevice = getFakeDevice();
  const modelId = fakeDevice.modelId;

  // Flex: auto-advance Phase 1 → Phase 2
  useEffect(() => {
    if (!flex) return;
    if (props.error || props.result || props.signedOperation) return;
    if (!props.signRequest) {
      const timer = setTimeout(() => {
        props.onTransactionComplete(props.request.transaction);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [flex, props.error, props.result, props.signedOperation, props.signRequest, props.request.transaction, props.onTransactionComplete]);

  // Flex: auto-advance Phase 2 → Phase 3
  useEffect(() => {
    if (!flex) return;
    if (props.error || props.result || !props.signRequest || props.signedOperation) return;
    const timer = setTimeout(() => {
      const fakeOp: SignedOperation = {
        signature: "0x" + "f".repeat(130),
        operation: {
          id: `flex-swap-op-${Date.now()}`,
          hash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
          type: "OUT",
          value: (props.signRequest!.transaction as any)?.amount || 0,
          fee: 0,
          date: new Date(),
          blockHeight: 0,
          senders: [],
          recipients: [],
          status: "confirmed" as const,
          extra: {},
          blockHash: "",
          subOperations: [],
          accountId: props.signRequest!.account?.id ?? "",
        } as Operation,
        expirationDate: new Date(Date.now() + 86400000),
      };
      props.onOperationSigned(fakeOp);
    }, 2000);
    return () => clearTimeout(timer);
  }, [flex, props.error, props.result, props.signRequest, props.signedOperation, props.onOperationSigned]);

  if (props.error) {
    return <ErrorDisplay error={props.error} />;
  }

  if (props.result) {
    return (
      <TransactionBroadcastedContent
        swapId={props.result.swapId}
        mode={props.result.mode}
        provider={props.result.provider}
        sourceCurrency={props.result.sourceCurrency}
        targetCurrency={props.result.targetCurrency}
        isEmbeddedSwap={props.result.isEmbeddedSwap}
        sponsored={props.result.sponsored}
        onViewDetails={props.onViewDetails}
      />
    );
  }

  if (props.signedOperation) {
    return <BigSpinner size={40} />;
  }

  if (flex) {
    if (props.signRequest) {
      return (
        <Flex flexDirection="column" alignItems="center" justifyContent="center" flex={1} padding={6} rowGap={5}>
          <Animation animation={getDeviceAnimation(modelId, theme, "sign")} />
          <Text fontSize="24px" fontWeight="semiBold" textAlign="center">
            <Trans i18nKey="send.steps.confirmation.pending.title" />
          </Text>
          <Text color="neutral.c70" fontSize="14px" textAlign="center">
            <Trans i18nKey="DeviceAction.swap.confirmSwap" />
          </Text>
        </Flex>
      );
    }

    return (
      <Flex flexDirection="column" alignItems="center" justifyContent="center" flex={1} padding={6} rowGap={5}>
        <Animation animation={getDeviceAnimation(modelId, theme, "verify")} />
        <Text fontSize="24px" fontWeight="semiBold" textAlign="center">
          <Trans i18nKey="DeviceAction.swap.confirmSwap" />
        </Text>
        <Text color="neutral.c70" fontSize="14px" textAlign="center">
          <Trans i18nKey="DeviceAction.swap.notice.default" />
        </Text>
      </Flex>
    );
  }

  if (props.signRequest) {
    return (
      <DeviceAction
        key="sign"
        action={action}
        request={props.signRequest}
        onResult={result => {
          if ("transactionSignError" in result) {
            props.onError(result.transactionSignError);
          } else {
            props.onOperationSigned(result.signedOperation);
          }
        }}
      />
    );
  }

  return (
    <DeviceAction
      key="completeExchange"
      action={exchangeAction}
      request={props.request}
      onResult={result => {
        if ("completeExchangeError" in result) {
          props.onError(result.completeExchangeError);
        } else {
          props.onTransactionComplete(result.completeExchangeResult);
        }
      }}
    />
  );
};
