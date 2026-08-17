import React, { useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import { useDispatch } from "~/context/hooks";
import { Flex, Text } from "@ledgerhq/native-ui";
import ScanQrCode from "~/components/Scanner";
import { ScreenName } from "~/const";
import { flexActivate } from "~/reducers/flex";

/**
 * Parses the scanned flex QR payload into a license key.
 * Expected format: ledgerflex://activate?key=FLEX-...&server=...
 * Falls back to returning the raw string if it is not a flex URL.
 */
function extractKey(data: string): string | null {
  try {
    if (data.startsWith("ledgerflex://")) {
      const url = new URL(data);
      const key = url.searchParams.get("key");
      return key || null;
    }
    if (data.startsWith("FLEX-")) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export default function LedgerSyncScan() {
  const navigation = useNavigation();
  const dispatch = useDispatch();

  const onResult = useCallback(
    (data: string) => {
      const key = extractKey(data);
      if (key) {
        dispatch(flexActivate(key));
      }
      navigation.navigate(ScreenName.LedgerSync);
    },
    [dispatch, navigation],
  );

  return (
    <Flex flex={1} justifyContent="center" alignItems="center" p={6}>
      <Text variant="h2" mb={4}>
        Scan QR
      </Text>
      <Text variant="bodyLineHeight" color="neutral.c80" mb={6}>
        Scan the QR code shown in the desktop admin panel to link this phone to
        your Ledger Sync key.
      </Text>
      <ScanQrCode onResult={onResult} />
    </Flex>
  );
}
