import { useTrustchainSdk } from "./useTrustchainSdk";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import {
  trustchainSelector,
  resetTrustchainStore,
  memberCredentialsSelector,
} from "@ledgerhq/ledger-key-ring-protocol/store";
import { useMutation } from "@tanstack/react-query";
import { setFlow } from "~/renderer/actions/walletSync";
import { Flow, Step } from "~/renderer/reducers/walletSync";
import { QueryKey } from "./type.hooks";
import { useCloudSyncSDK } from "./useWatchWalletSync";
import { walletSyncUpdate } from "@ledgerhq/live-wallet/store";
import { track } from "~/renderer/analytics/segment";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";
import { clearLinkedPhone } from "~/renderer/mocks/flexWalletSync";

export function useDestroyTrustchain() {
  const dispatch = useDispatch();
  const sdk = useTrustchainSdk();
  const cloudSyncSDK = useCloudSyncSDK();
  const trustchain = useSelector(trustchainSelector);
  const memberCredentials = useSelector(memberCredentialsSelector);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // FLEX: no trustchain exists in the demo build — deleting the sync only
      // clears the flex-linked phone instance.
      if (isFlexBuild()) {
        clearLinkedPhone();
        return;
      }
      if (!trustchain || !memberCredentials) {
        return;
      }
      await cloudSyncSDK.destroy(trustchain, memberCredentials);
      await sdk.destroyTrustchain(trustchain, memberCredentials);
    },
    mutationKey: [QueryKey.destroyTrustchain, trustchain],
    onSuccess: () => {
      dispatch(setFlow({ flow: Flow.ManageBackup, step: Step.BackupDeleted }));
      if (!isFlexBuild()) dispatch(resetTrustchainStore());
      track("ledgersync_deactivated");
      if (!isFlexBuild()) dispatch(walletSyncUpdate(null, 0));
    },
    onError: () => dispatch(setFlow({ flow: Flow.ManageBackup, step: Step.BackupDeletionError })),
  });

  return { deleteMutation };
}
