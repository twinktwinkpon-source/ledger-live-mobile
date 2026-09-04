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
  // Upstream's redesigned Send flow (src/mvvm/features/Send — lumen UI, new
  // Recipient/Amount/CustomFees/Signature screens). Upstream defaults it OFF
  // (partial rollout), which is why the legacy MODAL_SEND kept opening in FLEX.
  // The new flow is already flex-wired: useSendFlowTransaction routes every
  // account through the fake bridge and SignatureScreen uses the fake
  // transaction action (native Lottie signing animation). Families list mirrors
  // the fake bridge coverage so no family falls back to the legacy modal.
  newSendFlow: {
    enabled: true,
    params: {
      families: [
        "bitcoin",
        "bitcoin_cash",
        "litecoin",
        "dogecoin",
        "evm",
        "solana",
        "ton",
        "zcash",
        "ripple",
        "stellar",
        "cosmos",
        "cardano",
        "tron",
        "polkadot",
        "alchemy",
        "internet_computer",
        "hedera",
        "canton",
        "sui",
        "aptos",
        "near",
        "tezos",
      ],
      excludedCurrencyIds: [],
    },
  } as unknown as PartialFeatures["newSendFlow"],
} as unknown as PartialFeatures;
