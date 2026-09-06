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
} as unknown as PartialFeatures;
