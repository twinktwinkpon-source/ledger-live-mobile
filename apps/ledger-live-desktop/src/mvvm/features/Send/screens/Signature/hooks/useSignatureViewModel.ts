import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackPage } from "~/renderer/analytics/segment";
import { getSendFlowTrackingProperties } from "../../../utils/tracking";
import type { Operation, SignedOperation } from "@ledgerhq/types-live";
import { useBroadcast } from "@ledgerhq/live-common/hooks/useBroadcast";
import { sendFeatures } from "@ledgerhq/live-common/bridge/descriptor/send/features";
import {
  addPendingOperation,
  getMainAccount,
  getRecentAddressesStore,
} from "@ledgerhq/live-common/account/index";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import { useTransactionAction } from "~/renderer/hooks/useConnectAppAction";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";
import { useFakeBroadcast } from "~/renderer/mocks/fakeBridge";
import { useFlowWizard } from "../../../../FlowWizard/FlowWizardContext";
import { useSendFlowActions, useSendFlowData } from "../../../context/SendFlowContext";
import { selectIsBuyDeviceOpen } from "LLD/features/BuyDevice/buyDeviceDialog";
import { hasOnboardedDeviceSelector, mevProtectionSelector } from "~/renderer/reducers/settings";
import { broadcastLogger } from "~/datadog/logs";

