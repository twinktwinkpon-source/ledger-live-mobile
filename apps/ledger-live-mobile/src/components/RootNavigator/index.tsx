import React from "react";
import { useSelector } from "~/context/hooks";
import Config from "react-native-config";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { NavigatorName } from "~/const";
import { hasCompletedOnboardingSelector } from "~/reducers/settings";
import { isFlexDemoBuild } from "~/flex/flexFeatureFlags";
import BaseNavigator from "./BaseNavigator";
import BaseOnboardingNavigator from "./BaseOnboardingNavigator";
import { RootStackParamList } from "./types/RootNavigator";
import { AnalyticsContextProvider } from "~/analytics/AnalyticsContext";
import { StartupTimeMarker } from "../../StartupTimeMarker";

export default function RootNavigator() {
  const hasCompletedOnboarding = useSelector(hasCompletedOnboardingSelector);
    // FLEX: the demo build must never fall into the onboarding navigator — the QR
    // scan completes onboarding (completeOnboarding()) and RootNavigator then
    // unmounts BaseOnboardingNavigator under the user's feet, leaving a black
    // screen after "Close". The env-flag gate (Config.SKIP_ONBOARDING) depended on
    // the .env value surviving react-native-config's native build phase; a flex
    // build is flex regardless of whether that string made it, so pin it in JS too.
    const goToOnboarding = !hasCompletedOnboarding && !isFlexDemoBuild() && !Config.SKIP_ONBOARDING;

  return (
    <StartupTimeMarker>
      <AnalyticsContextProvider>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
          }}
        >
          {/* Single registration of BaseOnboarding: before, this screen was
              declared TWICE (once gated by goToOnboarding, once by
              hasCompletedOnboarding). With both flags true the navigator held
              two routes named NavigatorName.BaseOnboarding, and the
              post-scan `replace(NavigatorName.Base, {screen: Main})` from
              useClose() resolved against the duplicate set — the wallet
              mounted but rendered black. Register it exactly once. */}
          {goToOnboarding || hasCompletedOnboarding ? (
            <Stack.Screen name={NavigatorName.BaseOnboarding} component={BaseOnboardingNavigator} />
          ) : null}
          <Stack.Screen name={NavigatorName.Base} component={BaseNavigator} />
        </Stack.Navigator>
      </AnalyticsContextProvider>
    </StartupTimeMarker>
  );
}
const Stack = createNativeStackNavigator<RootStackParamList>();
