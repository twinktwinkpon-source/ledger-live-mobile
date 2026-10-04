import React, { useCallback, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";
import { useDispatch, useSelector } from "~/context/hooks";
import { Alert, Box, Flex, Text } from "@ledgerhq/native-ui";
import { ScrollView } from "react-native";
import { useTranslation } from "~/context/Locale";
import { ScreenName, NavigatorName } from "~/const";
import SafeAreaView from "~/components/SafeAreaView";
import PreventNativeBack from "~/components/PreventNativeBack";
import { TrackScreen } from "~/analytics";
import {
  AnalyticsPage,
} from "LLM/features/WalletSync/hooks/useLedgerSyncAnalytics";
import IconsHeader from "LLM/features/WalletSync/components/Activation/IconsHeader";
import ScanQrCode from "LLM/features/WalletSync/components/Synchronize/ScanQrCode";
import { flexActivate, flexRefresh, flexSelector } from "~/reducers/flex";
import { setActiveServerUrl } from "~/flex/server";
import { extractFlexData } from "./flexQr";

/**
 * FLEX first-boot scanner (scan-first boot gate in BaseNavigator, and the
 * Settings → Ledger Sync route). Built entirely from the upstream WalletSync
 * components — the same icons header and rounded camera / scan-target /
 * steps that the native Ledger Sync flow uses; flex only feeds the data.
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
        // Native Ledger flow — identical chain to upstream sync:
        // WalletSyncLoading completes onboarding (completeOnboarding()),
        // plays the native loading animation, then WalletSyncSuccess renders
        // the device animation + profile card, and its Close replaces the
        // stack with Main (the wallet).
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
    <SafeAreaView edges={["bottom"]} isFlex>
      <PreventNativeBack />
      <TrackScreen category={AnalyticsPage.ScanQRCode} />
      {/* IconsHeader + camera (minHeight 400) + the 4-step card overflow the
          viewport on smaller phones; centering a static Flex pushes the top
          icons under the header and the steps card off-screen. Scroll like
          the upstream sync flow does (TwoStepSyncOnboardingCompanion). */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingVertical: 16,
        }}
      >
        <Flex alignItems="center" rowGap={24} width="100%" px={6}>
          <IconsHeader />
          <Box width="100%" alignItems="center">
            <Text variant="h4" textAlign="center" fontWeight="semiBold">
              {t("flex.scan.title")}
            </Text>
            <Text
              variant="bodyLineHeight"
              color="neutral.c70"
              textAlign="center"
              mt={2}
              maxWidth={330}
            >
              {t("flex.scan.desc")}
            </Text>
          </Box>
          {(scanError || flex.error) && (
            <Box width="100%">
              <Alert type="error" title={scanError || flex.error || t("flex.scan.error")} />
            </Box>
          )}
          {activating && (
            <Text variant="bodyLineHeight" color="neutral.c80">
              {t("flex.scan.activating")}
            </Text>
          )}
          <ScanQrCode onQrCodeScanned={onResult} />
        </Flex>
      </ScrollView>
    </SafeAreaView>
  );
}