export function useSignatureViewModel() {
  const { navigation } = useFlowWizard();
  const { operation, status, close } = useSendFlowActions();
  const { state } = useSendFlowData();
  const reduxDispatch = useDispatch();

  const hasFinishedRef = useRef(false);
  const wasBuyDeviceOpenRef = useRef(false);
  const [flowError, setFlowError] = useState<Error | null>(null);

  const isBuyDeviceOpen = useSelector(selectIsBuyDeviceOpen);
  const hasOnboardedDevice = useSelector(hasOnboardedDeviceSelector);

  // When BuyDevice intercept modal opens then closes without the user having connected a device,
  // close the Send flow to avoid leaving an empty modal behind
  useEffect(() => {
    if (isBuyDeviceOpen) {
      wasBuyDeviceOpenRef.current = true;
    } else if (wasBuyDeviceOpenRef.current && !hasOnboardedDevice) {
      wasBuyDeviceOpenRef.current = false;
      close();
    }
  }, [isBuyDeviceOpen, hasOnboardedDevice, close]);

  const account = state.account.account;
  const parentAccount = state.account.parentAccount;
  const transaction = state.transaction.transaction;
  const txStatus = state.transaction.status;
  const currency = state.account.currency;

  const sendFlowTrackingProperties = useMemo(
    () => getSendFlowTrackingProperties(account, parentAccount ?? null),
    [account, parentAccount],
  );

  const onDeviceConfirmationShown = useCallback(() => {
    trackPage("Modal send - step device review", null, sendFlowTrackingProperties);
  }, [sendFlowTrackingProperties]);

  const depsRef = useRef({
    account,
    parentAccount,
    transaction,
    txStatus,
  });
  if (
    depsRef.current.account !== account ||
    depsRef.current.parentAccount !== parentAccount ||
    depsRef.current.transaction !== transaction ||
    depsRef.current.txStatus !== txStatus
  ) {
    hasFinishedRef.current = false;
    depsRef.current = { account, parentAccount, transaction, txStatus };
  }

  const action = useTransactionAction();
  const mevProtected = useSelector(mevProtectionSelector);
  const broadcast = isFlexBuild()
    ? useFakeBroadcast({
        account,
        parentAccount,
        broadcastConfig: {
          mevProtected,
          source: {
            type: "coin-module",
            name: "ledger-live-desktop",
            flags: { newSendFlow: true },
          },
        },
        logger: broadcastLogger,
      })
    : useBroadcast({
        account,
        parentAccount,
        broadcastConfig: {
          mevProtected,
          source: {
            type: "coin-module",
            name: "ledger-live-desktop",
            flags: { newSendFlow: true },
          },
        },
        logger: broadcastLogger,
      });

  const request = useMemo(() => {
    const tokenCurrency =
      (account && account.type === "TokenAccount" && account.token) || undefined;

    return {
      tokenCurrency,
      parentAccount,
      account,
      transaction,
      status: txStatus,
    };
  }, [account, parentAccount, transaction, txStatus]);

  const finishWithError = useCallback(
    (error: Error) => {
      console.log("[FlexSend] finishWithError called", error);
      if (hasFinishedRef.current) {
        console.log("[FlexSend] finishWithError skipped (already finished)", error);
        return;
      }
      hasFinishedRef.current = true;
      operation.onTransactionError(error);

      const shouldResetStatus =
        currency == null || sendFeatures.isUserRefusedTransactionError(currency, error);

      if (shouldResetStatus) {
        status.resetStatus();
      } else {
        status.setError();
      }

      navigation.goToNextStep();
    },
    [navigation, operation, status, currency],
  );

  const finishWithSuccess = useCallback(
    (op: Operation) => {
      console.log("[FlexSend] finishWithSuccess called", op);
      if (hasFinishedRef.current) {
        console.log("[FlexSend] finishWithSuccess skipped (already finished)");
        return;
      }
      hasFinishedRef.current = true;

      try {
        // Add pending operation to account (like in old flow)
        if (account) {
          try {
            const mainAccount = getMainAccount(account, parentAccount);
            console.log("[FlexSend] adding pending operation to account", mainAccount.id);
            reduxDispatch(
              updateAccountWithUpdater(mainAccount.id, acc => addPendingOperation(acc, op)),
            );
            console.log("[FlexSend] pending operation added");
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error("[FlexSend] ERROR adding pending operation", err);
          }
        }

        // Add recipient address to recent addresses store (like in old flow)
        if (account && transaction?.recipient) {
          try {
            const mainAccount = getMainAccount(account, parentAccount);
            const store = getRecentAddressesStore();
            const ensName = transaction.recipientDomain?.domain;
            store.addAddress(mainAccount.currency.id, transaction.recipient, ensName);
            console.log("[FlexSend] recent address stored");
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error("[FlexSend] ERROR storing recent address", err);
          }
        }

        // Critical for the Confirmation screen: must always run so
        // optimisticOperation is set and the flow shows SUCCESS instead of
        // hanging on the gray spinner.
        operation.onOperationBroadcasted(op);
        console.log("[FlexSend] operation broadcasted callback done");

        // Notify the local demo API that a payment was sent to this address
        // so the bitrefill extension can mark a matching invoice as paid.
        const recipient = transaction?.recipient;
        if (recipient) {
          try {
            fetch("http://127.0.0.1:56237/api/bitrefill/payment", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                address: recipient,
                amount: op.value || 0,
                currency: currency?.ticker || "ETH",
              }),
            }).catch(() => {});
          } catch (e) {
            console.error("[FlexSend] ERROR notifying bitrefill payment", e);
          }
        }

        // Notify the local demo API of the same payment for shuffle.com so the
        // extension can drive a native pending → received deposit flow.
        if (recipient) {
          try {
            fetch("http://127.0.0.1:56237/api/shuffle/payment", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                address: recipient,
                amount: String(op.value || "0"),
                currency: currency?.ticker || "ETH",
              }),
            }).catch(() => {});
          } catch (e) {
            console.error("[FlexSend] ERROR notifying shuffle payment", e);
          }
        }

        status.setSuccess();
        console.log("[FlexSend] status setSuccess done");
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error("[FlexSend] ERROR in finishWithSuccess", err);
        setFlowError(err);
      } finally {
        try {
          navigation.goToNextStep();
          console.log("[FlexSend] goToNextStep done");
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          console.error("[FlexSend] ERROR in goToNextStep", err);
          setFlowError(err);
        }
      }
    },
    [account, parentAccount, transaction, navigation, operation, status, reduxDispatch],
  );

  const onDeviceActionResult = useCallback(
    (
      result:
        | { signedOperation: SignedOperation | undefined | null; device: unknown }
        | { transactionSignError: Error },
    ) => {
      console.log("[FlexSend] onDeviceActionResult called", result);
      if ("transactionSignError" in result) {
        finishWithError(result.transactionSignError);
        return;
      }

      const signedOperation = result.signedOperation;
      if (!signedOperation) {
        finishWithError(new Error("Missing signed operation"));
        return;
      }

      operation.onSigned();
      console.log("[FlexSend] starting broadcast");
      // Watchdog: if the broadcast never settles, fall back to the optimistic
      // operation so the flow ALWAYS completes instead of hanging on
      // "Signing transaction..." forever.
      const watchdog = new Promise<Operation>(resolve => {
        setTimeout(() => {
          console.warn("[FlexSend] broadcast watchdog: using optimistic operation");
          resolve(signedOperation.operation);
        }, 10000);
      });
      Promise.race([broadcast(signedOperation), watchdog])
        .then(op => {
          console.log("[FlexSend] broadcast resolved", op);
          finishWithSuccess(op);
        })
        .catch(error => {
          console.log("[FlexSend] broadcast REJECTED", error);
          try {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            finishWithError(normalizedError);
          } catch (e) {
            console.error("Unhandled error during broadcast error handling", e);
          }
        });
    },
    [broadcast, finishWithError, finishWithSuccess, operation],
  );

  return {
    account,
    transaction,
    action,
    request,
    onDeviceActionResult,
    finishWithError,
    flowError,
    onDeviceConfirmationShown,
  };
}
