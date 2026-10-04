import type { PartialFeatures } from "@shared/feature-flags";

/**
 * FLEX (mobile): the demo build has no Firebase rollout of its own, but the
 * app still fetches Ledger's live remote flags. This forced batch pins the
 * flags the flex experience depends on, mirroring the desktop
 * `flexFeatureFlags.ts` mechanism (envFlags layer beats remote config).
 *
 * Priority chain in @shared/feature-flags resolution:
 *   local override > envFlags (this batch) > remote config > defaults
 */
export function isFlexDemoBuild(): boolean {
  // FLEX production builds keep flex mode on by default (mirrors desktop).
  return true;
}

export const FLEX_FORCED_FEATURE_FLAGS = {
  // Ledger Sync on mobile: gates the "Ledger Sync" card on the onboarding
  // "Welcome back" screen (replaces the dead legacy "sync with desktop"
  // navigate target, which points at a screen removed from the navigator —
  // hence the dead tap) and the whole native WalletSync activation drawer
  // with the QR scanner the flex flow needs.
  llmWalletSync: {
    enabled: true,
    params: {
      environment: "PROD",
      watchConfig: {},
      learnMoreLink: "",
    },
  },
  // Upstream's optimised activation screen (plain "Turn on Ledger Sync?"
  // prompt → choose method → QR scanner) — the flow our QR lives in.
  lwmLedgerSyncOptimisation: { enabled: true },
  // Wallet 4.0 / redesigned main navigation (Lumen UI): the whole modern UI
  // (Wallet40TabNavigator, graph rework, quick-action CTAs, lazy onboarding,
  // operations list, asset section) is gated behind this flag, which defaults
  // OFF upstream and is only partially rolled out remotely. The desktop demo
  // pins lwdWallet40 the same way (renderer/mocks/flexFeatureFlags.ts) —
  // without this pin the app boots into the legacy Ledger Live 3.x UI.
  lwmWallet40: {
    enabled: true,
    params: {
      marketBanner: true,
      graphRework: true,
      quickActionCtas: true,
      mainNavigation: true,
      tour: true,
      lazyOnboarding: true,
      balanceRefreshRework: true,
      assetSection: true,
      newReceiveDialog: true,
      operationsList: true,
      brazePlacement: true,
      aggregatedAssets: true,
      myWallet: false,
      pnl: false,
      assetDiscoverability: false,
      earnUpselling: false,
      earnSimulator: false,
    },
  },
  // Swap Live App (Wallet 4.0 "Обмен" tab): upstream ships this OFF and only
  // rolls it out remotely, so the manifest never resolves without a pin and
  // the tab dies with "Приложение Swap Live не найдено". manifest_id must
  // match the live manifest the app can actually fetch.
  ptxSwapLiveAppMobile: {
    enabled: true,
    params: {
      manifest_id: "swap-live-app-demo-3",
    },
  },
} as unknown as PartialFeatures;
