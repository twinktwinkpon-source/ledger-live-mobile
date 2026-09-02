import { JSONRPCRequest } from "json-rpc-2.0";
import React, { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "LLD/hooks/redux";
import { UserRefusedOnDevice } from "@ledgerhq/errors";
import { Operation, SignedOperation } from "@ledgerhq/types-live";
import { useToasts } from "@ledgerhq/live-common/notifications/ToastProvider/index";
import {
  receiveOnAccountLogic,
  signTransactionLogic,
  completeExchangeLogic,
  CompleteExchangeRequest,
  CompleteExchangeUiRequest,
  signMessageLogic,
} from "@ledgerhq/live-common/platform/logic";
import { serializePlatformSignedTransaction } from "@ledgerhq/live-common/platform/serializers";
import { useJSONRPCServer } from "@ledgerhq/live-common/platform/JSONRPCServer";
import {
  RawPlatformSignedTransaction,
  RawPlatformTransaction,
} from "@ledgerhq/live-common/platform/rawTypes";
import {
  useListPlatformAccounts,
  useListPlatformCurrencies,
} from "@ledgerhq/live-common/platform/react";
import trackingWrapper from "@ledgerhq/live-common/platform/tracking";
import { useCurrenciesUnderFeatureFlag } from "@ledgerhq/live-common/modularDrawer/hooks/useCurrenciesUnderFeatureFlag";
import { openModal } from "../../actions/modals";
import { flattenAccountsSelector } from "~/renderer/reducers/accounts";
import BigSpinner from "../BigSpinner";
import { track } from "~/renderer/analytics/segment";
import {
  requestAccountLogic,
  broadcastTransactionLogic,
  RequestAccountParams,
} from "./LiveAppSDKLogic";
import { Loader } from "./styled";
import { WebviewAPI, WebviewProps } from "./types";
import { useWebviewState } from "./helpers";
import { currentRouteNameRef } from "~/renderer/analytics/screenRefs";
import { mevProtectionSelector } from "~/renderer/reducers/settings";
import { walletSelector } from "~/renderer/reducers/wallet";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import { BigNumber } from "bignumber.js";
import { HOOKS_TRACKING_LOCATIONS } from "~/renderer/analytics/hooks/variables";
import { ModularDrawerLocation } from "@ledgerhq/live-common/modularDrawer/enums";
import { useModularDrawerVisibility } from "@ledgerhq/live-common/modularDrawer/useModularDrawerVisibility";
import { setFlowValue, setSourceValue } from "~/renderer/reducers/modularDialog";
import { useOpenAssetAndAccount } from "LLD/features/ModularDialog/Web3AppWebview/AssetAndAccountDrawer";
import { useFeature } from "@features/platform-feature-flags";
import { setOriginFlow } from "~/renderer/analytics/originFlow";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";
import { useNavigate } from "react-router";

export const PlatformAPIWebview = forwardRef<WebviewAPI, WebviewProps>(
  ({ manifest, inputs = {}, onStateChange }, ref) => {
    const manifestDomainCheckEnabled = useFeature("lldWebviewManifestDomainCheck")?.enabled;
    const { webviewState, webviewRef, setWebviewRef, webviewProps, webviewPartition } =
      useWebviewState(
        {
          manifest,
          inputs,
          manifestDomainCheckEnabled,
        },
        ref,
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

    useEffect(() => {
      if (onStateChange) {
        onStateChange(webviewState);
      }
    }, [webviewState, onStateChange]);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const accounts = useSelector(flattenAccountsSelector);
    const mevProtected = useSelector(mevProtectionSelector);
    const { pushToast } = useToasts();
    const { t } = useTranslation();

    const [widgetLoaded, setWidgetLoaded] = useState(false);
    const [isMockingSwap, setIsMockingSwap] = useState(false);

    const walletState = useSelector(walletSelector);
    const listAccounts = useListPlatformAccounts(walletState, accounts);
    const { deactivatedCurrencyIds } = useCurrenciesUnderFeatureFlag();
    const listCurrencies = useListPlatformCurrencies(deactivatedCurrencyIds);

    const { isModularDrawerVisible } = useModularDrawerVisibility({
      modularDrawerFeatureFlagKey: "lldModularDrawer",
    });
    const modularDrawerVisible = isModularDrawerVisible({
      location: ModularDrawerLocation.LIVE_APP,
      liveAppId: manifest.id,
    });

    const { openAssetAndAccountPromise } = useOpenAssetAndAccount();

    const openAssetAndAccountSelector = useCallback(
      (currencyIds?: string[]) =>
        openAssetAndAccountPromise({
          currencies: currencyIds,
          areCurrenciesFiltered: currencyIds && currencyIds.length > 0,
        }),
      [openAssetAndAccountPromise],
    );

    const requestAccount = useCallback(
      (request: RequestAccountParams) => {
        const source =
          currentRouteNameRef.current === "Platform Catalog"
            ? "Discover"
            : (currentRouteNameRef.current ?? "Unknown");

        const flow = manifest.name;

        dispatch(setFlowValue(flow));
        setOriginFlow(flow);
        dispatch(setSourceValue(source));

        return requestAccountLogic(
          walletState,
          { manifest },
          request,
          deactivatedCurrencyIds,
          openAssetAndAccountSelector,
          modularDrawerVisible,
        );
      },
      [
        manifest,
        dispatch,
        walletState,
        deactivatedCurrencyIds,
        openAssetAndAccountSelector,
        modularDrawerVisible,
      ],
    );

    const receiveOnAccount = useCallback(
      ({ accountId }: { accountId: string }) =>
        receiveOnAccountLogic(
          walletState,
          { manifest, accounts, tracking },
          accountId,
          (account, parentAccount, accountAddress) => {
            // FIXME: handle address rejection (if user reject address, we don't end up in onResult nor in onCancel 🤔)
            return new Promise((resolve, reject) =>
              dispatch(
                openModal("MODAL_EXCHANGE_CRYPTO_DEVICE", {
                  account,
                  parentAccount,
                  onResult: () => {
                    tracking.platformReceiveSuccess(manifest);
                    resolve(accountAddress);
                  },
                  onCancel: (error: Error) => {
                    tracking.platformReceiveFail(manifest);
                    reject(error);
                  },
                  onClose: () => {
                    tracking.platformReceiveFail(manifest);
                    reject(new UserRefusedOnDevice());
                  },
                  verifyAddress: true,
                }),
              ),
            );
          },
        ),
      [walletState, manifest, accounts, dispatch, tracking],
    );

    const signTransaction = useCallback(
      ({
        accountId,
        transaction,
        params,
      }: {
        accountId: string;
        transaction: RawPlatformTransaction;
        params?: {
          /**
           * The name of the Ledger Nano app to use for the signing process
           */
          useApp: string;
        };
      }) => {
        return signTransactionLogic(
          { manifest, accounts, tracking },
          accountId,
          transaction,
          (account, parentAccount, { canEditFees, hasFeesProvided, liveTx }) => {
            return new Promise((resolve, reject) =>
              dispatch(
                openModal("MODAL_SIGN_TRANSACTION", {
                  canEditFees,
                  stepId: canEditFees && !hasFeesProvided ? "amount" : "summary",
                  transactionData: liveTx,
                  useApp: params?.useApp,
                  account,
                  parentAccount,
                  location: HOOKS_TRACKING_LOCATIONS.genericDAppTransactionSend,
                  onResult: async (signedOperation: SignedOperation) => {
                    tracking.platformSignTransactionSuccess(manifest);
                    resolve(await serializePlatformSignedTransaction(signedOperation));
                  },
                  onCancel: (error: Error) => {
                    tracking.platformSignTransactionFail(manifest);
                    reject(error);
                  },
                }),
              ),
            );
          },
        );
      },
      [manifest, dispatch, accounts, tracking],
    );

    const broadcastTransaction = useCallback(
      async ({
        accountId,
        signedTransaction,
      }: {
        accountId: string;
        signedTransaction: RawPlatformSignedTransaction;
      }) => {
        return broadcastTransactionLogic(
          { manifest, dispatch, accounts, tracking, mevProtected },
          accountId,
          signedTransaction,
          pushToast,
          t,
        );
      },
      [manifest, accounts, pushToast, dispatch, t, tracking, mevProtected],
    );

    const startExchange = useCallback(
      ({ exchangeType }: { exchangeType: number }) => {
        tracking.platformStartExchangeRequested(manifest);

        return new Promise((resolve, reject) =>
          dispatch(
            openModal("MODAL_PLATFORM_EXCHANGE_START", {
              exchangeType,
              onResult: (result: { nonce: string }) => {
                tracking.platformStartExchangeSuccess(manifest);
                resolve(result.nonce);
              },
              onCancel: (cancelResult: { error: Error }) => {
                tracking.platformStartExchangeFail(manifest);
                reject(cancelResult.error);
              },
            }),
          ),
        );
      },
      [manifest, dispatch, tracking],
    );

    const completeExchange = useCallback(
      (completeRequest: CompleteExchangeRequest) => {
        return completeExchangeLogic(
          { manifest, accounts, tracking },
          completeRequest,
          ({
            provider,
            exchange,
            transaction,
            binaryPayload,
            signature,
            exchangeType,
          }: CompleteExchangeUiRequest): Promise<Operation> =>
            new Promise((resolve, reject) => {
              dispatch(
                openModal("MODAL_PLATFORM_EXCHANGE_COMPLETE", {
                  provider,
                  exchange,
                  transaction,
                  binaryPayload,
                  signature,
                  exchangeType,
                  onResult: (operation: Operation) => {
                    tracking.platformCompleteExchangeSuccess(manifest);
                    resolve(operation);
                  },
                  onCancel: (error: Error) => {
                    tracking.platformCompleteExchangeFail(manifest);
                    reject(error);
                  },
                }),
              );
            }),
        );
      },
      [accounts, dispatch, manifest, tracking],
    );

    const signMessage = useCallback(
      ({ accountId, message }: { accountId: string; message: string }) => {
        return signMessageLogic(
          { manifest, accounts, tracking },
          accountId,
          message,
          (account, message) =>
            new Promise((resolve, reject) => {
              dispatch(
                openModal("MODAL_SIGN_MESSAGE", {
                  message,
                  account,
                  onConfirmationHandler: (signature: string) => {
                    tracking.platformSignMessageSuccess(manifest);
                    resolve(signature);
                  },
                  onFailHandler: (err: Error) => {
                    tracking.platformSignMessageFail(manifest);
                    reject(err);
                  },
                  onClose: () => {
                    tracking.platformSignMessageUserRefused(manifest);
                    reject(new UserRefusedOnDevice());
                  },
                }),
              );
            }),
        );
      },
      [accounts, dispatch, manifest, tracking],
    );

    const handlers = useMemo(
      () => ({
        "account.list": listAccounts,
        "currency.list": listCurrencies,
        "account.request": requestAccount,
        "account.receive": receiveOnAccount,
        "transaction.sign": signTransaction,
        "transaction.broadcast": broadcastTransaction,
        "exchange.start": startExchange,
        "exchange.complete": completeExchange,
        "message.sign": signMessage,
      }),
      [
        listAccounts,
        listCurrencies,
        requestAccount,
        receiveOnAccount,
        signTransaction,
        broadcastTransaction,
        startExchange,
        completeExchange,
        signMessage,
      ],
    );

    const handleSend = useCallback((request: JSONRPCRequest): Promise<void> => {
      const webview = webviewRef.current;
      if (webview) {
        const origin = new URL(webview.src).origin;
        if (origin === "null") return Promise.resolve();
        webview.contentWindow?.postMessage(JSON.stringify(request), origin);
      }

      return Promise.resolve();
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [receive] = useJSONRPCServer(handlers, handleSend);

    const handleMessage = useCallback(
      (event: Electron.IpcMessageEvent) => {
        if (event.channel === "webviewToParent") {
          receive(JSON.parse(event.args[0]));
        }
      },
      [receive],
    );

    useEffect(() => {
      tracking.platformLoad(manifest);
      const webview = webviewRef.current;
      if (webview) {
        webview.addEventListener("ipc-message", handleMessage);
      }

      return () => {
        if (webview) {
          webview.removeEventListener("ipc-message", handleMessage);
        }
      };
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest, handleMessage]);

    const handleLoad = useCallback(() => {
      tracking.platformLoadSuccess(manifest);
      setWidgetLoaded(true);
    }, [manifest, tracking]);

    const handleDomReady = useCallback(() => {
      const webview = webviewRef.current;
      if (!webview) {
        return;
      }

      const id = webview.getWebContentsId();

      // cf. https://gist.github.com/codebytere/409738fcb7b774387b5287db2ead2ccb
      // When lldWebviewManifestDomainCheck is on, pass manifest.domains so main process enforces origin whitelist
      globalThis.api?.openWindow(
        id,
        manifestDomainCheckEnabled ? (manifest.domains ?? []) : undefined,
      );

      // FLEX_DEMO: Premium Webview DOM Injector
      // Injects CSS overrides and button unblocking into the webview's DOM
      // to enable swap buttons that the remote server has disabled.
      // This is the ONLY way to unlock buttons inside a remote <webview>.
      if (isFlexBuild()) {
        const hackScript = `
          // STEP 0: Intercept fetch() for the swap API /quote endpoint
          (function() {
            var _origFetch = window.fetch;
            window.fetch = function(url, opts) {
              var urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : '');
              if (urlStr.indexOf('/quote') !== -1 && opts && opts.method !== 'POST') {
                try {
                  var u = new URL(urlStr, window.location.href);
                  var from = u.searchParams.get('from') || 'bitcoin';
                  var to = u.searchParams.get('to') || 'ethereum';
                  var amountFrom = parseFloat(u.searchParams.get('amountFrom') || '1');
                   var rateMap = {
                     bitcoin: { ethereum: 19.8743, solana: 3924.51, ripple: 0.4872, cardano: 294.67, dogecoin: 4812.33, polkadot: 1.4723, tron: 97.84, polygon: 4.921, ton: 196.42, cosmos: 4.873, near: 9.742, aptos: 7.923, avalanche_c_chain: 2.947, stellar: 0.0987, litecoin: 1000, zcash: 2500, monero: 400 },
                     ethereum: { bitcoin: 0.05031, solana: 197.48, ripple: 0.02452, cardano: 14.827, dogecoin: 242.13, polkadot: 0.07408, tron: 4.923, polygon: 0.2476, ton: 9.882, cosmos: 0.2452, near: 0.4903, aptos: 0.3987, avalanche_c_chain: 0.1483, stellar: 0.00497, litecoin: 50.3, zcash: 125.74, monero: 20.11 },
                     solana: { bitcoin: 0.0002548, ethereum: 0.005064, ripple: 0.0001241, cardano: 0.07509, dogecoin: 1.2263, polkadot: 0.0003752, tron: 0.02493, polygon: 0.001254, ton: 0.05005, cosmos: 0.001242, near: 0.002483, aptos: 0.00202, avalanche_c_chain: 0.000751, stellar: 0.00002516, litecoin: 0.2548, zcash: 0.637, monero: 0.1019 },
                     litecoin: { bitcoin: 0.001, ethereum: 0.01987, solana: 3.9245, ripple: 0.000487, cardano: 0.2947, dogecoin: 4.8123, polkadot: 0.001472, tron: 0.09784, polygon: 0.004921, ton: 0.19642, cosmos: 0.004873, near: 0.009742, aptos: 0.007923, avalanche_c_chain: 0.002947, stellar: 0.0000987, litecoin: 1, zcash: 0.4, monero: 2.5 },
                     ton: { bitcoin: 0.00509, ethereum: 0.10118, solana: 19.978, ripple: 0.00248, cardano: 1.4997, dogecoin: 24.495, polkadot: 0.007495, tron: 0.498, polygon: 0.02505, ton: 1, cosmos: 0.0248, near: 0.04959, aptos: 0.04033, avalanche_c_chain: 0.015, stellar: 0.000502, litecoin: 5.091, zcash: 2.036, monero: 12.73 },
                     zcash: { bitcoin: 0.0004, ethereum: 0.00795, solana: 1.5698, ripple: 0.000195, cardano: 0.1179, dogecoin: 1.925, polkadot: 0.000589, tron: 0.03914, polygon: 0.001968, ton: 0.07857, cosmos: 0.001949, near: 0.003897, aptos: 0.003169, avalanche_c_chain: 0.001179, stellar: 0.0000395, litecoin: 0.4, zcash: 1, monero: 0.16 },
                     monero: { bitcoin: 0.0025, ethereum: 0.04969, solana: 9.811, ripple: 0.001218, cardano: 0.7367, dogecoin: 12.031, polkadot: 0.003681, tron: 0.2446, polygon: 0.0123, ton: 0.49105, cosmos: 0.01218, near: 0.02436, aptos: 0.01981, avalanche_c_chain: 0.007368, stellar: 0.000247, litecoin: 2.5, zcash: 6.25, monero: 1 }
                   };
                  var rate = (rateMap[from] && rateMap[from][to] != null) ? rateMap[from][to] : (rateMap[to] && rateMap[to][from] != null ? 1 / rateMap[to][from] : 0.001);
                  var amountTo = amountFrom * rate;
                   var providers = ['thorswap', 'changelly', 'exodus'];
                   var providerNames = { thorswap: 'THORChain DEX', changelly: 'Changelly', exodus: 'Exodus' };
                   var providerTypes = { thorswap: 'DEX', changelly: 'CEX', exodus: 'CEX' };
                  var mockQuotes = providers.map(function(p, i) {
                    var adj = 1 - (i * 0.003);
                    return {
                      key: 'flex-mock-' + p + '-' + from + '-' + to + '-' + Date.now(),
                      provider: p,
                      providerType: providerTypes[p],
                      providerURL: 'https://' + p + '.com',
                      amountTo: Math.round(amountTo * adj * 100000000) / 100000000,
                      exchangeRate: Math.round(rate * adj * 1000000) / 1000000,
                      slippage: 0.5,
                      type: 'fixed',
                      networkFees: { value: 0.0001, currency: from },
                      tags: { isRegistrationRequired: false, isTokenApprovalRequired: false },
                      liquiditySource: undefined,
                      customFields: { quoteId: 'flex-q-' + Date.now() + '-' + i }
                    };
                  });
                  return Promise.resolve(new Response(JSON.stringify(mockQuotes), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                  }));
                } catch(e) { console.warn('[FlexBuild] fetch mock error:', e); }
              }
              return _origFetch.apply(this, arguments);
            };
          })();

          // STEP 1: Inline CSS — apply styles directly to DOM nodes (no <style> tags)
          var mockSwapTriggered = false;
          function unblockButtons() {
            var buttons = document.querySelectorAll('button, [role="button"]');
            buttons.forEach(function(btn) {
              var text = btn.textContent ? btn.textContent.toLowerCase() : '';
              if ((text.includes('view quotes') || text.includes('swap with') || text.includes('exchange') || text.includes('pay ')) && !text.includes('uniswap')) {
                btn.removeAttribute('disabled');
                btn.disabled = false;
                btn.setAttribute('aria-disabled', 'false');
                btn.setAttribute('data-disabled', 'false');
                btn.style.setProperty('background-color', '#ffffff', 'important');
                btn.style.setProperty('color', '#000000', 'important');
                btn.style.setProperty('opacity', '1', 'important');
                btn.style.setProperty('cursor', 'pointer', 'important');
                btn.style.setProperty('pointer-events', 'auto', 'important');
                btn.style.setProperty('border', 'none', 'important');
                btn.style.setProperty('border-radius', '48px', 'important');
                btn.style.setProperty('min-height', '48px', 'important');
                btn.style.setProperty('font-weight', '600', 'important');
                btn.style.setProperty('display', 'flex', 'important');
                btn.style.setProperty('align-items', 'center', 'important');
                btn.style.setProperty('justify-content', 'center', 'important');
              }
            });
          }
          unblockButtons();
          setInterval(unblockButtons, 250);

          var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
              if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
                var btn = mutation.target;
                if (btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button') {
                  var text = btn.textContent ? btn.textContent.toLowerCase() : '';
                  if ((text.includes('view quotes') || text.includes('swap with') || text.includes('exchange') || text.includes('pay ')) && !text.includes('uniswap')) {
                    btn.removeAttribute('disabled');
                    btn.disabled = false;
                    btn.style.setProperty('pointer-events', 'auto', 'important');
                    btn.style.setProperty('opacity', '1', 'important');
                    btn.style.setProperty('cursor', 'pointer', 'important');
                  }
                }
              }
            });
          });
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'aria-disabled', 'data-disabled'],
          });

          // STEP 3: REMOVED — native animation is handled by custom.exchange.swap in CustomHandlers.ts
          // Do NOT intercept confirm/swap buttons — let the webview call the Ledger SDK naturally

          // STEP 4: Only intercept "View Quotes" for navigation (do NOT intercept swap/confirm buttons)
          setInterval(function() {
            var buttons = document.querySelectorAll('button, [role="button"]');
            buttons.forEach(function(btn) {
              var text = btn.textContent ? btn.textContent.toLowerCase() : '';
              if (text.includes('view quotes') && !btn.dataset.viewQuotesHooked) {
                btn.dataset.viewQuotesHooked = 'true';
                btn.onclick = function(e) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  console.log('NAVIGATE_TO_SWAP_TAB');
                };
                btn.addEventListener('click', function(e) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  console.log('NAVIGATE_TO_SWAP_TAB');
                }, true);
              }
            });
          }, 250);
        `;
        webview.executeJavaScript(hackScript).catch(() => {});
      }
    }, [manifest.domains, manifestDomainCheckEnabled, webviewRef]);

    useEffect(() => {
      const webview = webviewRef.current;

      if (webview) {
        webview.addEventListener("did-finish-load", handleLoad);
        webview.addEventListener("dom-ready", handleDomReady);

        const handleConsoleMessage = (event: any) => {
    if (event.level === 1 && event.message === "EXECUTE_MOCK_SWAP_NOW") {
        console.log("[FlexBuild] EXECUTE_MOCK_SWAP_NOW received — swap already handled by CustomHandlers");
        setTimeout(() => {
            if (typeof navigate === 'function') {
                navigate("/swap/history");
            }
        }, 3000);
    }

            if (event.level === 1 && event.message === "NAVIGATE_TO_SWAP_TAB") {
    console.log("[FlexBuild] Intercepted View Quotes navigation from webview!");
    if (typeof navigate === 'function') {
        navigate("/swap");
    }
  }
};

        webview.addEventListener("console-message", handleConsoleMessage);

        return () => {
          webview.removeEventListener("did-finish-load", handleLoad);
          webview.removeEventListener("dom-ready", handleDomReady);
          webview.removeEventListener("console-message", handleConsoleMessage);
        };
      }

      return () => {
        if (webview) {
          webview.removeEventListener("did-finish-load", handleLoad);
          webview.removeEventListener("dom-ready", handleDomReady);
        }
      };
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [handleLoad, handleDomReady]);

  // FLEX_DEMO: After the "Confirm on device" modal shows, wait 4s then navigate
  // The localStorage save is now done INSTANTLY in the console-message listener
  // to prevent data loss if the component unmounts before the timeout fires.
  useEffect(() => {
    if (!isMockingSwap) return;

    const timer = setTimeout(() => {
      // FLEX_DEMO: The mock swap was already saved to localStorage instantly
      // in the console-message listener. Here we just navigate to History.
      setIsMockingSwap(false);
      navigate("/swap/history");
    }, 4000);

    return () => clearTimeout(timer);
  }, [isMockingSwap, setIsMockingSwap, navigate]);

    const webviewStyle = useMemo(() => {
      return {
        opacity: widgetLoaded ? 1 : 0,
        border: "none",
        width: "100%",
        flex: 1,
        transition: "opacity 200ms ease-out",
      };
    }, [widgetLoaded]);

    return (
      <>
        {isMockingSwap && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 99999,
            }}
          >
            <div
              style={{
                backgroundColor: "#1a1a1a",
                borderRadius: "16px",
                padding: "32px",
                textAlign: "center",
                maxWidth: "400px",
                border: "1px solid #333",
              }}
            >
              <div style={{ marginBottom: "16px" }}>
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    animation: "spin 1s linear infinite",
                    margin: "0 auto",
                    color: "#ffffff",
                  }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <h3 style={{ color: "#ffffff", fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                Confirm swap on your Ledger device
              </h3>
              <p style={{ color: "#cccccc", fontSize: "14px" }}>
                Please review and approve the transaction on your device...
              </p>
            </div>
          </div>
        )}
        <webview
          ref={setWebviewRef}
          /**
           * There seems to be an issue between Electron webview and styled-components
           * (and React more broadly, cf. comment below).
           * When using a styled webview component, the `allowpopups` prop does not
           * seem to be set
           */
          style={webviewStyle}
          // eslint-disable-next-line react/no-unknown-property
          preload={`file://${window.api.appDirname}/webviewPreloader.bundle.js`}
          /**
           * There seems to be an issue between Electron webview and react
           * Hence, the normal `allowpopups` prop does not work and we need to
           * explicitly set its value to "true" as a string
           * cf. https://github.com/electron/electron/issues/6046
           */
          // @ts-expect-error: see above comment
          // eslint-disable-next-line react/no-unknown-property
          allowpopups="true"
          {...webviewProps}
          {...webviewPartition}
        />
        {!widgetLoaded ? (
          <Loader>
            <BigSpinner size={50} />
          </Loader>
        ) : null}
      </>
    );
  },
);

PlatformAPIWebview.displayName = "PlatformAPIWebview";
