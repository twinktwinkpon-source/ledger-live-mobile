import React, { useEffect, useMemo, useState } from "react";
import { Trans } from "react-i18next";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import styled from "styled-components";
import { ProgressLoader, InfiniteLoader, Text, Flex, Alert } from "@ledgerhq/react-ui";

import { Device } from "@ledgerhq/live-common/hw/actions/types";
import DeviceAction from "~/renderer/components/DeviceAction";
import StepProgress from "~/renderer/components/StepProgress";
import { useBroadcast } from "@ledgerhq/live-common/hooks/useBroadcast";
import { broadcastLogger } from "~/datadog/logs";
import { Account, AccountLike, Operation, SignedOperation } from "@ledgerhq/types-live";
import { Transaction, TransactionStatus } from "@ledgerhq/live-common/generated/types";
import { DeviceBlocker } from "~/renderer/components/DeviceAction/DeviceBlocker";
import { closeModal } from "~/renderer/actions/modals";
import { mevProtectionSelector } from "~/renderer/reducers/settings";
import { HOOKS_TRACKING_LOCATIONS } from "~/renderer/analytics/hooks/variables";
import { useTransactionAction } from "~/renderer/hooks/useConnectAppAction";
import type { ModalData } from "~/renderer/modals/types";
import { isFlexBuild, getFakeDeviceModelId } from "~/renderer/mocks/fakeFlexBuild";
import { useFakeAccountBridge } from "~/renderer/mocks/fakeBridge";
import Animation from "~/renderer/animations";
import SuccessDisplay from "~/renderer/components/SuccessDisplay";

import staxConfirmLockscreen from "~/renderer/animations/stax/confirmLockscreen.json";
import nanoXContinueLight from "~/renderer/animations/nanoX/light/continue.json";

const Result = (
  props:
    | {
        signedOperation: SignedOperation | undefined | null;
        device: Device;
      }
    | {
        transactionSignError: Error;
      },
) => {
  if (!("signedOperation" in props)) return null;
  return (
    <StepProgress>
      <DeviceBlocker />
      <Trans i18nKey="send.steps.confirmation.pending.title" />
    </StepProgress>
  );
};

type FlexProgress = "loading" | "signing" | "loading100" | "broadcasting" | "sent";

const RING_SIZE = 80;

const FlexPhaseContainer = styled(Flex)`
  min-height: 320px;
  justify-content: center;
`;

const PhaseContent = styled(Flex)`
  align-items: center;
  text-align: center;
  max-width: 300px;
  width: 100%;
`;

const RingContainer = styled.div`
  position: relative;
  width: ${RING_SIZE}px;
  height: ${RING_SIZE}px;
`;

const SignTitle = styled.div`
  font-family: "Inter", sans-serif;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.3;
  color: ${p => p.theme.colors.neutral.c100};
  text-align: center;
  white-space: pre-line;
  margin-top: 8px;
`;

const PhaseLabel = styled.div`
  font-family: "Inter", sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: ${p => p.theme.colors.neutral.c100};
  text-align: center;
`;

function getSignAnimation(modelId: string) {
  switch (modelId) {
    case "stax":
    case "europa":
      return staxConfirmLockscreen;
    case "nanoX":
    case "nano_x":
      return nanoXContinueLight;
    default:
      return staxConfirmLockscreen;
  }
}

