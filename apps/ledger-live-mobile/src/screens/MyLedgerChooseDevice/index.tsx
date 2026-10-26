import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "~/context/Locale";
import { Device } from "@ledgerhq/live-common/hw/actions/types";
import { BluetoothRequired } from "@ledgerhq/errors";
import { Result } from "@ledgerhq/live-common/hw/actions/manager";
import { Flex, Text } from "@ledgerhq/native-ui";
import TabBarSafeAreaView from "~/components/TabBar/TabBarSafeAreaView";
import { ScreenName } from "~/const";
import SelectDevice2, { SetHeaderOptionsRequest } from "~/components/SelectDevice2";
import TrackScreen from "~/analytics/TrackScreen";
import { track } from "~/analytics";
import DeviceActionModal from "~/components/DeviceActionModal";
import {
  BaseComposite,
  ReactNavigationHeaderOptions,
  StackNavigatorProps,
} from "~/components/RootNavigator/types/helpers";

import { MyLedgerNavigatorStackParamList } from "~/components/RootNavigator/types/MyLedgerNavigator";

import { useManagerDeviceAction } from "~/hooks/deviceActions";
import ContentCardsLocation from "~/dynamicContent/ContentCardsLocation";
import { ContentCardLocation } from "~/dynamicContent/types";
import { useAutoRedirectToPostOnboarding } from "~/hooks/useAutoRedirectToPostOnboarding";
import { HOOKS_TRACKING_LOCATIONS } from "~/analytics/hooks/variables";
import { useWalletFeaturesConfig } from "@features/platform-feature-flags";
import SafeAreaView from "~/components/SafeAreaView";
import { wallet40HeaderOptions } from "~/screens/MyLedgerChooseDevice/wallet40HeaderOptions";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import { Button } from "@ledgerhq/native-ui";
import { Image } from "react-native";
import { DeviceModelId as DeviceModelIdEnum } from "@ledgerhq/types-devices";
import { useNavigation as useNav } from "@react-navigation/native";
import { getDeviceIcon } from "LLM/utils/getDeviceIcon";
import {
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ListItemDescription,
  Text,
} from "@ledgerhq/lumen-ui-rnative";

