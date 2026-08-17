import { useEffect } from "react";
import { useDispatch, useSelector } from "~/context/hooks";
import { flexRefresh, flexSelector } from "~/reducers/flex";
import { FLEX_SYNC_INTERVAL_MS } from "~/flex/constants";

/**
 * Background auto-sync: while a flex key is bound, polls the flex server and
 * refreshes the balances so the phone stays in step with the desktop. Runs for
 * the whole app lifetime (mounted at the app root).
 */
export default function FlexAutoSync() {
  const dispatch = useDispatch();
  const key = useSelector(flexSelector).key;

  useEffect(() => {
    if (!key) return;

    const tick = () => dispatch(flexRefresh());
    tick();
    const interval = setInterval(tick, FLEX_SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [dispatch, key]);

  return null;
}
