import React, { useCallback } from "react";
import { useSelector, useDispatch } from "~/context/hooks";
import { Box, Flex, Text } from "@ledgerhq/native-ui";
import Button from "~/components/Button";
import SettingsNavigationScrollView from "../SettingsNavigationScrollView";
import { TrackScreen } from "~/analytics";
import { useNavigation } from "@react-navigation/native";
import { ScreenName } from "~/const";
import { flexSelector, flexRefresh } from "~/reducers/flex";
import { DeviceModelId } from "@ledgerhq/types-devices";
import { getDeviceAnimation } from "~/helpers/getDeviceAnimation";
import Animation from "~/components/Animation";
import { getProductName } from "LLM/utils/getProductName";
import styled, { useTheme } from "styled-components/native";

function getDeviceModelId(modelId: string): DeviceModelId {
  if (
    typeof modelId === "string" &&
    (Object.values(DeviceModelId) as string[]).includes(modelId)
  ) {
    return modelId as DeviceModelId;
  }
  return DeviceModelId.stax;
}

const DeviceRow = styled(Flex).attrs({
  flexDirection: "row",
  justifyContent: "space-between",
  width: "100%",
})``;
const DeviceLabel = styled(Text).attrs({
  variant: "bodyLineHeight",
  fontWeight: "medium",
  color: "neutral.c70",
})``;
const DeviceValue = styled(Text).attrs({
  variant: "bodyLineHeight",
  fontWeight: "semiBold",
  color: "neutral.c100",
})``;

export default function LedgerSync() {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const flexProfile = useSelector(flexSelector);
  const profile = flexProfile.profile;
  // Auto re-fetch if key exists but balances are still empty (e.g. first refresh failed)
  React.useEffect(() => {
    if (flexProfile.key && Object.keys(flexProfile.balances || {}).length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dispatch as any)(flexRefresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenSync = useCallback(() => {
    // Flex path: go straight to the flex QR scanner (no trustchain / PIN).
    navigation.navigate(ScreenName.LedgerSyncScan as never);
  }, [navigation]);

  const deviceModelId = profile?.device?.modelId
    ? getDeviceModelId(profile.device.modelId)
    : null;
  const rawBattery = profile?.device?.batteryLevel;
  const batteryPercent =
    typeof rawBattery === "number" && Number.isFinite(rawBattery)
      ? Math.min(100, Math.max(0, Math.round(rawBattery > 1 ? rawBattery : rawBattery * 100)))
      : 0;

  return (
    <SettingsNavigationScrollView>
      <TrackScreen category="Settings" name="LedgerSync" />
      <Flex px={6} pb={6}>
        <Text variant="h2" mb={2}>
          Ledger Sync
        </Text>
        <Text variant="bodyLineHeight" color="neutral.c80" mb={4}>
          Synchronize your accounts across your devices using Ledger Sync.
        </Text>
        <Box borderRadius={8} p={4} mb={4}>
          <Text variant="large" pb={2}>
            Status
          </Text>
          <Text
            variant="bodyLineHeight"
            color={flexProfile.key ? "success.c80" : "neutral.c80"}
          >
            {flexProfile.key ? "Ledger Sync is active" : "No sync configured"}
          </Text>
        </Box>

        {profile?.device && deviceModelId ? (
          <Box borderRadius={8} p={4} mb={4}>
            <Flex alignItems="center" mb={4}>
              <Animation
                source={getDeviceAnimation({ modelId: deviceModelId, key: "openApp", theme })}
                style={{ height: 150, width: "60%" }}
              />
            </Flex>
            <DeviceRow>
              <DeviceLabel>Device</DeviceLabel>
              <DeviceValue>
                {profile.device.name || getProductName(deviceModelId)}
              </DeviceValue>
            </DeviceRow>
            <DeviceRow>
              <DeviceLabel>Firmware</DeviceLabel>
              <DeviceValue>{profile.device.firmwareVersion}</DeviceValue>
            </DeviceRow>
            <DeviceRow>
              <DeviceLabel>Battery</DeviceLabel>
              <DeviceValue>{batteryPercent}%</DeviceValue>
            </DeviceRow>
          </Box>
        ) : null}

        <Button type="main" onPress={handleOpenSync}>
          {flexProfile.key ? "Scan a different key" : "Set up Ledger Sync"}
        </Button>
      </Flex>
    </SettingsNavigationScrollView>
  );
}
