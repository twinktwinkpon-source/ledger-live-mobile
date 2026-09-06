import Config from "react-native-config";
import { configureStore, StoreEnhancer } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";
import VersionNumber from "react-native-version-number";
import reducers from "~/reducers";
import { rebootMiddleware } from "~/middleware/rebootMiddleware";
import { rozeniteDevToolsEnhancer } from "@rozenite/redux-devtools-plugin";
import { applyLlmRTKApiMiddlewares } from "~/context/rtkQueryApi";
import { setupCryptoAssetsStore } from "~/config/bridge-setup";
import { setupRecentAddressesStore } from "LLM/storage/recentAddresses";
import { setupFlexPersistence } from "~/flex/persistence";
import { createIdentitiesSyncMiddleware } from "@ledgerhq/client-ids/store";
import { State } from "~/reducers/types";
import { canPushDeviceIdsSelector } from "~/reducers/settings";
import { createFeatureFlagsMiddleware } from "@shared/feature-flags";
import { FLEX_FORCED_FEATURE_FLAGS, isFlexDemoBuild } from "~/flex/flexFeatureFlags";

export const store = configureStore({
  reducer: reducers,
  devTools: !!Config.DEBUG_RNDEBUGGER,
  middleware: getDefaultMiddleware =>
    applyLlmRTKApiMiddlewares(
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
    )
      .concat(rebootMiddleware)
      .concat(
        createIdentitiesSyncMiddleware({
          getIdentitiesState: (state: State) => state.identities,
          getAnalyticsConsent: canPushDeviceIdsSelector,
        }),
      )
      .concat(
        createFeatureFlagsMiddleware({
          resolutionConfig: {
            platform: Platform.OS === "ios" ? "ios" : "android",
            appVersion: VersionNumber.appVersion ?? undefined,
            // FLEX: pin the flex flags above the live Firebase remote config
            // (envFlags layer beats remote), mirroring the desktop store.
            envFlags: isFlexDemoBuild()
              ? { ...FLEX_FORCED_FEATURE_FLAGS }
              : undefined,
          } as Parameters<typeof createFeatureFlagsMiddleware>[0]["resolutionConfig"],
        }),
      ),

  enhancers: getDefaultEnhancers => {
    const enhancers = getDefaultEnhancers();
    // Type assertion needed due to Redux version compatibility types between v4 and v5
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return enhancers.concat(rozeniteDevToolsEnhancer() as StoreEnhancer);
  },
});

export type StoreType = typeof store;
export type AppDispatch = typeof store.dispatch;

setupListeners(store.dispatch, (dispatch, { onOnline, onOffline }) => {
  const unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected) {
      dispatch(onOnline());
    } else {
      dispatch(onOffline());
    }
  });
  return unsubscribe;
});
setupRecentAddressesStore(store);
setupCryptoAssetsStore(store);
setupFlexPersistence(store);