/* eslint-disable @typescript-eslint/no-require-imports */
const deviceSources: Partial<Record<DeviceModelIdEnum, number>> = {
  [DeviceModelIdEnum.nanoS]: require("@assets/images/devices/nanoSNew.webp"),
  [DeviceModelIdEnum.nanoSP]: require("@assets/images/devices/nanoSPNew.webp"),
  [DeviceModelIdEnum.nanoX]: require("@assets/images/devices/nanoXNew.webp"),
  [DeviceModelIdEnum.stax]: require("@assets/images/devices/staxNew.webp"),
  [DeviceModelIdEnum.europa]: require("@assets/images/devices/flexNew.webp"),
  [DeviceModelIdEnum.apex]: require("@assets/images/devices/gen5New.webp"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ITEM_IMAGE_SIZE = 40;

/** Native Lumen device row, mirroring MyWallet's DeviceListItem (Wallet 4.0). */
function DeviceItem({
  name,
  firmware,
  modelId,
  onOpen,
}: {
  name: string;
  firmware?: string;
  modelId?: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const source =
    deviceSources[(modelId as DeviceModelIdEnum) ?? DeviceModelIdEnum.nanoX] ??
    deviceSources[DeviceModelIdEnum.nanoX];
  return (
    <ListItem onPress={onOpen} testID="flex-device-item">
      <ListItemLeading>
        <Image
          source={source}
          style={{ width: ITEM_IMAGE_SIZE, height: ITEM_IMAGE_SIZE }}
          resizeMode="contain"
        />
        <ListItemContent lx={{ gap: "s4" }}>
          <ListItemTitle>{name}</ListItemTitle>
          {firmware ? (
            <ListItemDescription>
              {t("manager.flexDevice.firmware")} {firmware}
            </ListItemDescription>
          ) : null}
        </ListItemContent>
      </ListItemLeading>
    </ListItem>
  );
}

type NavigationProps = BaseComposite<
  StackNavigatorProps<MyLedgerNavigatorStackParamList, ScreenName.MyLedgerChooseDevice>
>;

type Props = NavigationProps;

// Defines here some of the header options for this screen to be able to reset back to them.
export const headerOptions: ReactNavigationHeaderOptions = {
  headerShown: false,
};

type ChooseDeviceProps = Props & {
  isFocused: boolean;
};

const ChooseDevice: React.FC<ChooseDeviceProps> = ({ isFocused }) => {
  const { t } = useTranslation();
  const action = useManagerDeviceAction();
  const [device, setDevice] = useState<Device | null>();
  const [isHeaderOverridden, setIsHeaderOverridden] = useState<boolean>(false);
  const { shouldDisplayWallet40MainNav } = useWalletFeaturesConfig("mobile");

  const navigation = useNavigation<NavigationProps["navigation"]>();
  const { params } = useRoute<NavigationProps["route"]>();

  /**
   * FIXME:
   * This is here because for now the Recover upsell redirect to this screen (My Ledger)
   * via a deeplink, and after the Recover upsell, we are supposed to automatically redirect
   * to the post-onboarding hub.
   * When the Recover webpage is fixed to only redirect to the Portfolio screen, this can be removed.
   */
  useAutoRedirectToPostOnboarding();

  const onSelectDevice = (device?: Device) => {
    if (device)
      track("ManagerDeviceEntered", {
        modelId: device.modelId,
      });
    setDevice(device);
  };

  const onSelect = (result: Result) => {
    setDevice(undefined);

    if (result && "result" in result) {
      // FIXME: nullable stuff not taken into account here?
      // `result` overrides values from `params` (prop `device` for ex)
      // @ts-expect-error Result has nullable fields
      navigation.navigate(ScreenName.MyLedgerDevice, {
        ...params,
        ...result,
        searchQuery: params?.searchQuery || params?.installApp,
      });
    }
  };

  const onModalHide = () => {
    setDevice(undefined);
  };

  const onError = (error: Error) => {
    // Both the old (SelectDevice) and new (SelectDevice2) device selection components handle the bluetooth requirements with a hook + bottom drawer.
    // By setting back the device to `undefined` it gives back the responsibilities to those select components to check for the bluetooth requirements
    // and avoids a duplicated error drawers/messages.
    // The only drawback: the user has to select again their device once the bluetooth requirements are respected.
    if (error instanceof BluetoothRequired) {
      setDevice(undefined);
    }
  };

  useEffect(() => {
    setDevice(params?.device);
  }, [params?.device]);

  const requestToSetHeaderOptions = useCallback(
    (request: SetHeaderOptionsRequest) => {
      if (request.type === "set") {
        navigation.setOptions({
          headerShown: true,
          headerTitle: "",
          headerLeft: request.options.headerLeft,
          headerRight: request.options.headerRight,
          title: "",
        });
        setIsHeaderOverridden(true);
      } else {
        navigation.setOptions(
          shouldDisplayWallet40MainNav
            ? { ...wallet40HeaderOptions, headerRight: () => null }
            : { headerLeft: () => null, headerRight: () => null, ...headerOptions },
        );
        setIsHeaderOverridden(false);
      }
    },
    [navigation, shouldDisplayWallet40MainNav],
  );

  const Container = shouldDisplayWallet40MainNav ? SafeAreaView : TabBarSafeAreaView;
  const containerProps = useMemo(
    () => (shouldDisplayWallet40MainNav ? { isFlex: true, edges: ["left", "right"] as const } : {}),
    [shouldDisplayWallet40MainNav],
  );

  const flex = useSelector(flexSelector);
  // Rules of Hooks: hooks MUST run before any conditional return —
  // this component early-returns null when unfocused, so these were
  // moved above `if (!isFocused)` to avoid hook-order crashes.
  // Show the flex device as soon as a profile exists (even if balances are
  // still syncing) — key bound is enough for the device to be "added".
  const flexNav = useNav();
  const isFlexActive = !!flex?.key;

  if (!isFocused) return null;

  const showInlineTitle = !shouldDisplayWallet40MainNav && !isHeaderOverridden;

  return (
    <Container {...containerProps}>
      <TrackScreen category="Manager" name="ChooseDevice" />
      {showInlineTitle ? (
        <Text pt={3} px={16} pb={8} fontWeight="semiBold" variant="h4" testID="manager-title">
          {t("manager.title")}
        </Text>
      ) : null}
      {isFlexActive && flex.profile?.device && (
        <Flex mx={6} mt={4}>
          <DeviceItem
            name={flex.profile.device.name || "Ledger Nano X"}
            firmware={flex.profile.device.firmwareVersion}
            modelId={flex.profile.device.modelId}
            onOpen={() => flexNav.navigate(ScreenName.MyLedgerFlexDevice as never)}
          />
        </Flex>
      )}
      <Flex flex={1}>
        <SelectDevice2
          onSelect={onSelectDevice}
          stopBleScanning={!!device}
          requestToSetHeaderOptions={requestToSetHeaderOptions}
          withMyLedgerTracking
        >
          <ContentCardsLocation
            key="contentCardsLocationMyLedger"
            locationId={ContentCardLocation.MyLedger}
            mt={3}
          />
        </SelectDevice2>
      </Flex>
      <DeviceActionModal
        onClose={() => onSelectDevice()}
        device={device}
        onResult={onSelect}
        onModalHide={onModalHide}
        action={action}
        request={null}
        onError={onError}
        location={HOOKS_TRACKING_LOCATIONS.myLedgerDashboard}
      />
    </Container>
  );
};

export default function MyLedgerChooseDeviceScreen(props: Props) {
  const isFocused = useIsFocused();
  return <ChooseDevice {...props} isFocused={isFocused} />;
}
