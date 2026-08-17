import React, { useEffect, useRef } from "react";
import { WalletSyncNavigatorStackParamList } from "~/components/RootNavigator/types/WalletSyncNavigator";
import { ScreenName } from "~/const";
import { BaseComposite, StackNavigatorProps } from "~/components/RootNavigator/types/helpers";
import { useLoadingStep } from "../../hooks/useLoadingStep";
import { TrackScreen } from "~/analytics";
import { AnalyticsPage } from "../../hooks/useLedgerSyncAnalytics";
import GradientContainer from "~/components/GradientContainer";
import Animation from "~/components/Animation";
import { Flex, Text } from "@ledgerhq/native-ui";
import lottie from "~/animations/lottie.json";
import { useTheme } from "styled-components/native";
import { useTranslation } from "~/context/Locale";
import { useSelector, useDispatch } from "~/context/hooks";
import { hasCompletedOnboardingSelector, onboardingTypeSelector } from "~/reducers/settings";
import {
  completeOnboarding,
  setIsReborn,
  setOnboardingHasDevice,
  setReadOnlyMode,
} from "~/actions/settings";
import PreventNativeBack from "~/components/PreventNativeBack";
import { OnboardingType } from "~/reducers/types";
import { updateMainNavigatorVisibility } from "~/actions/appstate";
import { useNavigation } from "@react-navigation/core";
import { NavigatorName } from "~/const";

type Props = BaseComposite<
  StackNavigatorProps<WalletSyncNavigatorStackParamList, ScreenName.WalletSyncLoading>
>;

export function ActivationLoading({ route }: Props) {
  const { created, flex } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigation = useNavigation();

  const title = "walletSync.loading.title";
  const subtitle = created ? "walletSync.loading.activation" : "walletSync.loading.synch";

  // Flex sync: no trustchain watch loop — navigate to success after a brief visual pause
  const flexNavigated = useRef(false);
  useEffect(() => {
    if (flex && !flexNavigated.current) {
      flexNavigated.current = true;
      const timer = setTimeout(() => {
        navigation.navigate(NavigatorName.WalletSync, {
          screen: ScreenName.WalletSyncSuccess,
          params: { created: false, flex: true },
        });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [flex, navigation]);

  // Trustchain sync: use the watch loop-based loading step
  if (!flex) {
    useLoadingStep(created);
  }

  const hasCompletedOnboarding = useSelector(hasCompletedOnboardingSelector);
  const onboardingType = useSelector(onboardingTypeSelector);

  useEffect(() => {
    if (!hasCompletedOnboarding && onboardingType !== OnboardingType.setupNew) {
      dispatch(completeOnboarding());
    }
    dispatch(setOnboardingHasDevice(true));
    dispatch(setIsReborn(false));
    dispatch(setReadOnlyMode(false));
    dispatch(updateMainNavigatorVisibility(true));
  }, [dispatch, hasCompletedOnboarding, onboardingType]);

  return (
    <>
      <PreventNativeBack />
      <TrackScreen category={AnalyticsPage.Loading} />
      <GradientContainer
        color={colors.background.main}
        startOpacity={1}
        endOpacity={0}
        containerStyle={{ borderRadius: 0, position: "absolute", bottom: 0, left: 0 }}
        gradientStyle={{ zIndex: 1 }}
      >
        <Animation style={{ width: "100%" }} source={lottie} />
      </GradientContainer>
      <Flex flex={1} position="relative">
        <Flex flex={1} alignItems="center" justifyContent="center" m={6}>
          <Text variant="h4" fontWeight="semiBold" textAlign="center">
            {t(title)}
          </Text>
          <Text mt={6} textAlign="center" variant="body" fontWeight="medium" color="neutral.c80">
            {t(subtitle)}
          </Text>
        </Flex>
      </Flex>
    </>
  );
}
