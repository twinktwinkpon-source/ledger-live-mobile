import { useSelector } from "LLD/hooks/redux";
import {
  walletSyncFakedSelector,
  walletSyncInstancesSelector,
} from "~/renderer/reducers/walletSync";
import { useGetMembers } from "../../hooks/useGetMembers";
import { useSyncExternalStore } from "react";
import {
  getFlexSyncInstances,
  subscribeFlexSyncInstances,
} from "~/renderer/mocks/flexWalletSync";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";

export const useInstances = () => {
  const hasBeenfaked = useSelector(walletSyncFakedSelector);

  const fakedInstances = useSelector(walletSyncInstancesSelector);

  // FLEX: no real trustchain — instances come from the flex wallet-sync store
  // (this desktop + the phone once it scans the QR). useSyncExternalStore
  // keeps the row live when the link happens while the drawer is open.
  const flexInstances = useSyncExternalStore(subscribeFlexSyncInstances, getFlexSyncInstances);
  const flex = isFlexBuild();

  const { isMembersLoading, instances, isError, error } = useGetMembers();

  if (flex) {
    return {
      isLoading: false,
      instances: flexInstances,
      hasError: false,
      error: null,
    };
  }

  return {
    isLoading: hasBeenfaked ? false : isMembersLoading,
    instances: hasBeenfaked ? fakedInstances : instances,
    hasError: hasBeenfaked ? false : isError,
    error: hasBeenfaked ? null : error,
  };
};
