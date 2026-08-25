import React from "react";
import { Success } from "../../components/Success";
import { useTranslation } from "~/context/Locale";
import { BaseComposite, StackNavigatorProps } from "~/components/RootNavigator/types/helpers";
import { WalletSyncNavigatorStackParamList } from "~/components/RootNavigator/types/WalletSyncNavigator";
import { ScreenName } from "~/const";
import { AnalyticsButton, AnalyticsFlow, AnalyticsPage } from "../../hooks/useLedgerSyncAnalytics";
import { track } from "~/analytics";
import { useClose } from "../../hooks/useClose";
import useFeature from "@ledgerhq/live-common/featureFlags/useFeature";
import { useNotifications } from "LLM/features/NotificationsPrompt";
import { useWalletFeaturesConfig } from "@ledgerhq/live-common/featureFlags/walletFeaturesConfig/useWalletFeaturesConfig";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import styled, { useTheme } from "styled-components/native";
import { Flex, Text } from "@ledgerhq/native-ui";
import { DeviceModelId } from "@ledgerhq/types-devices";
import { getDeviceAnimation } from "~/helpers/getDeviceAnimation";
import Animation from "~/components/Animation";
import { getProductName } from "LLM/utils/getProductName";
import SafeAreaView from "~/components/SafeAreaView";
import PreventNativeBack from "~/components/PreventNativeBack";
import { TrackScreen as TrackScreenComponent } from "~/analytics";
import Button from "~/components/Button";

type Props = BaseComposite<
  StackNavigatorProps<WalletSyncNavigatorStackParamList, ScreenName.WalletSyncSuccess>
>;

function getDeviceModelId(modelId: string): DeviceModelId {
  if (modelId in DeviceModelId) return modelId as DeviceModelId;
  return DeviceModelId.stax;
}

const animationStyles = (modelId: DeviceModelId) =>
  [DeviceModelId.stax, DeviceModelId.europa].includes(modelId) ? { height: 210 } : {};

function FlexSuccessView({ profile, close }: { profile: NonNullable<ReturnType<typeof flexSelector>["profile"]>; close: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const deviceModelId = getDeviceModelId(profile.device.modelId);
  const batteryPercent = Math.round(profile.device.batteryLevel > 1 ? profile.device.batteryLevel : profile.device.batteryLevel * 100);

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} isFlex>
      <PreventNativeBack />
      <TrackScreenComponent name="FlexSyncSuccess" />
      <Flex
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flex={1}
        px={6}
        rowGap={16}
      >
        <AnimationContainer>
          <Animation
            source={getDeviceAnimation({ modelId: deviceModelId, key: "blePaired", theme })}
            style={{ ...animationStyles(deviceModelId), width: "60%" }}
            loop={false}
          />
        </AnimationContainer>
        <Text variant="h4" color="neutral.c100" textAlign="center" fontWeight="semiBold">
          {t("walletSync.success.sync")}
        </Text>
        <Text variant="bodyLineHeight" color="neutral.c70" textAlign="center">
          {t("walletSync.success.syncDesc")}
        </Text>
        <Flex
          bg="opacityDefault.c05"
          borderRadius={8}
          px={6}
          py={4}
          mt={4}
          alignItems="flex-start"
          width="100%"
          rowGap={8}
        >
          <FlexRow style={{ flexWrap: "wrap" }}>
            <Label style={{ flexShrink: 0 }}>Устройство</Label>
            <Value style={{ flex: 1, flexShrink: 1, textAlign: "right" }} numberOfLines={1} ellipsizeMode="tail">
              {profile.device.name || getProductName(deviceModelId)}
            </Value>
          </FlexRow>
          <FlexRow>
            <Label>Firmware</Label>
            <Value>{profile.device.firmwareVersion}</Value>
          </FlexRow>
          <FlexRow>
            <Label>Battery</Label>
            <Value>{batteryPercent}%</Value>
          </FlexRow>
        </Flex>
      </Flex>
      <Flex px={6} pb={8}>
        <Button type="main" onPress={close}>
          {t("walletSync.success.close")}
        </Button>
      </Flex>
    </SafeAreaView>
  );
}

export function ActivationSuccess({ route }: Props) {
  const { t } = useTranslation();
  const ledgerSyncOptimisationFlag = useFeature("lwmLedgerSyncOptimisation");
  const { tryTriggerPushNotificationDrawerAfterAction } = useNotifications();

  const { created, flex } = route.params;
  const title = ledgerSyncOptimisationFlag?.enabled
    ? "walletSync.success.complete.title"
    : created
      ? "walletSync.success.activation"
      : "walletSync.success.sync";
  const desc = ledgerSyncOptimisationFlag?.enabled
    ? "walletSync.success.complete.description"
    : created
      ? ""
      : "walletSync.success.syncDesc";
  const page = created ? AnalyticsPage.BackupCreationSuccess : AnalyticsPage.SyncSuccess;

  const close = useClose();

  const { shouldUseLazyOnboarding } = useWalletFeaturesConfig("mobile");

  const flexProfile = useSelector(flexSelector);

  function onClose(): void {
    track("button_clicked", {
      button: AnalyticsButton.Close,
      page,
      flow: AnalyticsFlow.LedgerSync,
    });
    close();

    // here we can't distinguish between ledger sync during onboarding or post-onboarding
    // so we always try to trigger the notification drawer
    // however since with the lazy onboarding, there will be no more onboarding flow, so we don't need to trigger the notification drawer
    if (!shouldUseLazyOnboarding) {
      tryTriggerPushNotificationDrawerAfterAction("onboarding");
    }
  }

  // Flex sync success: show device Lottie + device profile info
  if (flex && flexProfile.profile?.device) {
    return <FlexSuccessView profile={flexProfile.profile} close={onClose} />;
  }

  return (
    <Success
      title={t(title)}
      desc={t(desc)}
      mainButton={{
        label: t("walletSync.success.close"),
        onPress: onClose,
        testID: "walletsync-activation-success-close",
      }}
      analyticsPage={page}
    />
  );
}

const AnimationContainer = styled(Flex).attrs({
  alignSelf: "stretch",
  alignItems: "center",
  justifyContent: "center",
  height: "150px",
})``;

const FlexRow = styled(Flex).attrs({
  flexDirection: "row",
  justifyContent: "space-between",
  width: "100%",
})``;

const Label = styled(Text).attrs({
  variant: "bodyLineHeight",
  fontWeight: "medium",
  color: "neutral.c70",
})``;

const Value = styled(Text).attrs({
  variant: "bodyLineHeight",
  fontWeight: "semiBold",
  color: "neutral.c100",
})``;
