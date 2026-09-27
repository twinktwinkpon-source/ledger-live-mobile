import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import WelcomePage from "LLM/features/WelcomePage";
import { ScreenName } from "~/const";
import type { BaseNavigatorStackParamList } from "~/components/RootNavigator/types/BaseNavigator";

/**
 * FLEX first-launch landing: the upstream Wallet 4.0 welcome page (three
 * tap-through story videos, progress bars, "Get started" footer). WelcomePage
 * exposes an `onGetStarted` override built for exactly this host case — the
 * flex build has no device onboarding to walk into, so the CTA routes to the
 * license QR scanner instead.
 */
export default function FlexWelcomeScreen({
  navigation,
}: NativeStackScreenProps<BaseNavigatorStackParamList, ScreenName.FlexWelcome>) {
  return <WelcomePage onGetStarted={() => navigation.replace(ScreenName.FlexScan)} />;
}
