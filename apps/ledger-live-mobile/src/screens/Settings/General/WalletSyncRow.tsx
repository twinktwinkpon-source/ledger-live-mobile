import React, { useCallback } from "react";
import SettingsRow from "~/components/SettingsRow";
import { useTranslation } from "~/context/Locale";
import { useNavigation } from "@react-navigation/native";
import { setOriginFlow } from "~/analytics/originFlow";
import { HOOKS_TRACKING_LOCATIONS } from "~/analytics/hooks/variables";
import { NavigatorName, ScreenName } from "~/const";
import {
  useLedgerSyncAnalytics,
  AnalyticsPage,
  AnalyticsButton,
} from "LLM/features/WalletSync/hooks/useLedgerSyncAnalytics";
import { useSelector, useDispatch } from "~/context/hooks";
import { trustchainSelector } from "@ledgerhq/ledger-key-ring-protocol/store";
import ActivationDrawer from "LLM/features/WalletSync/screens/Activation/ActivationDrawer";
import { Steps } from "LLM/features/WalletSync/types/Activation";
import { activateDrawerSelector } from "~/reducers/walletSync";
import { setLedgerSyncActivateDrawer } from "~/actions/walletSync";
import { useCurrentStep } from "LLM/features/WalletSync/hooks/useCurrentStep";
import { useFeature } from "@features/platform-feature-flags";
import { flexSelector } from "~/reducers/flex";

const WalletSyncRow = () => {
  const { t } = useTranslation();
  const { onClickTrack } = useLedgerSyncAnalytics();
  const navigation = useNavigation();

  const isDrawerVisible = useSelector(activateDrawerSelector);
  const dispatch = useDispatch();
  const { setCurrentStep } = useCurrentStep();

  // FLEX mode: Ledger Sync is provisioned via the flex key (no trustchain).
  // Treat it as already-on and route to the native flex Ledger Sync status screen.
  const flex = useSelector(flexSelector);

  const closeDrawer = useCallback(() => {
    dispatch(setLedgerSyncActivateDrawer(false));
    setCurrentStep(Steps.Activation);
  }, [dispatch, setCurrentStep]);
  const trustchain = useSelector(trustchainSelector);
  const ledgerSyncOptimisationFlag = useFeature("lwmLedgerSyncOptimisation");
  const navigateToWalletSyncActivationScreen = useCallback(() => {
    // Here we need to check if the user has a backup or not to determine the screen to navigate to
    onClickTrack({ button: AnalyticsButton.LedgerSync, page: AnalyticsPage.SettingsGeneral });
    setOriginFlow(HOOKS_TRACKING_LOCATIONS.ledgerSyncFlow);

    // FLEX mode: sync is already active via the flex key — show the flex status screen
    if (flex.key && flex.status === "active") {
      navigation.navigate(NavigatorName.Settings, {
        screen: ScreenName.LedgerSync,
      });
      return;
    }

    if (trustchain?.rootId) {
      navigation.navigate(NavigatorName.WalletSync, {
        screen: ScreenName.WalletSyncActivated,
      });
    } else {
      dispatch(setLedgerSyncActivateDrawer(true));
    }
  }, [navigation, onClickTrack, trustchain?.rootId, dispatch, flex.key, flex.status]);

  return (
    <>
      <SettingsRow
        event="WalletSyncSettingsRow"
        title={t("settings.display.walletSync")}
        desc={
          ledgerSyncOptimisationFlag?.enabled
            ? t("settings.display.walletSyncDescription")
            : t("settings.display.walletSyncDesc")
        }
        arrowRight
        onPress={navigateToWalletSyncActivationScreen}
        testID="wallet-sync-button"
      />

      <ActivationDrawer
        startingStep={Steps.Activation}
        isOpen={isDrawerVisible}
        handleClose={closeDrawer}
      />
    </>
  );
};

export default WalletSyncRow;
