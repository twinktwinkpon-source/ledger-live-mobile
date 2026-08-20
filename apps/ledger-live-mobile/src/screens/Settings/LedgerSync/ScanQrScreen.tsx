import React, { useCallback, useState } from "react";
import { Alert as RNAlert } from "react-native";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "~/context/hooks";
import { Flex, Text, Alert } from "@ledgerhq/native-ui";
import ScanQrCode from "~/components/Scanner";
import { ScreenName } from "~/const";
import { flexActivate, flexSelector } from "~/reducers/flex";
import { setActiveServerUrl } from "~/flex/server";

/**
 * Parses the scanned flex QR payload into {key, server}.
 * Expected format: ledgerflex://activate?key=FLEX-...&server=http://...
 * Also handles bare FLEX- keys and URLs containing key=.
 */
function extractFlexData(data: string): { key: string | null; server: string | null } {
  try {
    const trimmed = (data || "").trim();
    if (trimmed.startsWith("ledgerflex://")) {
      const q = trimmed.indexOf("?");
      const query = q >= 0 ? trimmed.slice(q + 1) : "";
      let key: string | null = null;
      let server: string | null = null;
      for (const pair of query.split("&")) {
        if (pair.startsWith("key=")) key = decodeURIComponent(pair.slice(4)) || null;
        else if (pair.startsWith("server=")) server = decodeURIComponent(pair.slice(4)) || null;
      }
      return { key, server };
    }
    if (trimmed.startsWith("FLEX-")) {
      return { key: trimmed.split("?")[0], server: null };
    }
    const m = trimmed.match(/key=([^&]+)/);
    if (m) {
      const sm = trimmed.match(/server=([^&]+)/);
      return {
        key: decodeURIComponent(m[1]),
        server: sm ? decodeURIComponent(sm[1]) : null,
      };
    }
    return { key: null, server: null };
  } catch {
    return { key: null, server: null };
  }
}

export default function LedgerSyncScan() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const flex = useSelector(flexSelector);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [success, setSuccess] = useState(false);

  const onResult = useCallback(
    async (data: string) => {
      if (activating) return;
      const { key, server } = extractFlexData(data);
      if (!key) {
        setScanError("Неверный QR-код. Откройте на десктопе Настройки → Ledger Sync → Показать QR.");
        return;
      }
      if (server) setActiveServerUrl(server);
      setActivating(true);
      setScanError(null);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (dispatch as any)(flexActivate(key)).unwrap();
        setSuccess(true);
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
        // Native alert — user explicitly asked for native confirmation that it bound
        RNAlert.alert("✓ Привязано", "Ledger синхронизирован. Балансы подтянутся в течение 10с.", [
          { text: "OK", onPress: () => navigation.navigate(ScreenName.LedgerSync) },
        ]);
        setTimeout(() => {
          // Fallback if alert dismissed: also navigate
          try {
            navigation.navigate(ScreenName.LedgerSync);
          } catch {}
        }, 2500);
      } catch (e: unknown) {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch {}
        const msg = e instanceof Error ? e.message : String(e);
        setScanError(`[flex error] ${msg}`);
        RNAlert.alert("Ошибка", msg);
      } finally {
        setActivating(false);
      }
    },
    [dispatch, navigation, activating],
  );

  if (success) {
    const deviceName = flex.profile?.device?.name || "Ledger Nano X";
    const model = flex.profile?.device?.modelId || "nanoX";
    return (
      <Flex flex={1} justifyContent="center" alignItems="center" p={6}>
        <Text variant="h2" mb={4}>
          ✓ Успешно
        </Text>
        <Text variant="bodyLineHeight" color="neutral.c80" mb={2} textAlign="center">
          {deviceName} ({model}) подключён
        </Text>
        <Text variant="bodyLineHeight" color="neutral.c80" mb={6} textAlign="center">
          Балансы синхронизированы. Переходим...
        </Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} justifyContent="center" alignItems="center" p={6}>
      <Text variant="h2" mb={4}>
        Scan QR
      </Text>
      <Text variant="bodyLineHeight" color="neutral.c80" mb={6}>
        Scan the QR code shown in the desktop admin panel to link this phone to
        your Ledger Sync key.
      </Text>
      {activating && (
        <Text variant="bodyLineHeight" color="neutral.c80" mb={4}>
          Активация...
        </Text>
      )}
      {(scanError || flex.error) && (
        <Alert type="error" title={scanError || flex.error || "Ошибка"} mb={4} />
      )}
      <ScanQrCode onResult={onResult} />
    </Flex>
  );
}
