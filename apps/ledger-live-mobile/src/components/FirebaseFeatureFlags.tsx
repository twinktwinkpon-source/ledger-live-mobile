import React, { useCallback, useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "~/context/hooks";
import isEqual from "lodash/isEqual";
import {
  FeatureFlagsProvider,
  DEFAULT_FEATURES,
  isFeature,
  getFeature as getFeatureFlag,
} from "@ledgerhq/live-common/featureFlags/index";
import type { FirebaseFeatureFlagsProviderProps } from "@ledgerhq/live-common/featureFlags/index";
import { FeatureId, Feature } from "@ledgerhq/types-live";
import { featureFlagsOverridesSelector, setOverride, setAllOverrides } from "@shared/feature-flags";
import { setAnalyticsFeatureFlagMethod } from "~/analytics/segment";
import { useSettings } from "~/hooks";
import { isFlexDemoBuild } from "~/flex/flexFeatureFlags";

/**
 * @returns all flags that have different defaults are exported as a key value map
 */
export const getAllDivergedFlags = (
  appLanguage: string,
): Partial<{ [key in FeatureId]: boolean }> => {
  const res: Partial<{ [key in FeatureId]: boolean }> = {};
  Object.keys(DEFAULT_FEATURES).forEach(k => {
    const key = k as keyof typeof DEFAULT_FEATURES;
    const value = getFeatureFlag({ key, appLanguage });
    if (value && value.enabled !== DEFAULT_FEATURES[key]?.enabled) {
      res[key] = value.enabled;
    }
  });

  return res;
};

export const FirebaseFeatureFlagsProvider = ({
  children,
  getFeature,
}: FirebaseFeatureFlagsProviderProps) => {
  const localOverrides = useSelector(featureFlagsOverridesSelector);
  const dispatch = useDispatch();
  const { language } = useSettings();

  const overrideFeature = useCallback(
    (key: FeatureId, value: Feature): void => {
      const actualRemoteValue = getFeature({
        key,
        appLanguage: language,
        allowOverride: false,
      });
      if (!isEqual(actualRemoteValue, value)) {
        const { overriddenByEnv: _, ...pureValue } = value;
        const overriddenValue = { ...pureValue, overridesRemote: true };
        dispatch(setOverride({ key, value: overriddenValue }));
      } else {
        dispatch(setOverride({ key, value: undefined }));
      }
    },
    [language, dispatch, getFeature],
  );

  const resetFeature = useCallback(
    (key: FeatureId): void => {
      dispatch(setOverride({ key, value: undefined }));
    },
    [dispatch],
  );

  const resetFeatures = useCallback((): void => {
    dispatch(setAllOverrides({}));
  }, [dispatch]);

  const wrappedGetFeature = useCallback(
    <T extends FeatureId>(key: T) => {
      // FLEX: force the Wallet 4.0 / Lumen flags at the provider level so that
      // remote Firebase config or a stale persisted override can never ...[truncated]

      if (
        isFlexDemoBuild() &&
        (key === "lwmWallet40" || key === "ptxSwapLiveAppOnPortfolio")
      ) {
        const remoteValue = getFeature({ key, appLanguage: language, localOverrides });
        if (key === "lwmWallet40") {
          return {
            ...remoteValue,
            enabled: true,
            params: {
              ...(remoteValue.params ?? {}),
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
        return { ...remoteValue, enabled: true };
      }
      return getFeature({ key, appLanguage: language, localOverrides });
    },
    [localOverrides, language, getFeature],
  );

  useEffect(() => {
    setAnalyticsFeatureFlagMethod(wrappedGetFeature);
    return () => setAnalyticsFeatureFlagMethod(null);
  }, [wrappedGetFeature]);

  const contextValue = useMemo(
    () => ({
      isFeature,
      getFeature: wrappedGetFeature,
      overrideFeature,
      resetFeature,
      resetFeatures,
    }),
    [overrideFeature, resetFeature, resetFeatures, wrappedGetFeature],
  );
  return <FeatureFlagsProvider value={contextValue}>{children}</FeatureFlagsProvider>;
};
