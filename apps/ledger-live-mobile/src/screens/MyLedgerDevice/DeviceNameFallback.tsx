import React from "react";
import { DeviceModelId } from "@ledgerhq/devices";
import { useTheme } from "styled-components/native";
import Animation from "~/components/Animation";
import { getDeviceAnimation } from "~/helpers/getDeviceAnimation";

/**
 * Real device lottie for the flex profile device.
 *
 * The flex profile carries a `modelId` ("nanoX"), so the Manager-style device
 * illustration is the SAME lottie animation the rest of the app plays for that
 * model — not a static logo image. `blePaired` is the settled connected pose
 * (the exact animation BleDevicePaired shows once a device is paired).
 */
const ANIMATION_KEY = "blePaired" as const;
const KNOWN_MODELS: readonly DeviceModelId[] = [
  DeviceModelId.nanoS,
  DeviceModelId.nanoSP,
  DeviceModelId.blue,
  DeviceModelId.nanoX,
  DeviceModelId.stax,
  DeviceModelId.europa,
  DeviceModelId.apex,
];

export function DeviceNameFallback({
  modelId,
}: {
  modelId: DeviceModelId;
}) {
  const { theme } = useTheme();
  const known = KNOWN_MODELS.includes(modelId) ? modelId : DeviceModelId.nanoX;
  const animation = getDeviceAnimation({
    modelId: known as never,
    key: ANIMATION_KEY,
    theme,
  });

  if (!animation) return null;

  return <Animation source={animation} />;
}
