import { useCallback, useState, useRef } from "react";
import { MemberCredentials, TrustchainMember } from "@ledgerhq/ledger-key-ring-protocol/types";
import { createQRCodeCandidateInstance } from "@ledgerhq/ledger-key-ring-protocol/qrcode/index";
import {
  ScannedOldImportQrCode,
  ScannedInvalidQrCode,
  InvalidDigitsError,
  NoTrustchainInitialized,
  TrustchainAlreadyInitialized,
  TrustchainAlreadyInitializedWithOtherSeed,
} from "@ledgerhq/ledger-key-ring-protocol/errors";
import { setTrustchain, trustchainSelector } from "@ledgerhq/ledger-key-ring-protocol/store";
import { useSelector, useDispatch } from "~/context/hooks";
import { useNavigation } from "@react-navigation/native";
import { AnalyticsEvents } from "LLM/features/WalletSync/Analytics/enums";
import { track } from "~/analytics";
import { Steps } from "../types/Activation";
import { NavigatorName, ScreenName } from "~/const";
import { useInstanceName } from "./useInstanceName";
import { useTrustchainSdk } from "./useTrustchainSdk";
import { useCurrentStep } from "./useCurrentStep";
import { flexActivate } from "~/reducers/flex";
import { setActiveServerUrl } from "~/flex/server";
import { useQueuedDrawerContext } from "LLM/components/QueuedDrawer/QueuedDrawersContext";

export const useSyncWithQrCode = () => {
  const { setCurrentStep } = useCurrentStep();
  const [nbDigits, setDigits] = useState<number | null>(null);
  const [input, setInput] = useState<string | null>(null);
  const instanceName = useInstanceName();
  const trustchain = useSelector(trustchainSelector);
  const sdk = useTrustchainSdk();

  const navigation = useNavigation();
  const { closeAllDrawers } = useQueuedDrawerContext();

  const inputCallbackRef = useRef<((input: string) => void) | null>(null);
  const dispatch = useDispatch();

  const onRequestQRCodeInput = useCallback(
    (config: { digits: number }, callback: (input: string) => void) => {
      setDigits(config.digits);
      inputCallbackRef.current = callback;
    },
    [],
  );

  const onSyncFinished = useCallback(() => {
    setDigits(null);
    setInput(null);
    inputCallbackRef.current = null;
    navigation.navigate(NavigatorName.WalletSync, {
      screen: ScreenName.WalletSyncLoading,
      params: {
        created: false,
      },
    });
  }, [navigation]);

  const handleStart = useCallback(
    async (url: string, memberCredentials: MemberCredentials) => {
      // Flex QR: ledgerflex://activate?key=...&server=...
      // Links the desktop via flex sync (server-driven balances, no trustchain needed).
      try {
        if (url && url.startsWith("ledgerflex://")) {
          // Parse the flex payload without relying on the RN `URL` global (it can
          // throw on custom schemes like ledgerflex:// on some Hermes builds).
          const q = url.indexOf("?");
          const query = q >= 0 ? url.slice(q + 1) : "";
          const params = new Map<string, string>();
          for (const pair of query.split("&")) {
            if (!pair) continue;
            const eq = pair.indexOf("=");
            const name = eq >= 0 ? decodeURIComponent(pair.slice(0, eq)) : decodeURIComponent(pair);
            const val = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : "";
            params.set(name, val);
          }
          const key = params.get("key") || null;
          const server = params.get("server") || null;
          if (key) {
            if (server) setActiveServerUrl(server);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (dispatch as any)(flexActivate(key)).unwrap();
            closeAllDrawers();
            navigation.navigate(NavigatorName.WalletSync, {
              screen: ScreenName.WalletSyncLoading,
              params: { created: false, flex: true },
            });
            return true;
          }
        }
      } catch {
        setCurrentStep(Steps.SyncError);
        return true;
      }
      try {
        const newTrustchain = await createQRCodeCandidateInstance({
          memberCredentials,
          scannedUrl: url,
          memberName: instanceName,
          onRequestQRCodeInput,
          addMember: async (member: TrustchainMember) => {
            if (trustchain) {
              await sdk.addMember(trustchain, memberCredentials, member);
              return trustchain;
            }
            throw new NoTrustchainInitialized();
          },
          initialTrustchainId: trustchain?.rootId,
        });
        if (newTrustchain) {
          dispatch(setTrustchain(newTrustchain));
          if (!trustchain) track(AnalyticsEvents.LedgerSyncActivated);
        }
        onSyncFinished();
        return true;
      } catch (e) {
        if (e instanceof ScannedOldImportQrCode) {
          setCurrentStep(Steps.ScannedOldImportQrCode);
          return;
        } else if (e instanceof ScannedInvalidQrCode) {
          setCurrentStep(Steps.ScannedInvalidQrCode);
          return;
        } else if (e instanceof InvalidDigitsError) {
          setCurrentStep(Steps.SyncError);
          return;
        } else if (e instanceof NoTrustchainInitialized) {
          setCurrentStep(Steps.UnbackedError);
          return;
        } else if (e instanceof TrustchainAlreadyInitialized) {
          if (e.message === trustchain?.rootId) {
            setCurrentStep(Steps.AlreadyBacked);
          } else {
            setCurrentStep(Steps.BackedWithDifferentSeeds);
          }
          return;
        } else if (e instanceof TrustchainAlreadyInitializedWithOtherSeed) {
          setCurrentStep(Steps.BackedWithDifferentSeeds);
          return;
        }
        throw e;
      }
    },
    [instanceName, onRequestQRCodeInput, trustchain, onSyncFinished, sdk, dispatch, setCurrentStep],
  );

  const handleSendDigits = useCallback(
    (input: string) => (inputCallbackRef.current?.(input), true),
    [],
  );

  return { nbDigits, input, handleStart, handleSendDigits, setInput };
};
