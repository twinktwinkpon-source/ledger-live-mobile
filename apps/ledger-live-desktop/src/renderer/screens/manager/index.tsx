import React, { useMemo } from "react";
import Dashboard from "~/renderer/screens/manager/Dashboard";
import { SyncSkipUnderPriority } from "@ledgerhq/live-common/bridge/react/index";
import { getFlexProfile, getFlexDeviceName } from "~/renderer/mocks/fakeFlexBuild";

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
  mockListAppsResult.appByName[c.n] = createMockApp(i + 1, c.n, c.t, c.id);
});

/**
 * Derive the device's installed-apps list from the SERVER PROFILE
 * (admin panel → /balances endpoint → profile.installedApps).
 *
 * Root cause fix for the mobile-vs-desktop desync: the desktop previously
 * hard-coded "the first 6 catalog coins are installed", while the phone read
 * the real profile.installedApps from the license server — two different
 * sources showed different app lists for the SAME device. The server profile
 * is now the single source of truth on both platforms: an asset enabled in
 * the admin panel appears as an installed app on desktop exactly like it
 * appears in the phone's My Ledger.
 *
 * Unknown/unmapped tickers are skipped; an absent or empty profile yields an
 * empty installed list (the truthful "no apps" state) instead of fake ones.
 */
const deriveInstalledFromProfile = (): any[] => {
  const raw = getFlexProfile()?.installedApps;
  if (!Array.isArray(raw) || !raw.length) return [];
  const versionByTicker = new Map<string, string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const ticker = String(entry.name ?? "")
      .trim()
      .toUpperCase();
    if (ticker && !versionByTicker.has(ticker)) {
      versionByTicker.set(ticker, String(entry.version ?? "1.0"));
    }
  }
  if (!versionByTicker.size) return [];
  const installed: any[] = [];
  cryptoList.forEach((c, i) => {
    const version = versionByTicker.get(c.t);
    if (version === undefined) return;
    const app = createMockApp(i + 1, c.n, c.t, c.id);
    installed.push({
      ...app,
      updated: true,
      availableVersion: version,
      blocks: 1,
      hash: "h" + i,
    });
  });
  return installed;
};

export default function Manager() {
  const profile = getFlexProfile();
  const modelId = (profile?.device?.modelId || "stax") as string;
  // OS version / device name come from the admin panel profile (Device Profile → Save),
  // falling back to mock defaults when no panel profile exists yet.
  const deviceInfo = useMemo(
    () => ({
      ...mockDeviceInfo,
      version: profile?.device?.firmwareVersion || mockDeviceInfo.version,
    }) as any,
    [profile?.device?.firmwareVersion],
  );
  // FLEX_DEMO: a locally-renamed device name wins over the admin-panel profile
  // name (rename is persisted in localStorage since there is no hardware).
  const deviceName = getFlexDeviceName() || profile?.device?.name || "Ledger";
  const device = useMemo(
    () =>
      ({
        deviceId: "mock-flex-device",
        modelId,
        name: deviceName,
        wired: true,
      }) as any,
    [modelId, deviceName],
  );
  const installed = useMemo(
    () => deriveInstalledFromProfile(),
    // profile is a fresh object on every renderer reload (the only way flex
    // data changes in-session); reading it here keeps the dependency honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile],
  );
  const result = useMemo(
    () =>
      ({
        ...mockListAppsResult,
        deviceModelId: modelId,
        deviceInfo,
        installed,
        // DeviceDashboard reads result.deviceName — without it the header falls
        // back to the generic product name ("Ledger Nano X") and the renamed
        // device name never shows.
        deviceName,
      }) as any,
    [modelId, deviceInfo, installed, deviceName],
  );

  return (
    <>
      <SyncSkipUnderPriority priority={999} />
      <Dashboard
        device={device}
        deviceInfo={deviceInfo}
        result={result}
        onReset={() => {}}
        appsToRestore={[]}
        onRefreshDeviceInfo={() => {}}
      />
    </>
  );
}
