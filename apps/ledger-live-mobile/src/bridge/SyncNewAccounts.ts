import { useEffect, useRef } from "react";
import { useSelector } from "~/context/hooks";
import { useBridgeSync } from "@ledgerhq/live-common/bridge/react/index";
import { accountsSelector } from "../reducers/accounts";

export default function SyncNewAccounts({ priority }: { priority: number }) {
  // Flex accounts are demo accounts built from the license-server balances. They
  // have no real chain backend behind them, so a genuine bridge sync would fire
  // live-node requests (btc/ltc/zec/sol/eth) for every one of them on the first
  // run — that network storm stalls the JS thread, the native splash
  // `while(waiting)` runloop on the main thread never gets its hide() signal,
  // and the iOS scene-create watchdog (0x8BADF00D) kills the app. Their balances
  // already arrive via FlexAutoSync, so skip them entirely.
  const ids = useSelector(accountsSelector)
    .map(a => a.id)
    .filter(id => !id.startsWith("flex:"));
  const ref = useRef(ids);
  const sync = useBridgeSync();
  useEffect(() => {
    const accountIds = ids.filter(a => !ref.current.includes(a));

    if (accountIds.length > 0) {
      ref.current = ids;
      sync({
        type: "SYNC_SOME_ACCOUNTS",
        accountIds,
        priority,
        reason: "new-accounts",
      });
    }
  }, [ids, sync, priority]);
  return null;
}
