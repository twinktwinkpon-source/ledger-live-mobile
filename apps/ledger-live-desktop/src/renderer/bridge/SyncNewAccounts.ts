import { useEffect, useRef } from "react";
import { useSelector } from "LLD/hooks/redux";
import { useBridgeSync } from "@ledgerhq/live-common/bridge/react/index";
import { accountsSelector } from "../reducers/accounts";

const isFlexDemo =
  typeof process !== "undefined" && process.env.FLEX_DEMO === "true";

export const SyncNewAccounts = ({ priority }: { priority: number }) => {
  // In FLEX_DEMO mode, accounts are static mock data that never need syncing.
  if (isFlexDemo) return null;
  const ids = useSelector(accountsSelector).map(a => a.id);
  const ref = useRef(ids);
  const sync = useBridgeSync();

  // Skip sync entirely when accounts are mock data (IDs start with "mock-" or "flex-").
  // Mock accounts are static and never need syncing.
  if (ids.length > 0 && (ids[0]?.startsWith?.("mock-") || ids[0]?.startsWith?.("flex-"))) return null;

  useEffect(() => {
    const accountIds = ids.filter(a => !ref.current.includes(a));
    if (accountIds.length > 0) {
      ref.current = ids;
      sync({
        type: "SYNC_SOME_ACCOUNTS",
        accountIds,
        priority,
        reason: "sync-new-accounts",
      });
    }
  }, [ids, sync, priority]);
  return null;
};