import React, { useCallback } from "react";
import { BridgeSync } from "@ledgerhq/live-common/bridge/react/index";
import { useSelector, useDispatch } from "LLD/hooks/redux";
import logger from "~/renderer/logger";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import { accountsSelector } from "~/renderer/reducers/accounts";
import { recentlyChangedExperimental } from "~/renderer/experimental";
import { track } from "~/renderer/analytics/segment";
import { prepareCurrency, hydrateCurrency } from "./cache";
import { blacklistedTokenIdsSelector } from "~/renderer/reducers/settings";
import { Account } from "@ledgerhq/types-live";
import { isFlexBuild, isFlexAccount } from "~/renderer/mocks/fakeFlexBuild";

/**
 * BridgeSync is the main sync engine that runs heavy network-like operations
 * on every navigation, causing 5+ second lag. In MOCK/FLEX mode, accounts are
 * static mock data that never need syncing. Skip BridgeSync entirely.
 */
const isFlexDemo =
  typeof process !== "undefined" && process.env.FLEX_DEMO === "true";

export const BridgeSyncProvider = ({ children }: { children: React.ReactNode }) => {
  // Always skip BridgeSync when running in mock/flex demo mode.
  // This eliminates the 5-second navigation lag caused by the bridge
  // trying to sync all accounts through the mock bridge.
  // FLEX production builds (no FLEX_DEMO env) must skip too — the previous
  // check only looked at "mock-"/"flex-" id prefixes, which never match the
  // real synthetic ids (js:1:<currency>:0000…:), so the real bridge tried to
  // sync fake accounts and threw AccountNeedResync.
  if (isFlexDemo || isFlexBuild()) return <>{children}</>;
  const accounts = useSelector(accountsSelector);
  const hasMockAccounts = accounts.length > 0 && accounts.some(isFlexAccount);
  if (hasMockAccounts) return <>{children}</>;

  const blacklistedTokenIds = useSelector(blacklistedTokenIdsSelector);
  const dispatch = useDispatch();
  const updateAccount = useCallback(
    (accountId: string, updater: (a: Account) => Account) =>
      dispatch(updateAccountWithUpdater(accountId, updater)),
    [dispatch],
  );
  const recoverError = useCallback((error: Error) => {
    if (recentlyChangedExperimental()) {
      return;
    }
    logger.critical(error);
    return error;
  }, []);
  return (
    <BridgeSync
      accounts={accounts}
      updateAccountWithUpdater={updateAccount}
      recoverError={recoverError}
      trackAnalytics={track}
      prepareCurrency={prepareCurrency}
      hydrateCurrency={hydrateCurrency}
      blacklistedTokenIds={blacklistedTokenIds}
    >
      {children}
    </BridgeSync>
  );
};