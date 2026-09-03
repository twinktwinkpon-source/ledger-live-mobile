import type { PartialFeatures } from "@shared/feature-flags";

/**
 * FLEX: the demo build has no Firebase Remote Config rollout of its own, but the
 * renderer still fetches Ledger's live remote flags, which gate Wallet 4.0 behind
 * partial rollout cohorts (operationsList / assetSection / aggregatedAssets and
 * the portfolio swap panel `ptxSwapLiveAppOnPortfolio` come back disabled).
 *
 * The flag resolution priority chain is:
 *   local override > env override > remote config > defaults
 * so the only layer that reliably beats the live remote values is `envFlags`.
 * These forced flags are merged into the store's resolutionConfig.envFlags when
 * the app runs as a FLEX build, pinning the fully-enabled Wallet 4.0 experience
 * (native UI, history clock, asset section, side swap panel) regardless of what
 * the remote returns.
 */
export function isFlexDemoBuild(): boolean {
  try {
    if (typeof process !== "undefined") {
      if (process.env.FLEX_DISABLE === "true") return false;
      if (process.env.FLEX_DEMO === "true") return true;
    }
  } catch {
    /* ignore */
  }
  // FLEX production builds keep flex mode on by default (mirrors fakeFlexBuild).
  return true;
}

export const FLEX_FORCED_FEATURE_FLAGS: PartialFeatures = {
  lwdWallet40: {
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
      earnUpselling: true,
      earnSimulator: true,
    },
  },
  // Right-hand portfolio panel (swap/earn side window) — gated separately upstream.
  ptxSwapLiveAppOnPortfolio: { enabled: true },
} as unknown as PartialFeatures;
