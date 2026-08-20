import React, { useMemo } from "react";
import Dashboard from "~/renderer/screens/manager/Dashboard";
import { SyncSkipUnderPriority } from "@ledgerhq/live-common/bridge/react/index";
import { getFlexProfile } from "~/renderer/mocks/fakeFlexBuild";

const mockDeviceInfo = {
  version: "2.6.1",
  mcuVersion: "2.8",
  majMin: "2.6",
  isBootloader: false,
  isOSU: false,
  isRecoveryMode: false,
  managerAllowed: true,
  targetId: 0x33000004,
};

const cryptoList = [
  { n: "Bitcoin", t: "BTC", id: "bitcoin" },
  { n: "Ethereum", t: "ETH", id: "ethereum" },
  { n: "Solana", t: "SOL", id: "solana" },
  { n: "Ripple", t: "XRP", id: "ripple" },
  { n: "Cardano", t: "ADA", id: "cardano" },
  { n: "Dogecoin", t: "DOGE", id: "dogecoin" },
  { n: "Polkadot", t: "DOT", id: "polkadot" },
  { n: "Tron", t: "TRX", id: "tron" },
  { n: "Polygon", t: "MATIC", id: "polygon" },
  { n: "Litecoin", t: "LTC", id: "litecoin" },
  { n: "Avalanche", t: "AVAX", id: "avalanche_c_chain" },
  { n: "NEAR", t: "NEAR", id: "near" },
  { n: "Toncoin", t: "TON", id: "ton" },
  { n: "Algorand", t: "ALGO", id: "algorand" },
  { n: "Cosmos", t: "ATOM", id: "cosmos" },
  { n: "Stellar", t: "XLM", id: "stellar" },
  { n: "Filecoin", t: "FIL", id: "filecoin" },
  { n: "Tezos", t: "XTZ", id: "tezos" },
  { n: "Zcash", t: "ZEC", id: "zcash" },
  { n: "Bitcoin Cash", t: "BCH", id: "bitcoin_cash" },
];

const createMockApp = (id: number, name: string, ticker: string, cId: string) => ({
  id,
  name,
  displayName: name,
  version: "2.1.0",
  currencyId: cId,
  currency: { type: "CryptoCurrency", id: cId, name, ticker, color: "#000000" },
  dependencies: [],
  bytes: 4096,
  type: "currency",
  indexOfMarketCap: id,
});

const mockListAppsResult = {
  appByName: {} as any,
  appsListNames: cryptoList.map(c => c.n),
  installed: [] as any[],
  installedAvailable: true,
  deviceModelId: "nanoX",
  deviceInfo: mockDeviceInfo,
  customImageBlocks: 0,
};

cryptoList.forEach((c, i) => {
  const app = createMockApp(i + 1, c.n, c.t, c.id);
  mockListAppsResult.appByName[c.n] = app;
  if (i < 6)
    mockListAppsResult.installed.push({
      ...app,
      updated: true,
      availableVersion: "2.1.0",
      blocks: 1,
      hash: "h" + i,
    });
});

export default function Manager() {
  const profile = getFlexProfile();
  const modelId = (profile?.device?.modelId || "stax") as string;
  const device = useMemo(
    () =>
      ({
        deviceId: "mock-flex-device",
        modelId,
        wired: true,
      }) as any,
    [modelId],
  );

  const result = useMemo(
    () => ({
      ...mockListAppsResult,
      deviceModelId: modelId,
    }) as any,
    [modelId],
  );

  return (
    <>
      <SyncSkipUnderPriority priority={999} />
      <Dashboard
        device={device}
        deviceInfo={mockDeviceInfo as any}
        result={result}
        onReset={() => {}}
        appsToRestore={[]}
        onRefreshDeviceInfo={() => {}}
      />
    </>
  );
}
