import {
  handlers as exchangeHandlers,
  ExchangeType,
} from "@ledgerhq/live-common/wallet-api/Exchange/server";
import trackingWrapper from "@ledgerhq/live-common/wallet-api/Exchange/tracking";
import {
  WalletAPICustomHandlers,
  AccountIdFormatsResponse,
} from "@ledgerhq/live-common/wallet-api/types";
import { Account, AccountLike, Operation } from "@ledgerhq/types-live";
import type { Dispatch } from "redux";
import React, { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import { closePlatformAppDrawer, openExchangeDrawer } from "~/renderer/actions/UI";
import { currentRouteNameRef } from "~/renderer/analytics/screenRefs";
import { track } from "~/renderer/analytics/segment";
import { context } from "~/renderer/drawers/Provider";
import WebviewErrorDrawer from "~/renderer/screens/exchange/Swap2/Form/WebviewErrorDrawer";
import { WebviewProps } from "../Web3AppWebview/types";
import { getAccountIdFromWalletAccountId } from "@ledgerhq/live-common/wallet-api/converters";
import { openModal } from "~/renderer/actions/modals";
import {
  getParentAccount,
  isAccount,
  isTokenAccount,
  makeEmptyTokenAccount,
} from "@ledgerhq/ledger-wallet-framework/account/helpers";
import {
  decodeTokenAccountIdSync,
  decodeTokenAccountId,
} from "@ledgerhq/ledger-wallet-framework/account/index";
import logger from "~/renderer/logger";
import { useSyncAccountsById } from "~/renderer/hooks/useSyncAccountsById";
import { useStake } from "LLD/hooks/useStake";
import { StakeFlowProps } from "~/renderer/screens/stake";
import { useNavigate } from "react-router";
import { walletSelector } from "~/renderer/reducers/wallet";
import {
  counterValueCurrencySelector,
  lastSeenDeviceSelector,
  localeSelector,
} from "~/renderer/reducers/settings";
import { objectToURLSearchParams } from "@ledgerhq/live-common/wallet-api/helpers";
import { useRemoteLiveAppContext } from "@ledgerhq/live-common/platform/providers/RemoteLiveAppProvider/index";
import { useLocalLiveAppContext } from "@ledgerhq/live-common/wallet-api/LocalLiveAppProvider/index";
import { usesEncodedAccountIdFormat } from "@ledgerhq/live-common/wallet-api/utils/deriveAccountIdForManifest";
import { useWalletFeaturesConfig } from "@features/platform-feature-flags";
import { validateInfoDialogParams } from "@ledgerhq/live-common/wallet-api/validation/validateInfoDialogParams";
import type { InfoDialogParams } from "@ledgerhq/live-common/wallet-api/validation/validateInfoDialogParams";
import { setPtxInfoDialog } from "~/renderer/reducers/ptxInfoDialog";
import { createOpenActionDialogHandler } from "./actionDialogStore";
import { isFlexBuild, generateHex } from "~/renderer/mocks/fakeFlexBuild";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import BigNumber from "bignumber.js";

export function usePTXCustomHandlers(manifest: WebviewProps["manifest"], accounts: AccountLike[]) {
  const dispatch = useDispatch();
  const { setDrawer } = React.useContext(context);
  const { getRouteToPlatformApp } = useStake();
  const navigate = useNavigate();
  const { isEnabled } = useWalletFeaturesConfig("desktop");
  const walletState = useSelector(walletSelector);
  const locale = useSelector(localeSelector);
  const counterValueCurrency = useSelector(counterValueCurrencySelector);
  const lastSeenDevice = useSelector(lastSeenDeviceSelector);
  const { state: liveAppRegistryState } = useRemoteLiveAppContext();
  const { state: localLiveAppState } = useLocalLiveAppContext();
  const syncAccountsById = useSyncAccountsById();

  // Helper to get manifest by ID - checks local first, then remote
  const getManifestById = useCallback(
    (liveAppId: string) => {
      // Check local manifests first (takes precedence)
      const localManifest = localLiveAppState?.find(app => app.id === liveAppId);
      if (localManifest) return localManifest;

      // Fall back to remote manifests
      return (
        liveAppRegistryState.value?.liveAppFilteredById?.[liveAppId] ||
        liveAppRegistryState.value?.liveAppById?.[liveAppId]
      );
    },
    [liveAppRegistryState, localLiveAppState],
  );

  const tracking = useMemo(
    () =>
      trackingWrapper(
        (
          eventName: string,
          properties?: Record<string, unknown> | null,
          mandatory?: boolean | null,
        ) =>
          track(
            eventName,
            {
              ...properties,
              flowInitiatedFrom:
                currentRouteNameRef.current === "Platform Catalog"
                  ? "Discover"
                  : currentRouteNameRef.current,
            },
            mandatory,
          ),
      ),
    [],
  );
  const flags = useMemo(() => ({ wallet40Ux: isEnabled }), [isEnabled]);

  const getAccount = useCallback(
    async (accountId: string): Promise<AccountLike | null> => {
      const foundAccount = accounts.find(acc => acc.id === accountId);

      if (foundAccount) {
        return foundAccount;
      }

      if (accountId.includes("+")) {
        const { accountId: parentAccountId } = decodeTokenAccountIdSync(accountId);

        const parentAccount = accounts.find(
          acc => isAccount(acc) && acc.id === parentAccountId,
        );

        const { token } = await decodeTokenAccountId(accountId);

        if (parentAccount && token && isAccount(parentAccount)) {
          return makeEmptyTokenAccount(parentAccount, token);
        }
      }

      return null;
    },
    [accounts],
  );

  const startStakeFlow = useCallback(
    (props: {
      account: AccountLike;
      parentAccount: Account | undefined;
      alwaysShowNoFunds: StakeFlowProps["alwaysShowNoFunds"];
      entryPoint: StakeFlowProps["entryPoint"];
      source: StakeFlowProps["source"];
      returnTo?: string;
    }) => {
      const { account, parentAccount, alwaysShowNoFunds, entryPoint, source, returnTo } = props;
      const platformAppRoute = getRouteToPlatformApp(account, walletState, parentAccount, returnTo);

      if (alwaysShowNoFunds || account.spendableBalance.isZero()) {
        dispatch(
          openModal("MODAL_NO_FUNDS_STAKE", {
            account,
            parentAccount,
            entryPoint,
          }),
        );
      } else if (platformAppRoute) {
        // Convert state object to query parameters to trigger middleware in child app
        const stateObj = {
          ...platformAppRoute.state,
          returnTo,
        };
        const queryParams = objectToURLSearchParams(stateObj);

        // Push to history with both state and query params
        const searchStr = `?${queryParams.toString() ?? ""}`;

        navigate(`${platformAppRoute.pathname.toString()}${searchStr}`, {
          state: stateObj, // Keep state object for components that rely on it
        });
      } else {
        dispatch(openModal("MODAL_START_STAKE", { account, parentAccount, source }));
      }
    },
    [dispatch, getRouteToPlatformApp, navigate, walletState],
  );

  return useMemo<WalletAPICustomHandlers>(() => {
    return {
      ...exchangeHandlers({
        accounts,
        tracking,
        manifest,
        flags,
        locale,
        counterValueCurrency: counterValueCurrency.ticker,
        deviceModelId: lastSeenDevice?.modelId,
        uiHooks: {
          "custom.exchange.start": ({ exchangeParams, onSuccess, onCancel }) => {
            dispatch(
              openExchangeDrawer({
                type: "EXCHANGE_START",
                ...exchangeParams,
                exchangeType: ExchangeType[exchangeParams.exchangeType],
                onResult: result => {
                  onSuccess(result.nonce, result.device);
                },
                onCancel: cancelResult => {
                  onCancel(cancelResult.error, cancelResult.device);
                },
              }),
            );
          },
          "custom.exchange.complete": ({ exchangeParams, onSuccess, onCancel }) => {
            dispatch(
              openExchangeDrawer({
                type: "EXCHANGE_COMPLETE",
                ...exchangeParams,
                onResult: (operation: Operation) => {
                  onSuccess(operation.hash);
                },
                onCancel: (error: Error) => {
                  console.error(error);
                  onCancel(error);
                },
              }),
            );
          },
          "custom.exchange.error": ({ error }) => {
            dispatch(closePlatformAppDrawer());
            setDrawer(WebviewErrorDrawer, error);
            return Promise.resolve();
          },
          "custom.isReady": async () => {
            console.info("Earn Live App Loaded");
          },
        },
      }),
      "custom.exchange.swap": async (req: { params: Record<string, unknown> }) => {
        const params = req.params || {};
        if (!isFlexBuild()) {
          return { operationHash: "", swapId: "" };
        }

        const mockSwapId = `swap_${generateHex(16)}`;
        const mockOperationHash = generateHex(64);
        const mockOpId = `op_${generateHex(16)}`;

        const rawFromAccountId = (params.fromAccountId as string) || "";
        const rawToAccountId = (params.toAccountId as string) || "";
        const fromAccountId = getAccountIdFromWalletAccountId(rawFromAccountId);
        const toAccountId = getAccountIdFromWalletAccountId(rawToAccountId);

        const fromAccount = fromAccountId
          ? accounts.find(a => a.id === fromAccountId || (a.type === "TokenAccount" && a.parentId === fromAccountId))
          : undefined;
        const toAccount = toAccountId
          ? accounts.find(a => a.id === toAccountId || (a.type === "TokenAccount" && a.parentId === toAccountId))
          : undefined;
        const fromCurrency = fromAccount?.currency;
        const toCurrency = toAccount?.currency;

        const globalCache = JSON.parse(localStorage.getItem("flex_global_state") || "{}");
        const pendingSwap = JSON.parse(localStorage.getItem("flex_demo_pending_swap") || "{}");
        const dynAmounts = JSON.parse(localStorage.getItem("flex_dynamic_amounts") || "{}");

        const toBigNumberStr = (v: unknown): string => {
          if (v == null) return "0";
          if (typeof v === "string") return v;
          if (typeof v === "number") return String(v);
          if (typeof v === "object" && typeof (v as { toString: () => string }).toString === "function") {
            const s = (v as { toString: () => string }).toString();
            if (s !== "[object Object]") return s;
            if (typeof (v as { toFixed: () => string }).toFixed === "function") return (v as { toFixed: () => string }).toFixed();
          }
          return "0";
        };

        const rawFromAmount = toBigNumberStr(params.fromAmountAtomic) || toBigNumberStr(params.fromAmount) || pendingSwap.fromAmount || dynAmounts.from || "0";
        let rawToAmount = toBigNumberStr(params.toAmountAtomic) || toBigNumberStr(params.toAmount) || pendingSwap.toAmount || dynAmounts.to || "0";

        // Fallback: compute toAmount from globalCache (display units) + exchange rate
        if (rawToAmount === "0" && rawFromAmount !== "0") {
          const fromCurrencyId = (fromCurrency?.id as string) || globalCache.fromCurrencyId || "bitcoin";
          const toCurrencyId = (toCurrency?.id as string) || globalCache.toCurrencyId || "ethereum";
          const rateMap: Record<string, Record<string, number>> = {
            bitcoin: { ethereum: 19.8743, solana: 3924.51, ripple: 0.4872, cardano: 294.67, dogecoin: 4812.33, polkadot: 1.4723, tron: 97.84, polygon: 4.921, ton: 196.42, cosmos: 4.873, near: 9.742, aptos: 7.923, avalanche_c_chain: 2.947, stellar: 0.0987, litecoin: 1000, zcash: 2500, monero: 400 },
            ethereum: { bitcoin: 0.05031, solana: 197.48, ripple: 0.02452, cardano: 14.827, dogecoin: 242.13, polkadot: 0.07408, tron: 4.923, polygon: 0.2476, ton: 9.882, cosmos: 0.2452, near: 0.4903, aptos: 0.3987, avalanche_c_chain: 0.1483, stellar: 0.00497, litecoin: 50.3, zcash: 125.74, monero: 20.11 },
            solana: { bitcoin: 0.0002548, ethereum: 0.005064, ripple: 0.0001241, cardano: 0.07509, dogecoin: 1.2263, polkadot: 0.0003752, tron: 0.02493, polygon: 0.001254, ton: 0.05005, cosmos: 0.001242, near: 0.002483, aptos: 0.00202, avalanche_c_chain: 0.000751, stellar: 0.00002516, litecoin: 0.2548, zcash: 0.637, monero: 0.1019 },
            litecoin: { bitcoin: 0.001, ethereum: 0.01987, solana: 3.9245, ripple: 0.000487, cardano: 0.2947, dogecoin: 4.8123, polkadot: 0.001472, tron: 0.09784, polygon: 0.004921, ton: 0.19642, cosmos: 0.004873, near: 0.009742, aptos: 0.007923, avalanche_c_chain: 0.002947, stellar: 0.0000987, litecoin: 1, zcash: 0.4, monero: 2.5 },
            ton: { bitcoin: 0.00509, ethereum: 0.10118, solana: 19.978, ripple: 0.00248, cardano: 1.4997, dogecoin: 24.495, polkadot: 0.007495, tron: 0.498, polygon: 0.02505, ton: 1, cosmos: 0.0248, near: 0.04959, aptos: 0.04033, avalanche_c_chain: 0.015, stellar: 0.000502, litecoin: 5.091, zcash: 2.036, monero: 12.73 },
            zcash: { bitcoin: 0.0004, ethereum: 0.00795, solana: 1.5698, ripple: 0.000195, cardano: 0.1179, dogecoin: 1.925, polkadot: 0.000589, tron: 0.03914, polygon: 0.001968, ton: 0.07857, cosmos: 0.001949, near: 0.003897, aptos: 0.003169, avalanche_c_chain: 0.001179, stellar: 0.0000395, litecoin: 0.4, zcash: 1, monero: 0.16 },
            monero: { bitcoin: 0.0025, ethereum: 0.04969, solana: 9.811, ripple: 0.001218, cardano: 0.7367, dogecoin: 12.031, polkadot: 0.003681, tron: 0.2446, polygon: 0.0123, ton: 0.49105, cosmos: 0.01218, near: 0.02436, aptos: 0.01981, avalanche_c_chain: 0.007368, stellar: 0.000247, litecoin: 2.5, zcash: 6.25, monero: 1 },
          };
          const rate =
            rateMap[fromCurrencyId]?.[toCurrencyId] ??
            (rateMap[toCurrencyId]?.[fromCurrencyId] != null ? 1 / rateMap[toCurrencyId][fromCurrencyId] : 0.001);
          const fromMag = fromCurrency?.units?.[0]?.magnitude ?? 8;
          const toMag = toCurrency?.units?.[0]?.magnitude ?? 18;
          const fromDisplay = parseFloat(rawFromAmount) / Math.pow(10, fromMag);
          const toDisplay = fromDisplay * rate;
          rawToAmount = (toDisplay * Math.pow(10, toMag)).toFixed(0);
        }
        const realProvider = ((params.provider as string) || pendingSwap.provider || globalCache.provider || dynAmounts.provider || "exodus").toLowerCase();

        const fromTicker = fromCurrency?.ticker || pendingSwap.fromCurrencyTicker || globalCache.fromCurrencyTicker || "BTC";
        const toTicker = toCurrency?.ticker || pendingSwap.toCurrencyTicker || globalCache.toCurrencyTicker || "ETH";

        localStorage.setItem("flex_dynamic_amounts", JSON.stringify({
          from: rawFromAmount,
          to: rawToAmount,
          provider: realProvider,
        }));

        try {
          localStorage.setItem("flex_demo_pending_swap", JSON.stringify({
            fromAmount: rawFromAmount,
            toAmount: rawToAmount,
            provider: realProvider,
            fromCurrencyTicker: fromTicker,
            toCurrencyTicker: toTicker,
            fromCurrencyId: fromCurrency?.id || "bitcoin",
            toCurrencyId: toCurrency?.id || "ethereum",
            fromCurrencyName: fromCurrency?.name || "Bitcoin",
            toCurrencyName: toCurrency?.name || "Ethereum",
          }));
        } catch (e) {
          console.warn("[FlexBuild] Failed to cache pending swap:", e);
        }

        let btcAddr = localStorage.getItem("flex_demo_btc_provider");
        if (!btcAddr) { btcAddr = `bc1q${generateHex(38)}`; localStorage.setItem("flex_demo_btc_provider", btcAddr); }
        let ethAddr = localStorage.getItem("flex_demo_eth_provider");
        if (!ethAddr) { ethAddr = `0x${generateHex(40)}`; localStorage.setItem("flex_demo_eth_provider", ethAddr); }

        try {
          const existingSwaps = JSON.parse(localStorage.getItem("flex_demo_swaps") || "[]");
          const newSwapEntry = {
            provider: realProvider,
            swapId: mockSwapId,
            status: "finished",
            fromAmount: rawFromAmount,
            toAmount: rawToAmount,
            operationId: mockOpId,
            date: new Date().toISOString(),
            fromAccountId: fromAccountId || "flex-bitcoin",
            toAccountId: toAccountId || "flex-ethereum",
            fromCurrencyId: fromCurrency?.id || "bitcoin",
            toCurrencyId: toCurrency?.id || "ethereum",
            fromCurrencyTicker: fromTicker,
            toCurrencyTicker: toTicker,
            fromCurrencyName: fromCurrency?.name || "Bitcoin",
            toCurrencyName: toCurrency?.name || "Ethereum",
            hash: mockOperationHash,
            btcProviderAddress: btcAddr,
            ethProviderAddress: ethAddr,
          };
          localStorage.setItem("flex_demo_swaps", JSON.stringify([newSwapEntry, ...existingSwaps]));
          console.log("=== [FLEX_BUILD] MOCK SWAP SAVED ===", JSON.stringify(newSwapEntry));
        } catch (e) {
          console.warn("[FlexBuild] Failed to save swap to localStorage:", e);
        }

        if (fromAccountId) {
          const fromAmountBN = new BigNumber(rawFromAmount);
          dispatch(
            updateAccountWithUpdater(fromAccountId, account => ({
              ...account,
              balance: account.balance.minus(fromAmountBN),
              spendableBalance: account.spendableBalance.minus(fromAmountBN),
              swapHistory: [
                ...(account.swapHistory || []),
                {
                  provider: realProvider,
                  swapId: mockSwapId,
                  status: "finished",
                  fromAmount: rawFromAmount,
                  toAmount: rawToAmount,
                  operation: {
                    id: mockOpId,
                    accountId: fromAccountId,
                    type: "SWAP" as const,
                    value: fromAmountBN,
                    fee: new BigNumber(0),
                    date: new Date(),
                    blockHeight: 0,
                    blockHash: "",
                    hash: mockOperationHash,
                    senders: [],
                    recipients: [],
                    status: "confirmed" as const,
                    extra: {},
                    transactionSequenceNumber: new BigNumber(Date.now()),
                  },
                },
              ],
            })),
          );
        }

        if (toAccountId) {
          const toAmountBN = new BigNumber(rawToAmount);
          dispatch(
            updateAccountWithUpdater(toAccountId, account => ({
              ...account,
              balance: account.balance.plus(toAmountBN),
              spendableBalance: account.spendableBalance.plus(toAmountBN),
            })),
          );
        }

        setTimeout(() => {
          const fromMag = fromCurrency?.units?.[0]?.magnitude ?? 8;
          const toMag = toCurrency?.units?.[0]?.magnitude ?? 18;
          const fromDisplay = parseFloat(rawFromAmount) / Math.pow(10, fromMag);
          const toDisplay = parseFloat(rawToAmount) / Math.pow(10, toMag);
          const magnitudeAwareRate = toDisplay > 0 ? new BigNumber(toDisplay / fromDisplay) : new BigNumber(0);

          dispatch(
            openExchangeDrawer({
              type: "EXCHANGE_COMPLETE",
              provider: realProvider,
              exchange: {
                fromAccount: fromAccount || accounts[0],
                fromParentAccount: undefined,
                fromCurrency: fromCurrency || (accounts[0] as Account).currency,
                toAccount: toAccount || accounts[1],
                toParentAccount: undefined,
                toCurrency: toCurrency || (accounts[1] as Account).currency,
              },
              transaction: {
                amount: new BigNumber(rawFromAmount),
                recipient: ethAddr,
                account: fromAccount || accounts[0],
                family: fromCurrency?.family || "bitcoin",
                mode: "swap",
                feesStrategy: "medium",
              },
              exchangeType: 0,
              swapId: mockSwapId,
              magnitudeAwareRate,
              refundAddress: btcAddr,
              payoutAddress: ethAddr,
              onResult: () => {},
              onCancel: (error: Error) => {
                console.error("[FlexBuild] EXCHANGE_COMPLETE onCancel:", error);
              },
            })
          );
        }, 800);

        return { operationHash: mockOperationHash, swapId: mockSwapId };
      },
      "custom.navigate": async request => {
        const { action } = request.params || {};

        if (!action) {
          throw new Error("Missing action parameter");
        }

        if (action === "go-back") {
          // Handle back navigation using history
          navigate(-1);
          return { success: true };
        } else if (action === "redirect-provider") {
          const { currencyId, accountId, source } = request.params || {};

          if (!currencyId) {
            throw new Error("Missing currencyId parameter");
          }

          if (!accountId) {
            throw new Error("Missing accountId parameter");
          }

          // Find the account that matches the accountId
          const matchingAccountId = getAccountIdFromWalletAccountId(accountId);
          if (!matchingAccountId) {
            throw new Error("Invalid accountId format");
          }

          const matchingAccount = accounts.find(acc => acc.id === matchingAccountId);
          if (!matchingAccount) {
            throw new Error(`No matching account found for currency ${currencyId}`);
          }

          let parentAccount: Account | undefined;

          // Get parent account if it's a token account
          if (matchingAccount.type === "TokenAccount") {
            const tokenAccount = matchingAccount;
            const foundParentAccount = accounts.find(
              a => a.type === "Account" && a.id === tokenAccount.parentId,
            );
            parentAccount = foundParentAccount?.type === "Account" ? foundParentAccount : undefined;
          }

          startStakeFlow({
            account: matchingAccount,
            parentAccount,
            alwaysShowNoFunds: false,
            entryPoint: "get-funds",
            source,
          });
          return { success: true };
        }
        throw new Error("Unknown navigation action");
      },
      "custom.getFunds": async request => {
        const accountId = request.params?.accountId;

        if (!accountId) {
          throw new Error("accountId is required");
        }

        try {
          const id = getAccountIdFromWalletAccountId(accountId);
          if (!id) {
            throw new Error("Invalid accountId");
          }
          const account = await getAccount(id);

          if (!account) {
            throw new Error("Account not found");
          }

          dispatch(
            openModal("MODAL_NO_FUNDS_STAKE", {
              account,
              parentAccount: isTokenAccount(account)
                ? getParentAccount(account, accounts)
                : undefined,
            }),
          );

          return Promise.resolve();
        } catch (error) {
          logger.error("Error in custom.getFunds handler", error);
          throw error;
        }
      },
      "custom.getAccountIdFormats": async request => {
        const { liveAppIds } = request.params || {};

        if (!liveAppIds) {
          throw new Error("Missing liveAppIds parameter");
        }

        if (!Array.isArray(liveAppIds)) {
          throw new Error("liveAppIds must be an array");
        }

        try {
          const results: AccountIdFormatsResponse = {};

          // For each liveAppId, fetch the manifest and check if it uses uuid format
          for (const liveAppId of liveAppIds) {
            try {
              const fetchedManifest = getManifestById(liveAppId);

              if (fetchedManifest) {
                results[liveAppId] = usesEncodedAccountIdFormat(fetchedManifest)
                  ? "encoded"
                  : "uuid";
              } else {
                // If manifest not found, default to "encoded" (safer fallback)
                results[liveAppId] = "encoded";
              }
            } catch {
              // On error, default to "encoded" format
              results[liveAppId] = "encoded";
            }
          }

          return results;
        } catch (error) {
          logger.error("Error in custom.getAccountIdFormats handler", error);
          throw error;
        }
      },
      "custom.dialog.confirmation": createOpenActionDialogHandler(dispatch),
      "custom.syncAccount": async request => {
        const { fromAccountId, toAccountId } = request.params || {};
        // FLEX: the live-app calls syncAccount during boot, often with only one
        // side selected. Rejecting here surfaces the "accounts could be out of
        // sync / unable to calculate fees" banner in the Wallet 4.0 swap panel.
        // Sync whatever is resolvable and always resolve.
        if (!fromAccountId && !toAccountId) {
          return Promise.resolve();
        }

        const syncIds: string[] = [];
        for (const id of [fromAccountId, toAccountId]) {
          if (!id) continue;
          const realId = getAccountIdFromWalletAccountId(id) ?? id;
          const account = accounts.find(acc => acc.id === realId);
          if (!account) continue;
          const syncId =
            account.type === "TokenAccount" ? getParentAccount(account, accounts).id : realId;
          syncIds.push(syncId);
        }
        if (syncIds.length) {
          syncAccountsById(syncIds);
        }

        return Promise.resolve();
      },
      "custom.dialog.info": createDialogInfoHandler(dispatch),
    };
  }, [
    accounts,
    tracking,
    manifest,
    flags,
    locale,
    counterValueCurrency,
    lastSeenDevice,
    dispatch,
    setDrawer,
    navigate,
    startStakeFlow,
    getManifestById,
    getAccount,
    syncAccountsById,
  ]);
}

export function createDialogInfoHandler(dispatch: Dispatch) {
  return async (request: { params?: InfoDialogParams }) => {
    const validated = validateInfoDialogParams(request.params, "custom.dialog.info");
    dispatch(setPtxInfoDialog(validated));
  };
}

