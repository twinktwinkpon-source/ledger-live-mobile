import React, { useCallback } from "react";
import { lastConnectedDeviceSelector } from "~/reducers/settings";
import { flexSelector } from "~/reducers/flex";
import { useSelector } from "~/context/hooks";
import { getDeviceIcon, type IconComponent } from "LLM/utils/getDeviceIcon";

export type TopBarActionIcon = {
  id: string;
  icon: IconComponent;
  callback: () => void;
  testID: string;
  accessibilityLabel: string;
  loading?: boolean;
  wrapper?: (children: React.ReactElement) => React.ReactElement;
};

export function useMyLedgerTopBarAction(onPress: () => void): TopBarActionIcon {
  const lastConnectedDevice = useSelector(lastConnectedDeviceSelector);
  // Flex sync: reflect the device chosen in the desktop admin panel (Device
  // Selection → Save Device) — profile.device.modelId overrides BLE history.
  const flexProfileModelId = useSelector(
    (s: { flex: { profile: { device?: { modelId?: string } } | null } }) =>
      s.flex?.profile?.device?.modelId,
  );

  const effectiveDevice = flexProfileModelId
    ? { ...lastConnectedDevice, modelId: flexProfileModelId }
    : lastConnectedDevice;

  const deviceIcon: IconComponent = useCallback(
    ({ size, style }) => getDeviceIcon(effectiveDevice, size, style),
    [effectiveDevice],
  );

  return {
    id: "my-ledger",
    icon: deviceIcon,
    callback: onPress,
    testID: "topbar-myledger",
    accessibilityLabel: "My Ledger",
  };
}
