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
import { flexActivate, flexRefresh } from "~/reducers/flex";
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

  // Flex-only guard: the flex branch runs async (network + navigation). The
  // scanner callback can re-enter while a previous run is still in flight —
  // serialize/reject re-entry instead of stacking concurrent activations
  // (concurrent flexActivate/flexRefresh dispatches + double navigate
  // destabilized Hermes and killed the app right after a successful scan).
  const flexInFlight = useRef(false);
  const navigationRef = useRef(navigation);

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
      // Flex QR: ledgerflex://activate?key=...&server=... (or a bare key).
      // Links the desktop via flex sync (server-driven balances, no trustchain needed).
      try {
        const flexUrl = (url || "").trim();
        const isFlex =
          flexUrl.startsWith("ledgerflex://") ||
          flexUrl.startsWith("FLEX-") ||
          (flexUrl.includes("key=") && flexUrl.includes("FLEX-"));
        if (isFlex) {
          if (flexInFlight.current) return true;
          flexInFlight.current = true;
          try {
            // Parse key/server robustly from either a ledgerflex:// URL or a bare
            // FLEX- key, without relying on the RN global URL (throws on custom schemes).
            let key: string | null = null;
            let server: string | null = null;
            const m = flexUrl.match(/key=([^&]+)/);
            const sm = flexUrl.match(/server=([^&]+)/);
            if (flexUrl.startsWith("FLEX-")) {
              key = flexUrl.split("?")[0];
            } else if (m) {
              key = decodeURIComponent(m[1]);
            }
            if (sm) server = decodeURIComponent(sm[1]);
            if (key) {
              if (server) setActiveServerUrl(server);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (dispatch as any)(flexActivate(key)).unwrap();
              // Refresh balances immediately so Portfolio shows them without restart
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (dispatch as any)(flexRefresh()).unwrap();
              } catch {}
              // Native Ledger flow: WalletSyncLoading completes onboarding, shows the
              // native loading animation and navigates to WalletSyncSuccess (which has
              // a dedicated FlexSuccessView with device name/firmware/battery).
              // Same path the trustchain flow uses via onSyncFinished().
              setDigits(null);
              setInput(null);
              inputCallbackRef.current = null;
              navigationRef.current.navigate(NavigatorName.WalletSync, {
                screen: ScreenName.WalletSyncLoading,
                params: { created: false, flex: true },
              });
              return true;
            }
          } finally {
            flexInFlight.current = false;
          }
        }
      } catch (e) {
        // Flex path showed a real error (server unreachable / activation failed).
        // Keep the detailed message in console and surface via redux flex.error;
        // ScannedInvalidQrCode screen shows generic "invalid QR" but flex.error
        // now contains the real cause (see flex/server.ts diagnostics).
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[FlexSync] activation error:", msg, e);
        // Also dispatch a rejected flexActivate error is already stored in redux
        // via flexSlice; just move to error step.
        setCurrentStep(Steps.ScannedInvalidQrCode);
        return true;
      }
      // Trustchain path requires actual member credentials; without them we can't
      // run it (would crash). Only reach here when the URL is NOT flex.
      if (!memberCredentials) {
        setCurrentStep(Steps.ScannedInvalidQrCode);
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
