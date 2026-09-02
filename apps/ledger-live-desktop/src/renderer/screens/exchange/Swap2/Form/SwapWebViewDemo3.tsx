import { SwapLiveError } from "@ledgerhq/live-common/exchange/swap/types";
import { LiveAppManifest } from "@ledgerhq/live-common/platform/types";

import { handlers as loggerHandlers } from "@ledgerhq/live-common/wallet-api/CustomLogger/server";
import { getEnv } from "@ledgerhq/live-env";

import { getNodeApi } from "@ledgerhq/coin-evm/network/node/index";
import { getMainAccount, getParentAccount } from "@ledgerhq/live-common/account/helpers";
import { getAccountBridge } from "@ledgerhq/live-common/bridge/impl";
import { getAbandonSeedAddress } from "@ledgerhq/live-common/exchange/swap/hooks/useFromState";
import {
  convertToAtomicUnit,
  convertToNonAtomicUnit,
  getCustomFeesPerFamily,
} from "@ledgerhq/live-common/exchange/swap/webApp/utils";
import {
  accountToWalletAPIAccount,
  getAccountIdFromWalletAccountId,
} from "@ledgerhq/live-common/wallet-api/converters";
import { Account, AccountLike, TokenAccount, SwapOperation } from "@ledgerhq/types-live";
import BigNumber from "bignumber.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import { useLocation, useNavigate } from "react-router";
import styled from "styled-components";
import { reduce, firstValueFrom } from "rxjs";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import { track } from "~/renderer/analytics/segment";
import { Web3AppWebview } from "~/renderer/components/Web3AppWebview";
import { initialWebviewState } from "~/renderer/components/Web3AppWebview/helpers";
import {
  WebviewAPI,
  WebviewProps,
  WebviewState,
  WebviewLoader,
} from "~/renderer/components/Web3AppWebview/types";
import { TopBar } from "~/renderer/components/WebPlatformPlayer/TopBar";
import { usePTXCustomHandlers } from "~/renderer/components/WebPTXPlayer/CustomHandlers";
import { context } from "~/renderer/drawers/Provider";
import { NetworkStatus, useNetworkStatus } from "~/renderer/hooks/useNetworkStatus";
import useTheme from "~/renderer/hooks/useTheme";
import logger from "~/renderer/logger";
import { flattenAccountsSelector } from "~/renderer/reducers/accounts";
import {
  counterValueCurrencySelector,
  developerModeSelector,
  enablePlatformDevToolsSelector,
  hasSeenAnalyticsOptInPromptSelector,
  languageSelector,
  lastSeenDeviceSelector,
  shareAnalyticsSelector,
} from "~/renderer/reducers/settings";
import { walletSelector } from "~/renderer/reducers/wallet";
import {
  transformToBigNumbers,
  useGetSwapTrackingProperties,
  useRedirectToSwapHistory,
} from "../utils/index";
import FeesDrawerLiveApp from "./FeesDrawerLiveApp";
import { useSwapDefaultAccounts } from "./useSwapDefaultAccounts";
import WebviewErrorDrawer from "./WebviewErrorDrawer/index";
import { currentRouteNameRef } from "~/renderer/analytics/screenRefs";
import { useFeature, useWalletFeaturesConfig } from "@ledgerhq/live-common/featureFlags/index";
import { useDeeplinkCustomHandlers } from "~/renderer/components/WebPlatformPlayer/CustomHandlers";
import { SwapLoader } from "./SwapLoader";
import { useDiscreetMode } from "~/renderer/components/Discreet";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";

export class UnableToLoadSwapLiveError extends Error {
  constructor(message: string) {
    const name = "UnableToLoadSwapLiveError";
    super(message || name);
    this.name = name;
    this.message = message;
  }
}

export type SwapProps = {
  provider: string;
  fromAccountId: string;
  fromParentAccountId?: string;
  toAccountId: string;
  fromAmount: string;
  toAmount?: string;
  finalAmount?: string;
  quoteId: string;
  rate: string;
  feeStrategy: string;
  customFeeConfig: string;
  cacheKey: string;
  loading: boolean;
  error: boolean;
  providerRedirectURL: string;
  toNewTokenId: string;
  swapApiBase: string;
  estimatedFees: string;
  estimatedFeesUnit: string;
  swapId?: string;
  status?: string;
};

