import React from "react";
import { DialogBody } from "@ledgerhq/lumen-ui-react";
import type { SignedOperation } from "@ledgerhq/types-live";
import type { Device } from "@ledgerhq/live-common/hw/actions/types";
import DeviceAction from "~/renderer/components/DeviceAction";
import { SimplifiedTransactionConfirm } from "./components/SimplifiedTransactionConfirm";
import { useSignatureViewModel } from "./hooks/useSignatureViewModel";
import { LockedDevicePrompt } from "./components/LockedDevicePrompt";
import { PendingState } from "./components/PendingState";

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
  if (!("signedOperation" in props)) {
    return null;
  }
  // Show pending state after signature during broadcast
  return <PendingState messageKey="send.steps.confirmation.pending.title" />;
};

export const SignatureScreen = () => {
  const {
    account,
    transaction,
    action,
    request,
    onDeviceActionResult,
    finishWithError,
    flowError,
  } = useSignatureViewModel();

  if (!account || !transaction) {
    return null;
  }

  return (
    <DialogBody className="py-16">
      <div className="-mt-12 mb-24" data-testid="send-signature-step">
        {flowError ? (
          <div
            className="mb-4 rounded border border-red-600 bg-red-50 p-3 text-sm text-red-700"
            data-testid="flex-send-error"
          >
            [FlexSend] {flowError.message}
          </div>
        ) : null}
        <DeviceAction
          action={action}
          // @ts-expect-error This type is not compatible with the one expected by the action
          request={request}
          Result={Result}
          onResult={onDeviceActionResult}
          onError={finishWithError}
          analyticsPropertyFlow="send"
          renderLockedDevice={({ device, onRetry }) => {
            if (!device) return null;
            return <LockedDevicePrompt deviceModelId={device.modelId} onRetry={onRetry} />;
          }}
          renderDeviceSignatureRequested={({ device }) => (
            <SimplifiedTransactionConfirm device={device} />
          )}
        />
      </div>
    </DialogBody>
  );
};
