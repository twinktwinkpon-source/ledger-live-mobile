import React, { useCallback } from "react";
import { useDispatch, useSelector } from "~/context/hooks";
import { Box, Flex, Text } from "@ledgerhq/native-ui";
import Button from "~/components/Button";
import SettingsNavigationScrollView from "../SettingsNavigationScrollView";
import { TrackScreen } from "~/analytics";
import { trustchainSelector } from "@ledgerhq/ledger-key-ring-protocol/store";
import ActivationDrawer from "LLM/features/WalletSync/screens/Activation/ActivationDrawer";
import { Steps } from "LLM/features/WalletSync/types/Activation";
import { activateDrawerSelector } from "~/reducers/walletSync";
import { setLedgerSyncActivateDrawer } from "~/actions/walletSync";
import { useCurrentStep } from "LLM/features/WalletSync/hooks/useCurrentStep";
import { flexSelector } from "~/reducers/flex";
import { DeviceModelId } from "@ledgerhq/types-devices";
import { getDeviceAnimation } from "~/helpers/getDeviceAnimation";
import Animation from "~/components/Animation";
import { getProductName } from "LLM/utils/getProductName";
import styled, { useTheme } from "styled-components/native";

function getDeviceModelId(modelId: string): DeviceModelId {
  if (modelId in DeviceModelId) return modelId as DeviceModelId;
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
  const trustchain = useSelector(trustchainSelector);
  const isDrawerVisible = useSelector(activateDrawerSelector);
  const { setCurrentStep } = useCurrentStep();
  const { theme } = useTheme();
  const flexProfile = useSelector(flexSelector);
  const profile = flexProfile.profile;

  const closeDrawer = useCallback(() => {
    dispatch(setLedgerSyncActivateDrawer(false));
    setCurrentStep(Steps.Activation);
  }, [dispatch, setCurrentStep]);

  const hasBackup = !!trustchain?.rootId;

  const handleOpenSync = useCallback(() => {
    dispatch(setLedgerSyncActivateDrawer(true));
  }, [dispatch]);

  const deviceModelId = profile?.device ? getDeviceModelId(profile.device.modelId) : null;
  const batteryPercent = profile?.device ? Math.round(profile.device.batteryLevel * 100) : 0;

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
          <Text variant="bodyLineHeight" color={hasBackup ? "success.c80" : "neutral.c80"}>
            {hasBackup ? "Ledger Sync is active" : "No sync configured"}
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
          {hasBackup ? "Manage Sync" : "Set up Ledger Sync"}
        </Button>
      </Flex>

      <ActivationDrawer
        startingStep={Steps.Activation}
        isOpen={isDrawerVisible}
        handleClose={closeDrawer}
      />
    </SettingsNavigationScrollView>
  );
}