export type SwapWebProps = {
  manifest: LiveAppManifest;
  isEmbedded?: boolean;
  Loader?: WebviewLoader;
};

type TokenParams = {
  fromTokenId?: string;
  toTokenId?: string;
};

type SwapLocationState = {
  defaultAccount?: AccountLike;
  defaultParentAccount?: Account;
  defaultAccountId?: string | { fromAccountId?: string; toAccountId?: string };
  defaultParentAccountId?: string;
  defaultCurrency?: { id?: string; fromCurrencyId?: string; toCurrencyId?: string };
  defaultAmountFrom?: string;
  from?: string;
  defaultToken?: TokenParams;
  affiliate?: string;
};

const isSwapLocationState = (value: unknown): value is SwapLocationState =>
  typeof value === "object" && value !== null;

const SwapWebAppWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
`;

// remove the account id from the from path
function simplifyFromPath(path: string): string {
  return path.replace(/^\/account.*/, "/account/{id}");
}

const SWAP_API_BASE = getEnv("SWAP_API_BASE");
const SWAP_USER_IP = getEnv("SWAP_USER_IP");
const getSegWitAbandonSeedAddress = (): string => "bc1qed3mqr92zvq2s782aqkyx785u23723w02qfrgs";

const SwapWebView = ({ manifest, isEmbedded = false, Loader = SwapLoader }: SwapWebProps) => {
  const { theme } = useTheme();
  const walletState = useSelector(walletSelector);
  const dispatch = useDispatch();
  const redirectToHistory = useRedirectToSwapHistory();
  const webviewAPIRef = useRef<WebviewAPI>(null);
  const { setDrawer } = React.useContext(context);
  const [webviewState, setWebviewState] = useState<WebviewState>(initialWebviewState);
  const fiatCurrency = useSelector(counterValueCurrencySelector);
  const locale = useSelector(languageSelector);
  const lastSeenDevice = useSelector(lastSeenDeviceSelector);

  const shareAnalytics = useSelector(shareAnalyticsSelector);
  const hasSeenAnalyticsOptInPrompt = useSelector(hasSeenAnalyticsOptInPromptSelector).toString();

  const currentVersion = __APP_VERSION__;
  const enablePlatformDevTools = useSelector(enablePlatformDevToolsSelector);
  const devMode = useSelector(developerModeSelector);
  const discreetMode = useDiscreetMode();
  const accounts = useSelector(flattenAccountsSelector);
  const { t } = useTranslation();
  const swapDefaultTrack = useGetSwapTrackingProperties();
  const location = useLocation();
  const navigate = useNavigate();
  const state = isSwapLocationState(location.state) ? location.state : null;

  const {
    rawFromAccountId,
    rawToAccountId,
    resolvedDefaultFromAccount,
    resolvedDefaultFromParentAccount,
    resolvedDefaultToAccount,
    resolvedDefaultToParentAccount,
  } = useSwapDefaultAccounts(state);
  const { networkStatus } = useNetworkStatus();
  const isOffline = networkStatus === NetworkStatus.OFFLINE;
  // Remove after KYC AB Testing
  const ptxSwapLiveAppKycWarning = useFeature("ptxSwapLiveAppKycWarning")?.enabled;
  const ptxSwapLiveAppOnPortfolio = useFeature("ptxSwapLiveAppOnPortfolio")?.enabled;
  const lldModularDrawerFF = useFeature("lldModularDrawer");
  const isLldModularDrawer = lldModularDrawerFF?.enabled && lldModularDrawerFF?.params?.live_app;
  const { isEnabled: isLwd40Enabled } = useWalletFeaturesConfig("desktop");
  const customPTXHandlers = usePTXCustomHandlers(manifest, accounts);
  const customDeeplinkHandlers = useDeeplinkCustomHandlers();

  // FLEX_DEMO: Global Native Sniffer — cache the native swap state to localStorage
  // This captures the REAL user input (amounts, provider) BEFORE the webview opens
  useEffect(() => {
    if (!isFlexBuild()) return;
    try {
      const fromCurrency = state?.defaultCurrency?.fromCurrencyId || state?.defaultCurrency?.id;
      const toCurrency = state?.defaultCurrency?.toCurrencyId || state?.defaultCurrency?.id;
      const fromAmount = state?.defaultAmountFrom || "0";
      const toAmount = state?.defaultAmountTo || "0";

      // Determine tickers from the resolved accounts
      const fromTicker = resolvedDefaultFromAccount?.currency?.ticker || "BTC";
      const toTicker = resolvedDefaultToAccount?.currency?.ticker || "ETH";

      // Cache the native state for the IPC listener to read
      window.localStorage.setItem("flex_global_state", JSON.stringify({
        provider: "exodus",
        fromAmount: fromAmount,
        toAmount: toAmount || "0",
        fromCurrencyTicker: fromTicker,
        toCurrencyId: toCurrency,
        fromCurrencyId: fromCurrency,
      }));
    } catch (e) {
      console.warn("[FlexBuild] Failed to cache native swap state:", e);
    }
  }, [
	state,
	resolvedDefaultFromAccount,
	resolvedDefaultToAccount
]);
  const customHandlers = useMemo(
    () => ({
      ...loggerHandlers,
      ...customPTXHandlers,
      ...customDeeplinkHandlers,
      "custom.getFee": async ({
        params,
      }: {
        params: {
          fromAccountId: string;
          fromAmount: string;
          feeStrategy: string;
          openDrawer: boolean;
          customFeeConfig: object;
          SWAP_VERSION: string;
          gasLimit?: string;
          data?: string;
          recipient?: string;
        };
      }): Promise<{
        feesStrategy: string;
        estimatedFees: BigNumber | undefined;
        errors: object;
        warnings: object;
        customFeeConfig: object;
        gasLimit?: string;
        hasDrawer: boolean;
      }> => {
        const realFromAccountId = getAccountIdFromWalletAccountId(params.fromAccountId);
        if (!realFromAccountId) {
          return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
        }

        const fromAccount = accounts.find(acc => acc.id === realFromAccountId);
        if (!fromAccount) {
          return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
        }
        const fromParentAccount = getParentAccount(fromAccount, accounts);

        let mainAccount = getMainAccount(fromAccount, fromParentAccount);

        // FLEX: fake accounts have no real chain backing. The real bridge can throw or
        // return error statuses (fee estimation fails -> "unable to calculate fees" in
        // the Swap live-app). Return deterministic synthetic fees and keep the native
        // drawer/animations flow untouched.
        if (isFlexBuild()) {
          const family = (mainAccount.currency.family || "").toLowerCase();
          const feeByFamily: Record<string, string> = {
            bitcoin: "0.00012",
            evm: "0.00021",
            solana: "0.000005",
            tron: "1.1",
            ton: "0.0055",
          };
          const feeAmount = feeByFamily[family] ?? "0.0001";
          const feeAtomic = new BigNumber(feeAmount).shiftedBy(mainAccount.units[0].magnitude || 8);
          return {
            feesStrategy: params.feeStrategy || "medium",
            estimatedFees: convertToNonAtomicUnit({
              amount: feeAtomic,
              account: mainAccount,
            }),
            errors: {},
            warnings: {},
            customFeeConfig: params.customFeeConfig || {},
            gasLimit: "21000",
            hasDrawer: false,
          };
        }

        const bridge = await getAccountBridge(fromAccount, fromParentAccount);

        const subAccountId = fromAccount.type !== "Account" && fromAccount.id;

        // NOTE: we might sync all types of accounts here
        if (mainAccount.currency.id === "bitcoin") {
          try {
            const syncedAccount = await firstValueFrom(
              bridge
                .sync(mainAccount, { paginationConfig: {} })
                .pipe(reduce((a, f: (arg0: Account) => Account) => f(a), mainAccount)),
            );
            if (syncedAccount) {
              mainAccount = syncedAccount;
            }
          } catch (e) {
            logger.error(e);
          }
        }

        const transaction = bridge.createTransaction(mainAccount);

        const preparedTransaction = await bridge.prepareTransaction(mainAccount, {
          ...transaction,
          subAccountId,
          recipient:
            params.recipient ||
            (mainAccount.currency.id === "bitcoin"
              ? getSegWitAbandonSeedAddress()
              : getAbandonSeedAddress(mainAccount.currency.id)),
          amount: convertToAtomicUnit({
            amount: new BigNumber(params.fromAmount),
            account: fromAccount,
          }),
          data: (params.data && Buffer.from(params.data.replace("0x", ""), "hex")) || undefined,
          feesStrategy: params.feeStrategy || "medium",
          customGasLimit: params.gasLimit ? new BigNumber(params.gasLimit) : null,
          ...transformToBigNumbers(params.customFeeConfig),
        });
        let status = await bridge.getTransactionStatus(mainAccount, preparedTransaction);
        const statusInit = status;
        let finalTx = preparedTransaction;
        let customFeeConfig = transaction && getCustomFeesPerFamily(finalTx);
        const setTransaction = async (newTransaction: Transaction): Promise<Transaction> => {
          status = await bridge.getTransactionStatus(mainAccount, newTransaction);
          customFeeConfig = transaction && getCustomFeesPerFamily(newTransaction);
          finalTx = newTransaction;
          return newTransaction;
        };

        const hasDrawer =
          ["evm", "bitcoin"].includes(transaction.family) &&
          !["optimism", "arbitrum", "base"].includes(mainAccount.currency.id);
        if (!params.openDrawer) {
          return {
            feesStrategy: finalTx.feesStrategy,
            estimatedFees: convertToNonAtomicUnit({
              amount: status.estimatedFees,
              account: mainAccount,
            }),
            errors: status.errors,
            warnings: status.warnings,
            customFeeConfig,
            hasDrawer,
            gasLimit: finalTx.gasLimit,
          };
        }

        return new Promise(resolve => {
          const performClose = (save: boolean) => {
            track("button_clicked2", {
              button: save ? "continueNetworkFees" : "closeNetworkFees",
              page: "quoteSwap",
              ...swapDefaultTrack,
              swapVersion: params.SWAP_VERSION,
              value: finalTx.feesStrategy || "custom",
            });
            setDrawer(undefined);
            if (!save) {
              resolve({
                feesStrategy: params.feeStrategy,
                estimatedFees: convertToNonAtomicUnit({
                  amount: statusInit.estimatedFees,
                  account: mainAccount,
                }),
                errors: statusInit.errors,
                warnings: statusInit.warnings,
                customFeeConfig: params.customFeeConfig,
                hasDrawer,
                gasLimit: finalTx.gasLimit,
              });
            }
            resolve({
              // little hack to make sure we do not return null (for bitcoin for instance)
              feesStrategy: finalTx.feesStrategy || "custom",
              estimatedFees: convertToNonAtomicUnit({
                amount: status.estimatedFees,
                account: mainAccount,
              }),
              errors: status.errors,
              warnings: status.warnings,
              customFeeConfig,
              hasDrawer,
              gasLimit: finalTx.gasLimit,
            });
          };

          setDrawer(
            FeesDrawerLiveApp,
            {
              setTransaction,
              account: fromAccount,
              parentAccount: fromParentAccount,
              status: status,
              provider: undefined,
              disableSlowStrategy: true,
              transaction: preparedTransaction,
              onRequestClose: (save: boolean) => performClose(save),
            },
            {
              title: t("swap2.form.details.label.fees"),
              forceDisableFocusTrap: true,
              onRequestClose: () => performClose(false),
            },
          );
        });
      },
      "custom.isReady": async () => {
        console.info("Swap Live App Loaded");
        // FLEX_DEMO: Force-enable all buttons by returning dev mode flags
        if (isFlexBuild()) {
          return {
            isReady: true,
            devMode: true,
            hasAccounts: true,
            hasSufficientBalance: true,
            canSwap: true,
            canBuy: true,
            canSell: true,
          };
        }
      },
      "custom.getTransactionByHash": async ({
        params,
      }: {
        params: {
          transactionHash: string;
          fromAccountId: string;
          SWAP_VERSION: string;
        };
      }): Promise<
        | {
            hash: string;
            blockHeight: number | undefined;
            blockHash: string | undefined;
            nonce: number;
            gasUsed: string;
            gasPrice: string;
            value: string;
          }
        | object
      > => {
        const realFromAccountId = getAccountIdFromWalletAccountId(params.fromAccountId);
        if (!realFromAccountId) {
          return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
        }

        const fromAccount = accounts.find(acc => acc.id === realFromAccountId);
        if (!fromAccount) {
          return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
        }

        const fromParentAccount = getParentAccount(fromAccount, accounts);
        const mainAccount = getMainAccount(fromAccount, fromParentAccount);

        const nodeAPI = getNodeApi(mainAccount.currency);

        try {
          const tx = await nodeAPI.getTransaction(mainAccount.currency, params.transactionHash);
          return Promise.resolve(tx);
        } catch {
          // not a real error, the node just didn't find the transaction yet
          return Promise.resolve({});
        }
      },
      "custom.swapRedirectToHistory": async () => {
        redirectToHistory();
      },
      "custom.saveSwapToHistory": async ({
        params,
      }: {
        params: { swap: SwapProps; transaction_id: string };
      }) => {
        const { swap, transaction_id } = params;

        if (
          !swap ||
          !transaction_id ||
          !swap.provider ||
          !swap.fromAmount ||
          !swap.toAmount ||
          !swap.swapId
        ) {
          return Promise.reject("Cannot save swap missing params");
        }
        const fromId = getAccountIdFromWalletAccountId(swap.fromAccountId) || accounts[0]?.id;
        const toId = getAccountIdFromWalletAccountId(swap.toAccountId) || accounts.find(a => a.currency?.id === "ethereum")?.id;
        if (!fromId || !toId) return Promise.reject("Accounts not found");
        const mockHash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const fromAccount = accounts.find(acc => acc.id === fromId);
        const toAccount = accounts.find(acc => acc.id === toId);
        if (!fromAccount || !toAccount) {
          return Promise.reject(new Error(`accountId ${fromId} unknown`));
        }
        const accountId =
          fromAccount.type === "TokenAccount" ? getParentAccount(fromAccount, accounts).id : fromId;
        const operationId = `${accountId}-${mockHash}-SWAP`;
        const swapOperation: SwapOperation = {
          status: swap.status ?? "pending",
          provider: swap.provider,
          operationId,
          swapId: swap.swapId,
          receiverAccountId: toId,
          tokenId: toId,
          fromAmount: convertToAtomicUnit({
            amount: new BigNumber(swap.fromAmount),
            account: fromAccount,
          })!,
          toAmount: convertToAtomicUnit({
            amount: new BigNumber(swap.toAmount),
            account: toAccount,
          })!,
          finalAmount: swap.finalAmount ? new BigNumber(swap.finalAmount) : undefined,
        };

        // FLEX_DEMO: Swap data + native animation handled by custom.exchange.swap in CustomHandlers.ts
        // Only dispatch balance updates here (called after device confirmation)
        if (isFlexBuild()) {
          const fromAmountAtomic = swapOperation.fromAmount;
          const toAmountAtomic = swapOperation.toAmount;

          // Update SOURCE account (BTC): subtract fromAmount
          dispatch(
            updateAccountWithUpdater(accountId, account => ({
              ...account,
              balance: account.balance.minus(fromAmountAtomic),
              spendableBalance: account.spendableBalance.minus(fromAmountAtomic),
            })),
          );

          // Update DESTINATION account (ETH): add toAmount
          dispatch(
            updateAccountWithUpdater(toId, account => ({
              ...account,
              balance: account.balance.plus(new BigNumber(toAmountAtomic)),
              spendableBalance: account.spendableBalance.plus(new BigNumber(toAmountAtomic)),
            })),
          );
        } else {
          // Non-FLEX_DEMO: original behavior
          dispatch(
            updateAccountWithUpdater(accountId, account => {
              if (fromId === account.id) {
                return { ...account, swapHistory: [...account.swapHistory, swapOperation] };
              }
              return {
                ...account,
                subAccounts: account.subAccounts?.map<TokenAccount>((a: TokenAccount) => {
                  const subAccount = {
                    ...a,
                    swapHistory: [...a.swapHistory, swapOperation],
                  };
                  return a.id === fromId ? subAccount : a;
                }),
              };
            }),
          );
        }
        return Promise.resolve();
      },
      "custom.exchange.getQuotes": async ({
        params,
      }: {
        params: {
          providers: string[];
          data: {
            amount: string;
            sendCurrencyId: string;
            receiveCurrencyId: string;
          };
        };
      }): Promise<{
        quotes: Array<{
          key: string;
          provider: string;
          providerDetails: {
            name: string;
            type: string;
            isUniswapX: boolean;
            requiresKYC: boolean;
            continuesInProviderLiveApp: boolean;
          };
          quoteDetails: {
            type: string;
            sendAmount: number;
            receiveAmount: number;
            gasLess: boolean;
            networkFees: { currencyId: string };
            slippage: number;
            exchangeRate: number;
          };
          warning: null;
          error: null;
        }>;
        errors: unknown[];
      }> => {
        if (!isFlexBuild()) {
          return { quotes: [], errors: [] };
        }
        const rateMap: Record<string, Record<string, number>> = {
          bitcoin: { ethereum: 19.8743, solana: 3924.51, ripple: 0.4872, cardano: 294.67, dogecoin: 4812.33, polkadot: 1.4723, tron: 97.84, polygon: 4.921, ton: 196.42, cosmos: 4.873, near: 9.742, aptos: 7.923, avalanche_c_chain: 2.947, stellar: 0.0987, litecoin: 1000, zcash: 2500, monero: 400 },
          ethereum: { bitcoin: 0.05031, solana: 197.48, ripple: 0.02452, cardano: 14.827, dogecoin: 242.13, polkadot: 0.07408, tron: 4.923, polygon: 0.2476, ton: 9.882, cosmos: 0.2452, near: 0.4903, aptos: 0.3987, avalanche_c_chain: 0.1483, stellar: 0.00497, litecoin: 50.3, zcash: 125.74, monero: 20.11 },
          solana: { bitcoin: 0.0002548, ethereum: 0.005064, ripple: 0.0001241, cardano: 0.07509, dogecoin: 1.2263, polkadot: 0.0003752, tron: 0.02493, polygon: 0.001254, ton: 0.05005, cosmos: 0.001242, near: 0.002483, aptos: 0.00202, avalanche_c_chain: 0.000751, stellar: 0.00002516, litecoin: 0.2548, zcash: 0.637, monero: 0.1019 },
          litecoin: { bitcoin: 0.001, ethereum: 0.01987, solana: 3.9245, ripple: 0.000487, cardano: 0.2947, dogecoin: 4.8123, polkadot: 0.001472, tron: 0.09784, polygon: 0.004921, ton: 0.19642, cosmos: 0.004873, near: 0.009742, aptos: 0.007923, avalanche_c_chain: 0.002947, stellar: 0.0000987, litecoin: 1, zcash: 0.4, monero: 2.5 },
          ton: { bitcoin: 0.00509, ethereum: 0.10118, solana: 19.978, ripple: 0.00248, cardano: 1.4997, dogecoin: 24.495, polkadot: 0.007495, tron: 0.498, polygon: 0.02505, ton: 1, cosmos: 0.0248, near: 0.04959, aptos: 0.04033, avalanche_c_chain: 0.015, stellar: 0.000502, litecoin: 5.091, zcash: 2.036, monero: 12.73 },
          zcash: { bitcoin: 0.0004, ethereum: 0.00795, solana: 1.5698, ripple: 0.000195, cardano: 0.1179, dogecoin: 1.925, polkadot: 0.000589, tron: 0.03914, polygon: 0.001968, ton: 0.07857, cosmos: 0.001949, near: 0.003897, aptos: 0.003169, avalanche_c_chain: 0.001179, stellar: 0.0000395, litecoin: 0.4, zcash: 1, monero: 0.16 },
          monero: { bitcoin: 0.0025, ethereum: 0.04969, solana: 9.811, ripple: 0.001218, cardano: 0.7367, dogecoin: 12.031, polkadot: 0.003681, tron: 0.2446, polygon: 0.0123, ton: 0.49105, cosmos: 0.01218, near: 0.02436, aptos: 0.01981, avalanche_c_chain: 0.007368, stellar: 0.000247, litecoin: 2.5, zcash: 6.25, monero: 1 },
        };
        const { sendCurrencyId, receiveCurrencyId, amount } = params.data;
        const rawAmount = parseFloat(amount || "1");
        const rate =
          rateMap[sendCurrencyId]?.[receiveCurrencyId] ??
          (rateMap[receiveCurrencyId]?.[sendCurrencyId] != null ? 1 / rateMap[receiveCurrencyId][sendCurrencyId] : 0.001);
        const receiveAmount = rawAmount * rate;

        // FLEX_DEMO: Cache the pending swap amounts and provider BEFORE the webview opens
        // This captures the EXACT user inputted amount at the moment they click "View Quotes"
        try {
          const sendCurrencyMap: Record<string, { ticker: string; name: string; id: string; magnitude: number }> = {
            bitcoin: { ticker: "BTC", name: "Bitcoin", id: "bitcoin", magnitude: 8 },
            ethereum: { ticker: "ETH", name: "Ethereum", id: "ethereum", magnitude: 18 },
            solana: { ticker: "SOL", name: "Solana", id: "solana", magnitude: 9 },
            litecoin: { ticker: "LTC", name: "Litecoin", id: "litecoin", magnitude: 8 },
            ton: { ticker: "TON", name: "Toncoin", id: "ton", magnitude: 9 },
            zcash: { ticker: "ZEC", name: "Zcash", id: "zcash", magnitude: 8 },
            monero: { ticker: "XMR", name: "Monero", id: "monero", magnitude: 12 },
          };
          const sendCur =
            sendCurrencyMap[sendCurrencyId] || { ticker: "BTC", name: "Bitcoin", id: sendCurrencyId, magnitude: 8 };
          const recvCur =
            sendCurrencyMap[receiveCurrencyId] || { ticker: "ETH", name: "Ethereum", id: receiveCurrencyId, magnitude: 18 };
          // Convert display amount to atomic units
          const fromAmountAtomic = (rawAmount * Math.pow(10, sendCur.magnitude)).toFixed(0);
          const toAmountAtomic = (receiveAmount * Math.pow(10, recvCur.magnitude)).toFixed(0);
          window.localStorage.setItem("flex_demo_pending_swap", JSON.stringify({
            fromAmount: fromAmountAtomic,
            toAmount: toAmountAtomic,
            provider: "exodus",
            fromCurrencyTicker: sendCur.ticker,
            toCurrencyTicker: recvCur.ticker,
            fromCurrencyId: sendCur.id,
            toCurrencyId: recvCur.id,
            fromCurrencyName: sendCur.name,
            toCurrencyName: recvCur.name,
          }));
        } catch (e) {
          console.warn("[FlexBuild] Failed to cache pending swap:", e);
        }
        return {
          quotes: [
            {
              key: `flex-mock-thorswap-${sendCurrencyId}-${receiveCurrencyId}`,
              provider: "thorswap",
              providerDetails: {
                name: "THORChain",
                type: "DEX",
                isUniswapX: false,
                requiresKYC: false,
                continuesInProviderLiveApp: false,
              },
              quoteDetails: {
                type: "fixed",
                sendAmount: rawAmount,
                receiveAmount: Math.round(receiveAmount * 0.995),
                gasLess: false,
                networkFees: { currencyId: sendCurrencyId },
                slippage: 0.5,
                exchangeRate: rate * 0.995,
              },
              warning: null,
              error: null,
            },
            {
              key: `flex-mock-changelly-${sendCurrencyId}-${receiveCurrencyId}`,
              provider: "changelly",
              providerDetails: {
                name: "Changelly",
                type: "CEX",
                isUniswapX: false,
                requiresKYC: false,
                continuesInProviderLiveApp: false,
              },
              quoteDetails: {
                type: "fixed",
                sendAmount: rawAmount,
                receiveAmount: Math.round(receiveAmount * 0.993),
                gasLess: true,
                networkFees: { currencyId: sendCurrencyId },
                slippage: 0.3,
                exchangeRate: rate * 0.993,
              },
              warning: null,
              error: null,
            },
            {
              key: `flex-mock-${sendCurrencyId}-${receiveCurrencyId}`,
              provider: "exodus",
              providerDetails: {
                name: "Exodus",
                type: "CEX",
                isUniswapX: false,
                requiresKYC: false,
                continuesInProviderLiveApp: false,
              },
              quoteDetails: {
                type: "fixed",
                sendAmount: rawAmount,
                receiveAmount,
                gasLess: true,
                networkFees: { currencyId: sendCurrencyId },
                slippage: 0.5,
                exchangeRate: rate,
              },
              warning: null,
              error: null,
            },
          ],
          errors: [],
        };
      },
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [customPTXHandlers],
  );

  const hashString = useMemo(() => {
    // Recompute wallet-API ids when possible; otherwise keep raw deeplink ids.
    const fromAccountIdForUrl = resolvedDefaultFromAccount
      ? accountToWalletAPIAccount(
          walletState,
          resolvedDefaultFromAccount,
          resolvedDefaultFromParentAccount,
        ).id
      : rawFromAccountId;
    const toAccountIdForUrl = resolvedDefaultToAccount
      ? accountToWalletAPIAccount(
          walletState,
          resolvedDefaultToAccount,
          resolvedDefaultToParentAccount,
        ).id
      : rawToAccountId;

    const params = new URLSearchParams({
      ...(isOffline ? { isOffline: "true" } : {}),
      ...(fromAccountIdForUrl ? { fromAccountId: fromAccountIdForUrl } : {}),
      ...(toAccountIdForUrl
        ? {
            toAccountId: toAccountIdForUrl,
            amountFrom: state?.defaultAmountFrom || "",
          }
        : {}),
      ...(state?.from
        ? {
            fromPath: simplifyFromPath(state?.from),
          }
        : {}),
      ...(state?.defaultToken?.fromTokenId ? { fromTokenId: state.defaultToken.fromTokenId } : {}),
      ...(state?.defaultToken?.toTokenId ? { toTokenId: state.defaultToken.toTokenId } : {}),
      ...(state?.defaultToken ? { amountFrom: state?.defaultAmountFrom || "" } : {}),
      ...(state?.defaultCurrency?.toCurrencyId || state?.defaultCurrency?.id
        ? { toCurrencyId: state!.defaultCurrency!.toCurrencyId ?? state!.defaultCurrency!.id }
        : {}),
      ...(state?.defaultCurrency?.fromCurrencyId
        ? { fromCurrencyId: state.defaultCurrency.fromCurrencyId }
        : {}),
      ...(state?.defaultAmountFrom
        ? {
            amountFrom: state.defaultAmountFrom,
          }
        : {}),
      ...(state?.affiliate
        ? {
            affiliate: state.affiliate,
          }
        : {}),
    }).toString();

    return params;
  }, [
    isOffline,
    rawFromAccountId,
    rawToAccountId,
    resolvedDefaultFromAccount,
    resolvedDefaultFromParentAccount,
    resolvedDefaultToAccount,
    resolvedDefaultToParentAccount,
    state,
    walletState,
  ]);

  const onSwapWebviewError = (error?: SwapLiveError) => {
    logger.critical(error);
    setDrawer(WebviewErrorDrawer, error);
  };

  const onStateChange: WebviewProps["onStateChange"] = state => {
    setWebviewState(state);

    if (!state?.loading && state?.isAppUnavailable && !isOffline) {
      logger.critical(
        new UnableToLoadSwapLiveError(
          '"Failed to load swap live app using WebPlatformPlayer in SwapWeb",',
        ),
      );
    }
  };

  useEffect(() => {
    if (webviewState?.url.includes("/unknown-error")) {
      // the live app has re-directed to /unknown-error. Handle this in callback, probably wallet-api failure.
      onSwapWebviewError();
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewState?.url]);

  const manifestWithHash = useMemo(
    () => ({ ...manifest, url: `${manifest.url}#${hashString}` }),
    [manifest, hashString],
  );

  const initialSource = useMemo(() => {
    return currentRouteNameRef.current || "";
  }, []);

  return (
    <>
      {enablePlatformDevTools && (
        <TopBar
          manifest={manifestWithHash}
          webviewAPIRef={webviewAPIRef}
          webviewState={webviewState}
        />
      )}

      <SwapWebAppWrapper>
        <Web3AppWebview
          manifest={manifestWithHash}
          inputs={{
            source: initialSource,
            theme,
            lang: locale,
            currencyTicker: fiatCurrency.ticker,
            swapApiBase: SWAP_API_BASE,
            swapUserIp: SWAP_USER_IP,
            devMode,
            lastSeenDevice: lastSeenDevice?.modelId,
            currentVersion,
            platform: "LLD",
            shareAnalytics,
            hasSeenAnalyticsOptInPrompt,
            ptxSwapLiveAppKycWarning,
            ptxSwapLiveAppOnPortfolio: ptxSwapLiveAppOnPortfolio ? "true" : "false",
            isModularDrawer: isLldModularDrawer ? "true" : "false",
            isEmbedded: isEmbedded ? "true" : "false",
            discreetMode: discreetMode ? "true" : "false",
            lwd40enabled: isLwd40Enabled ? "true" : "false",
          }}
          onStateChange={onStateChange}
          ref={webviewAPIRef}
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          customHandlers={customHandlers as never}
          Loader={Loader}
        />
      </SwapWebAppWrapper>
    </>
  );
};

export default SwapWebView;
