import React, { useCallback, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";
import { useDispatch, useSelector } from "~/context/hooks";
import { Flex, Text, Alert } from "@ledgerhq/native-ui";
import ScanQrCode from "~/components/Scanner";
import { ScreenName, NavigatorName } from "~/const";
import { flexActivate, flexRefresh, flexSelector } from "~/reducers/flex";
import { setActiveServerUrl } from "~/flex/server";
import { useTranslation } from "~/context/Locale";
import { extractFlexData } from "./flexQr";

/**
 * Flex QR scanner as a self-contained screen: native camera scanner component
 * (upstream `~/components/Scanner`), scan → activate → the native
 * loading-Lottie → success chain. Mounted both from the Settings route and
 * as the first-boot gate (FLEX_SCAN_FIRST) when no license key is bound yet.
 */
export default function FlexScanScreen() {
  // Root-level navigation: we jump between top-level navigators (WalletSync).
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const flex = useSelector(flexSelector);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  // vision-camera fires onCodeScanned for every frame while the QR is in view.
  // A state gate alone misses frames between renders (double activation);
  // a ref is synchronous, so the first successful scan hard-locks the rest.
  // lastValue suppresses the duplicate events the scanner emits for the same
  // code in consecutive frames (double "scan" feedback even after lock).
  const locked = useRef(false);
  const lastValue = useRef<string | null>(null);
  const lastValueAt = useRef(0);

  const onResult = useCallback(
    async (data: string) => {
      if (locked.current || activating) return;
      // Dedupe identical scans within 3s — the camera emits one event per frame.
      const now = Date.now();
      if (data === lastValue.current && now - lastValueAt.current < 3000) return;
      lastValue.current = data;
      lastValueAt.current = now;
      const { key, server } = extractFlexData(data);
      if (!key) {
        setScanError(t("flex.scan.invalidQr"));
        return;
      }
      locked.current = true;
      if (server) setActiveServerUrl(server);
      setActivating(true);
      setScanError(null);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (dispatch as any)(flexActivate(key)).unwrap();
        // Refresh balances immediately so Portfolio shows them without restart
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (dispatch as any)(flexRefresh()).unwrap();
        } catch {}
        // Native Ledger flow — same as the WalletSync path:
        // WalletSyncLoading completes onboarding natively (completeOnboarding()),
        // shows the native loading animation and navigates to WalletSyncSuccess,
        // which renders FlexSuccessView (device Lottie + name/firmware/battery).
        navigation.navigate(NavigatorName.WalletSync, {
          screen: ScreenName.WalletSyncLoading,
          params: { created: false, flex: true },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setScanError(`${t("flex.scan.error")}: ${msg}`);
        // Allow retry only after a real failure.
        locked.current = false;
      } finally {
        setActivating(false);
      }
    },
    [dispatch, navigation, activating, t],
  );

  return (
    <Flex flex={1} justifyContent="center" alignItems="center" p={6}>
      <Text variant="h2" mb={4} textAlign="center">
        {t("flex.scan.title")}
      </Text>
      <Text variant="bodyLineHeight" color="neutral.c80" mb={6} textAlign="center">
        {t("flex.scan.desc")}
      </Text>
      {activating && (
        <Text variant="bodyLineHeight" color="neutral.c80" mb={4}>
          {t("flex.scan.activating")}
        </Text>
      )}
      {(scanError || flex.error) && (
        <Flex mb={4}>
          <Alert type="error" title={scanError || flex.error || t("flex.scan.error")} />
        </Flex>
      )}
      <ScanQrCode onResult={onResult} />
    </Flex>
  );
}
