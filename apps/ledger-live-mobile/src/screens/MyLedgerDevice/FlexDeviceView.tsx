import React, { useMemo, useReducer } from "react";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import DeviceCard from "~/screens/MyLedgerDevice/Device";
import { getDeviceModel } from "@ledgerhq/devices";
import type { DeviceInfo } from "@ledgerhq/types-live";
import type { Device } from "@ledgerhq/live-common/hw/actions/types";
import { initState, reducer, predictOptimisticState, distribute } from "@ledgerhq/live-common/apps/index";
import type { ListAppsResult } from "@ledgerhq/live-common/apps/types";
import { useAppsSections } from "@ledgerhq/live-common/apps/react";

export default function FlexDeviceView() {
  const flex = useSelector(flexSelector);

  const device = useMemo<Device>(() => {
    const modelId = flex.profile?.device?.modelId ?? "nanoX";
    return {
      deviceId: `flex|${modelId}`,
      deviceName: flex.profile?.device?.name ?? "Ledger Nano X",
      modelId,
      wired: false,
    };
  }, [flex.profile?.device?.modelId, flex.profile?.device?.name]);

  const deviceInfo = useMemo<DeviceInfo>(() => {
    const version = flex.profile?.device?.firmwareVersion ?? "2.4.1";
    return {
      version,
      majMin: version.split(".").slice(0, 2).join("."),
      mcuVersion: "",
      targetId: 0,
      isBootloader: false,
      isOSU: false,
      providerName: null,
      managerAllowed: true,
      pinValidated: true,
    };
  }, [flex.profile?.device?.firmwareVersion]);

  const result = useMemo<ListAppsResult>(() => {
    const installed = (flex.profile?.installedApps ?? []).map(a => ({
      name: a.name,
      updated: true,
      hash: "",
      blocks: 0,
      version: a.version,
      availableVersion: a.version,
    }));
    const appByName: ListAppsResult["appByName"] = {};
    for (const a of installed) {
      appByName[a.name] = {
        id: a.name as never,
        name: a.name,
        displayName: a.name,
        version: a.version,
        currencyId: null,
        description: "",
        dateModified: "",
        icon: "",
        authorName: "Ledger",
        supportURL: null,
        contactURL: null,
        sourceURL: null,
        hash: "",
        perso: "",
        firmware: "",
        firmware_key: "",
        delete: "",
        delete_key: "",
        dependencies: [],
        bytes: null,
        warning: null,
        indexOfMarketCap: -1,
        isDevTools: false,
        type: "currency",
      } as never;
    }
    return {
      installed,
      appByName,
      appsListNames: Object.keys(appByName),
      deviceInfo,
      deviceModelId: device.modelId as never,
      deviceName: device.deviceName ?? "Ledger Nano X",
      firmware: null,
      customImageBlocks: 0,
      installedAvailable: true,
      installedLanguagePack: undefined,
    } as never;
  }, [flex.profile?.installedApps, device, deviceInfo]);

  const [state, dispatch] = useReducer(reducer, null, () => initState(result));
  const optimisticState = predictOptimisticState(state);
  const distribution = distribute(state);
  const { device: deviceApps } = useAppsSections(state, {
    query: "",
    appFilter: "all",
    sort: { type: "marketcap", order: "desc" },
  });

  return (
    <DeviceCard
      distribution={distribution}
      state={state}
      result={result}
      deviceId={device.deviceId}
      initialDeviceName={device.deviceName}
      pendingInstalls={false}
      deviceInfo={deviceInfo}
      device={device}
      dispatch={dispatch}
      appList={deviceApps}
      onLanguageChange={() => {}}
    />
  );
}
