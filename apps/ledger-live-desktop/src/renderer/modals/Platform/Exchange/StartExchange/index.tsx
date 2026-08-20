import React, { useEffect } from "react";
import Modal, { ModalBody } from "~/renderer/components/Modal";
import Box from "~/renderer/components/Box";
import DeviceAction from "~/renderer/components/DeviceAction";
import { ExchangeType } from "@ledgerhq/live-common/wallet-api/react";
import {
  StartExchangeErrorResult,
  StartExchangeSuccessResult,
} from "@ledgerhq/live-common/hw/actions/startExchange";
import { useStartExchangeAction } from "~/renderer/hooks/useConnectAppAction";
import { isFlexBuild, getFakeDevice } from "~/renderer/mocks/fakeFlexBuild";

export type Data = {
  onCancel?: (error: StartExchangeErrorResult) => void;
  exchangeType: ExchangeType;
  onResult: (startExchangeResult: StartExchangeSuccessResult) => void;
};

/** Fake start exchange result for flex builds — no physical device needed. */
function fakeStartExchangeResult(): StartExchangeSuccessResult {
  return {
    nonce: "0x" + "a".repeat(64),
    exchangeApp: { name: "Exchange", version: "2.0.0" },
    device: getFakeDevice(),
  };
}

const StartExchange = () => {
  const action = useStartExchangeAction();

  return (
    <Modal
      name="MODAL_PLATFORM_EXCHANGE_START"
      centered
      preventBackdropClick
      render={({ data, onClose }: { data: Data; onClose?: () => void | undefined }) => (
        <ModalBody
          onClose={() => {
            if (data.onCancel) {
              data.onCancel({
                error: new Error("Interrupted by user"),
              });
            }
            onClose?.();
          }}
          render={() => {
            if (isFlexBuild()) {
              return <FakeStartExchange data={data} onClose={onClose} />;
            }
            return (
              <Box alignItems={"center"} px={32}>
                <DeviceAction
                  action={action}
                  request={{
                    exchangeType: data.exchangeType,
                  }}
                  onResult={result => {
                    if ("startExchangeResult" in result) {
                      data.onResult(result.startExchangeResult);
                    }
                    if ("startExchangeError" in result) {
                      data.onCancel?.(result.startExchangeError);
                    }
                    onClose?.();
                  }}
                />
              </Box>
            );
          }}
        />
      )}
    />
  );
};

function FakeStartExchange({
  data,
  onClose,
}: {
  data: Data;
  onClose?: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      data.onResult(fakeStartExchangeResult());
      onClose?.();
    }, 1500);
    return () => clearTimeout(timer);
  }, [data, onClose]);

  return (
    <Box alignItems="center" px={32} py={6}>
      <Box alignItems="center" justifyContent="center" mb={4}>
        <Box
          as="div"
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.1)",
            borderTopColor: "#4a90d9",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </Box>
      <Box style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
        Simulating device connection...
      </Box>
    </Box>
  );
}

export default StartExchange;
