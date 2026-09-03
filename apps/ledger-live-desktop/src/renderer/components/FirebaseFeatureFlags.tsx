import React, { useCallback, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import { FeatureFlagsProvider, isFeature } from "@ledgerhq/live-common/featureFlags/index";
import type { FirebaseFeatureFlagsProviderProps as Props } from "@ledgerhq/live-common/featureFlags/index";
import { FeatureId } from "@ledgerhq/types-live";
import { useFirebaseRemoteConfig } from "./FirebaseRemoteConfig";
import { featureFlagsOverridesSelector } from "@shared/feature-flags";
import { setSelectedTimeRange } from "../actions/settings";
import { setAnalyticsFeatureFlagMethod } from "../analytics/segment";
import { useWalletFeaturesConfig } from "@ledgerhq/live-common/featureFlags/walletFeaturesConfig/useWalletFeaturesConfig";

export const FirebaseFeatureFlagsProvider = ({
  children,
  getFeature,
}: Props): React.JSX.Element => {
  const { config: remoteConfig, lastFetchTime } = useFirebaseRemoteConfig();

  const dispatch = useDispatch();
  const localOverrides = useSelector(featureFlagsOverridesSelector);
  const { shouldDisplayGraphRework: isWallet40GraphReworkEnabled } =
    useWalletFeaturesConfig("desktop");

  const wrappedGetFeature = useCallback(
    <T extends FeatureId>(key: T) => {
      const remoteValue = getFeature({ key, localOverrides });

      // Force-enable critical flags at the provider level so remote
      // Firebase config cannot override them. This ensures the MVVM
      // Portfolio layout, PerpsEntryPoint, and native Swap widget
      // always render — even on the very first render before
      // the useEffect override dispatches have taken effect.
      if (key === "lwdWallet40") {
        return {
          ...remoteValue,
          enabled: true,
          params: {
            marketBanner: true,
            graphRework: true,
            quickActionCtas: true,
            quickActionsCtasVariant: false,
            mainNavigation: true,
            tour: true,
            lazyOnboarding: true,
            newReceiveDialog: true,
            balanceRefreshRework: true,
            brazePlacement: true,
            assetSection: true,
            operationsList: true,
            aggregatedAssets: true,
            myWallet: false,
            pnl: false,
            finishOnboardingWidget: false,
            earnUpselling: true,
            earnSimulator: true,
          },
        };
      }

      if (key === "ptxSwapLiveAppOnPortfolio") {
        return { ...remoteValue, enabled: true };
      }

      if (key === "ptxPerpsLiveApp") {
        return {
          ...remoteValue,
          enabled: true,
          params: { manifest_id: "perps-live-app" },
        };
      }

      if (key === "portfolioExchangeBanner") {
        return { ...remoteValue, enabled: false };
      }

      if (key === "ptxEarnUi") {
        return { ...remoteValue, enabled: true, params: { value: "v2" } };
      }

      if (key === "ptxEarnLiveApp") {
        return { ...remoteValue, enabled: true, params: { manifest_id: "earn" } };
      }

      if (key === "ptxBorrowLiveApp") {
        return { ...remoteValue, enabled: true, params: { manifest_id: "borrow" } };
      }

      if (key === "newSendFlow") {
        return {
          ...remoteValue,
          enabled: true,
          params: {
            families: [
              "evm", "bitcoin", "bitcoin_cash", "litecoin", "dogecoin",
              "solana", "ripple", "cardano", "polkadot", "tron", "ton",
              "cosmos", "near", "aptos", "avalanche_c_chain", "stellar",
              "polygon", "algorand", "filecoin", "celo", "crypto_org",
              "fantom", "hedera", "kaspa", "sui", "sei", "injective",
              "mantra", "xrp", "etc",
            ],
            excludedCurrencyIds: [],
          },
        };
      }

      return remoteValue;
    },
    [getFeature, localOverrides],
  );

  useEffect(() => {
    if (remoteConfig) {
      setAnalyticsFeatureFlagMethod(wrappedGetFeature);
    }
    return () => setAnalyticsFeatureFlagMethod(null);
  }, [remoteConfig, wrappedGetFeature]);

  // That's temporary until wallet 4.0 is 100% enabled
  // We need to set the selected time range to day at each app launch for the wallet 4.0 feature flag
  useEffect(() => {
    if (isWallet40GraphReworkEnabled) {
      dispatch(setSelectedTimeRange("day"));
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- run only once
  }, []);

  const contextValue = useMemo(
    () => ({
      isFeature,
      getFeature: wrappedGetFeature,
      overrideFeature: () => {},
      resetFeature: () => {},
      resetFeatures: () => {},
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [wrappedGetFeature, lastFetchTime],
  );

  return <FeatureFlagsProvider value={contextValue}>{children}</FeatureFlagsProvider>;
};