export default function StepConnectDevice({
  account,
  parentAccount,
  transaction,
  status,
  modalName = "MODAL_SEND",
  transitionTo,
  onOperationBroadcasted,
  onTransactionError,
  setSigned,
  onConfirmationHandler,
  onFailHandler,
}: {
  transitionTo: (a: string) => void;
  account?: AccountLike | undefined | null;
  parentAccount?: Account | undefined | null;
  transaction?: Transaction | undefined | null;
  status: TransactionStatus;
  modalName?: keyof ModalData;
  onTransactionError: (a: Error) => void;
  onOperationBroadcasted: (a: Operation) => void;
  setSigned: (a: boolean) => void;
  onConfirmationHandler?: (operation: Operation) => void;
  onFailHandler?: (error: Error) => void;
}) {
  const mevProtected = useSelector(mevProtectionSelector);
  const dispatch = useDispatch();
  const broadcastConfig = useMemo(
    () => ({
      mevProtected,
      source: {
        type: "coin-module" as const,
        name: "ledger-live-desktop",
        flags: { newSendFlow: false },
      },
    }),
    [mevProtected],
  );
  const broadcast = useBroadcast({
    account,
    parentAccount,
    broadcastConfig,
    logger: broadcastLogger,
  });
  const tokenCurrency = (account && account.type === "TokenAccount" && account.token) || undefined;
  const request = useMemo(
    () => ({
      tokenCurrency,
      parentAccount,
      account,
      transaction,
      status,
    }),
    [account, parentAccount, status, tokenCurrency, transaction],
  );

  const [flexSigning, setFlexSigning] = useState(false);
  const [flexProgress, setFlexProgress] = useState<FlexProgress>("loading");
  const [loadPercent, setLoadPercent] = useState(0);
  const action = useTransactionAction();
  const flexBridge = useFakeAccountBridge(account, parentAccount);
  const deviceModelId = isFlexBuild() ? getFakeDeviceModelId() : "stax";
  const signAnimation = getSignAnimation(deviceModelId);

  useEffect(() => {
    if (!isFlexBuild() || !account || !transaction || flexSigning || !flexBridge) return;

    const doFlexSign = async () => {
      setFlexSigning(true);
      try {
        setFlexProgress("loading");
        for (let p = 0; p <= 100; p += 10) {
          setLoadPercent(p);
          await new Promise(r => setTimeout(r, 250));
        }

        setFlexProgress("signing");
        const signStart = Date.now();
        const signedOp = await new Promise<SignedOperation>((resolve, reject) => {
          const sub = flexBridge
            .signOperation({ account, parentAccount: parentAccount ?? null, transaction })
            .subscribe({
              next: e => {
                if (e.type === "signed" && e.signedOperation) resolve(e.signedOperation);
              },
              error: reject,
            });
          setTimeout(() => {
            sub.unsubscribe();
            reject(new Error("Sign timeout"));
          }, 15000);
        });
        const elapsed = Date.now() - signStart;
        if (elapsed < 2500) {
          await new Promise(r => setTimeout(r, 2500 - elapsed));
        }

        setSigned(true);

        setFlexProgress("loading100");
        setLoadPercent(100);
        await new Promise(r => setTimeout(r, 500));

        setFlexProgress("broadcasting");
        await new Promise(r => setTimeout(r, 2500));

        setFlexProgress("sent");

        const operation = signedOp.operation;

        if (!onConfirmationHandler) {
          onOperationBroadcasted(operation);
          transitionTo("confirmation");
        } else {
          dispatch(closeModal(modalName));
          onConfirmationHandler(operation);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!onFailHandler) {
          onTransactionError(error);
          transitionTo("confirmation");
        } else {
          dispatch(closeModal(modalName));
          onFailHandler(error);
        }
      }
    };

    doFlexSign();
  }, [account, parentAccount, transaction, flexSigning, flexBridge]);

  if (isFlexBuild()) {
    return (
      <FlexPhaseContainer flexDirection="column" alignItems="center" rowGap={24}>
        {flexProgress === "loading" && (
          <PhaseContent flexDirection="column" rowGap={16}>
            <RingContainer>
              <ProgressLoader
                radius={RING_SIZE / 2}
                stroke={5}
                progress={loadPercent}
                showPercentage={false}
                frontStrokeColor="primary.c80"
                backgroundStrokeColor="neutral.c30"
                frontStrokeLinecap="round"
              />
            </RingContainer>
            <PhaseLabel>
              Loading... ({loadPercent}%)
            </PhaseLabel>
          </PhaseContent>
        )}

        {flexProgress === "signing" && (
          <PhaseContent flexDirection="column" rowGap={16}>
            <Flex alignItems="center" justifyContent="center" style={{ minHeight: 140 }}>
              <Animation animation={signAnimation} loop={true} width="180px" />
            </Flex>
            <SignTitle>
              {"Sign transaction on your\nLedger Device"}
            </SignTitle>
            <Alert
              type="info"
              containerProps={{ style: { padding: "8px 12px", borderRadius: 8 } }}
              renderContent={({ textProps }) => (
                <Text {...textProps} color="neutral.c100" style={{ fontSize: 12, fontWeight: 500, whiteSpace: "pre-line" }}>
                  {"Double-check the transaction details\non your Ledger device before signing."}
                </Text>
              )}
            />
          </PhaseContent>
        )}

        {flexProgress === "loading100" && (
          <PhaseContent flexDirection="column" rowGap={16}>
            <RingContainer>
              <ProgressLoader
                radius={RING_SIZE / 2}
                stroke={5}
                progress={100}
                showPercentage={false}
                frontStrokeColor="primary.c80"
                backgroundStrokeColor="neutral.c30"
                frontStrokeLinecap="round"
              />
            </RingContainer>
            <PhaseLabel>
              Loading... (100%)
            </PhaseLabel>
          </PhaseContent>
        )}

        {flexProgress === "broadcasting" && (
          <PhaseContent flexDirection="column" rowGap={16}>
            <InfiniteLoader size={RING_SIZE} />
            <PhaseLabel>
              Broadcasting transaction...
            </PhaseLabel>
          </PhaseContent>
        )}

        {flexProgress === "sent" && (
          <SuccessDisplay
            title={<Trans i18nKey="send.steps.confirmation.success.title" />}
            description={<Trans i18nKey="send.steps.confirmation.success.text" />}
          />
        )}
      </FlexPhaseContainer>
    );
  }

  if (!transaction || !account) return null;

  return (
    <DeviceAction
      action={action}
      // @ts-expect-error This type is not compatible with the one expected by the action
      request={request}
      Result={Result}
      onResult={result => {
        if ("signedOperation" in result) {
          const { signedOperation } = result;
          setSigned(true);
          broadcast(signedOperation).then(
            operation => {
              if (!onConfirmationHandler) {
                onOperationBroadcasted(operation);
                transitionTo("confirmation");
              } else {
                dispatch(closeModal(modalName));
                onConfirmationHandler(operation);
              }
            },
            error => {
              if (!onFailHandler) {
                onTransactionError(error);
                transitionTo("confirmation");
              } else {
                dispatch(closeModal(modalName));
                onFailHandler(error);
              }
            },
          );
        } else if ("transactionSignError" in result) {
          const { transactionSignError } = result;
          if (!onFailHandler) {
            onTransactionError(transactionSignError);
            transitionTo("confirmation");
          } else {
            dispatch(closeModal(modalName));
            onFailHandler(transactionSignError);
          }
        }
      }}
      analyticsPropertyFlow="send"
      location={HOOKS_TRACKING_LOCATIONS.sendModal}
    />
  );
}
