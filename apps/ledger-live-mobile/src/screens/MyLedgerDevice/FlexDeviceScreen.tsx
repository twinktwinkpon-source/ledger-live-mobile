import React from "react";
import FlexDeviceView from "./FlexDeviceView";

/**
 * Dedicated flex device screen in the MyLedger navigator.
 * Registered as ScreenName.MyLedgerFlexDevice — mirrors how MyLedgerDevice
 * serves real BLE devices. Own component = own hooks, zero coupling with
 * the BLE manager screen.
 */
export default function FlexDeviceScreen() {
  return <FlexDeviceView />;
}
