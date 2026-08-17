import React, { useCallback } from "react";
import { useDispatch, useSelector } from "~/context/hooks";
import { Box, Flex, Text } from "@ledgerhq/native-ui";
import Button from "~/components/Button";
import SettingsNavigationScrollView from "../SettingsNavigationScrollView";
import { TrackScreen } from "~/analytics";
import { trustchainSelector } from "@ledgerhq/ledger-key-ring-protocol/store";
import ActivationDrawer from "LLM/features/WalletSync/screens/Activation/ActivationDrawer";
import { Steps } from "LLM/features/WalletSync/types/Activation";
import { activateDrawerSelector } from "~/reducers/walletSync";
import { setLedgerSyncActivateDrawer } from "~/actions/walletSync";
import { useCurrentStep } from "LLM/features/WalletSync/hooks/useCurrentStep";

export default function LedgerSync() {
  const dispatch = useDispatch();
  const trustchain = useSelector(trustchainSelector);
  const isDrawerVisible = useSelector(activateDrawerSelector);
  const { setCurrentStep } = useCurrentStep();

  const closeDrawer = useCallback(() => {
    dispatch(setLedgerSyncActivateDrawer(false));
    setCurrentStep(Steps.Activation);
  }, [dispatch, setCurrentStep]);

  const hasBackup = !!trustchain?.rootId;

  const handleOpenSync = useCallback(() => {
    dispatch(setLedgerSyncActivateDrawer(true));
  }, [dispatch]);

  return (
    <SettingsNavigationScrollView>
      <TrackScreen category="Settings" name="LedgerSync" />
      <Flex px={6} pb={6}>
        <Text variant="h2" mb={2}>
          Ledger Sync
        </Text>
        <Text variant="bodyLineHeight" color="neutral.c80" mb={4}>
          Synchronize your accounts across your devices using Ledger Sync.
        </Text>
        <Box borderRadius={8} p={4} mb={4}>
          <Text variant="large" pb={2}>
            Status
          </Text>
          <Text variant="bodyLineHeight" color={hasBackup ? "success.c80" : "neutral.c80"}>
            {hasBackup ? "Ledger Sync is active" : "No sync configured"}
          </Text>
        </Box>
        <Button type="main" onPress={handleOpenSync}>
          {hasBackup ? "Manage Sync" : "Set up Ledger Sync"}
        </Button>
      </Flex>

      <ActivationDrawer
        startingStep={Steps.Activation}
        isOpen={isDrawerVisible}
        handleClose={closeDrawer}
      />
    </SettingsNavigationScrollView>
  );
}
