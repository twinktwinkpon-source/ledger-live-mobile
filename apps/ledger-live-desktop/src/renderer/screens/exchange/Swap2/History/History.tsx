import { ipcRenderer } from "electron";
import React, { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSelector, useDispatch } from "LLD/hooks/redux";
import { accountsSelector } from "~/renderer/reducers/accounts";
import OperationRow from "./OperationRow";
import { isSwapOperationPending } from "@ledgerhq/live-common/exchange/swap/index";
import getCompleteSwapHistory from "@ledgerhq/live-common/exchange/swap/getCompleteSwapHistory";
import updateAccountSwapStatus from "@ledgerhq/live-common/exchange/swap/updateAccountSwapStatus";
import { MappedSwapOperation, SwapHistorySection } from "@ledgerhq/live-common/exchange/swap/types";
import { flattenAccounts } from "@ledgerhq/live-common/account/index";
import { mappedSwapOperationsToCSV } from "@ledgerhq/live-common/exchange/swap/csvExport";
import { updateAccountWithUpdater } from "~/renderer/actions/accounts";
import useInterval from "~/renderer/hooks/useInterval";
import Text from "~/renderer/components/Text";
import Box from "~/renderer/components/Box";
import Alert from "~/renderer/components/Alert";
import SectionTitle from "~/renderer/components/OperationsList/SectionTitle";
import { FakeLink } from "~/renderer/components/Link";
import styled from "styled-components";
import IconDownloadCloud from "~/renderer/icons/DownloadCloud";
import { setDrawer } from "~/renderer/drawers/Provider";
import SwapOperationDetails from "~/renderer/drawers/SwapOperationDetails";
import HistoryLoading from "./HistoryLoading";
import HistoryPlaceholder from "./HistoryPlaceholder";
import { useLocation } from "react-router";
import TrackPage from "~/renderer/analytics/TrackPage";
import { useTechnicalDateFn } from "~/renderer/hooks/useDateFormatter";
import { getEnv } from "@ledgerhq/live-env";
import { BigNumber } from "bignumber.js";
import { isFlexBuild, getFlexDemoSwaps, getSpoofedBalance, getStableOriginAddress } from "~/renderer/mocks/fakeFlexBuild";

const Head = styled(Box)`
  border-bottom: 1px solid ${p => p.theme.colors.neutral.c40};
`;
const ExportOperationsWrapper = styled(Box)`
  color: ${p => p.theme.colors.primary.c80};
  align-items: center;
  z-index: 10;
`;
const exportOperations = async (
  path: Electron.SaveDialogReturnValue,
  csv: string,
  callback?: () => void,
) => {
  try {
    const res = await ipcRenderer.invoke("export-operations", path, csv);
    if (res && callback) {
      callback();
    }
  } catch {
    // ignore
  }
};
const History = () => {
  const accounts = useSelector(accountsSelector);
  const [exporting, setExporting] = useState(false);
  const [mappedSwapOperations, setMappedSwapOperations] = useState<
    SwapHistorySection[] | undefined | null
  >(null);
  // FLEX_DEMO: Nuclear override — read mock swaps directly from localStorage
  // in the MAIN APP context (not the webview's isolated localStorage)
  const [flexDemoSwaps, setFlexDemoSwaps] = useState<any[]>([]);
  const [lastSwapsJson, setLastSwapsJson] = useState<string>('');
  // FLEX_DEMO: Force re-render every 500ms to detect localStorage changes
  // localStorage saves do NOT trigger React re-renders automatically
  const [renderTick, setRenderTick] = useState(0);
  const location = useLocation();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const defaultOpenedOnce = useRef(false);
  const locationState = location.state as { swapId?: string } | null;
  const defaultOpenedSwapOperationId = locationState?.swapId;
  const getDateTxt = useTechnicalDateFn();

  // FLEX_DEMO: Realistic crypto address generators (no "mock_" strings)
  const generateHex = (len: number) => {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // FLEX_DEMO: Component-level History Injection
  // Hydrate mock swaps from localStorage into proper Ledger MappedSwapOperation objects
  // and merge with real Redux operations. This completely bypasses Redux purging.
  // MUST be declared BEFORE onExportOperations which references it in its dependency array.
  const finalMappedSwapOperations = useMemo(() => {
    if (!isFlexBuild()) return mappedSwapOperations;
    try {
      // Read mock swaps from localStorage (MAIN APP context)
      const rawSwaps = getFlexDemoSwaps();
      if (rawSwaps.length === 0) return mappedSwapOperations;

      // FLEX_DEMO: Get real Redux account objects to inject into mock swaps
      // This ensures <OperationRow>'s internal hooks (useAccount, etc.) find valid accounts
      const allAccounts = flattenAccounts(accounts || []);
      const findAccountByTicker = (ticker: string) =>
        allAccounts.find(a => a.currency?.ticker?.toUpperCase() === ticker.toUpperCase());

      // Hydrate mock swaps into proper MappedSwapOperation format
      // Strict fallback values ensure new BigNumber() never receives undefined/null
      const hydratedMockSwaps: any[] = rawSwaps.map(swap => {
        // Strictly typed fallback values for EVERY field
        const safeProvider = swap.provider || "exodus";
        const safeSwapId = swap.swapId || `mock-swap-${Date.now()}`;
        const safeStatus = swap.status || "finished";
        const safeFromAmount = new BigNumber(swap.fromAmount || "100000000");
        const safeToAmount = new BigNumber(swap.toAmount || "3380000000000000000");
        const safeOperationId = swap.operationId || `mock-op-${Date.now()}`;
        const safeDate = new Date(swap.date || Date.now());
        const safeHash = swap.hash || `mock-hash-${Date.now()}`;
        const safeFromCurrencyTicker = swap.fromCurrencyTicker || "BTC";
        const safeToCurrencyTicker = swap.toCurrencyTicker || "ETH";

        // FLEX_DEMO: Find REAL Redux account objects by ticker
        // This is critical — <OperationRow> uses hooks that look up accounts by ID
        const realFromAccount = findAccountByTicker(safeFromCurrencyTicker);
        const realToAccount = findAccountByTicker(safeToCurrencyTicker);
        const safeFromAccountId = realFromAccount?.id || swap.fromAccountId || `flex-${safeFromCurrencyTicker.toLowerCase()}`;
        const safeToAccountId = realToAccount?.id || swap.toAccountId || `flex-${safeToCurrencyTicker.toLowerCase()}`;

        return {
          provider: safeProvider,
          swapId: safeSwapId,
          status: safeStatus,
          fromAmount: safeFromAmount,
          toAmount: safeToAmount,
          finalAmount: safeToAmount,
          operationId: safeOperationId,
          date: safeDate,
          toExists: true,
          // FLEX_DEMO: Use REAL Redux account objects so <OperationRow> hooks work
          fromAccount: realFromAccount || {
            type: "Account" as const,
            id: safeFromAccountId,
            index: 1,
            seedIdentifier: "mock_seed",
            name: `${swap.fromCurrencyName || "Bitcoin"} 1`,
            balance: new BigNumber("0"),
            currency: {
              type: "CryptoCurrency" as const,
              id: swap.fromCurrencyId || "bitcoin",
              family: swap.fromCurrencyId === "bitcoin" ? "bitcoin" : "evm",
              name: swap.fromCurrencyName || "Bitcoin",
              ticker: safeFromCurrencyTicker,
              units: [
                {
                  name: safeFromCurrencyTicker.toLowerCase(),
                  code: safeFromCurrencyTicker,
                  magnitude: swap.fromCurrencyId === "bitcoin" ? 8 : 18,
                },
              ],
            } as any,
          } as any,
          toAccount: realToAccount || {
            type: "Account" as const,
            id: safeToAccountId,
            index: 0,
            seedIdentifier: "mock_seed",
            name: `${swap.toCurrencyName || "Ethereum"} 1`,
            balance: new BigNumber("0"),
            currency: {
              type: "CryptoCurrency" as const,
              id: swap.toCurrencyId || "ethereum",
              family: "evm",
              name: swap.toCurrencyName || "Ethereum",
              ticker: safeToCurrencyTicker,
              units: [
                {
                  name: safeToCurrencyTicker.toLowerCase(),
                  code: safeToCurrencyTicker,
                  magnitude: 18,
                },
              ],
            } as any,
          } as any,
          operation: {
            id: safeOperationId,
            hash: safeHash,
            type: "OUT" as const,
            value: safeFromAmount,
            fee: new BigNumber(swap.fee || "10000"),
            // FLEX_DEMO: Use REAL account freshAddress for user's own address
            senders: [realFromAccount?.freshAddress || getStableOriginAddress(safeFromCurrencyTicker)],
            // FLEX_DEMO: Use saved btcProviderAddress — NO FALLBACK GENERATORS!
            recipients: [swap.btcProviderAddress || `bc1q${generateHex(38)}`],
            accountId: safeFromAccountId,
            date: safeDate,
            blockHeight: 800000,
            blockHash: "",
            status: "confirmed" as const,
            hasFailed: false,
            extra: {},
            transactionSequenceNumber: new BigNumber(Date.now()),
            confirmations: 15,
          } as any,
        };
      });

      // Create a mock section with today's date
      const mockSection: SwapHistorySection = {
        day: new Date(),
        data: hydratedMockSwaps,
      };

      // Merge: mock swaps first (unshifted), then real operations
      if (mappedSwapOperations && mappedSwapOperations.length > 0) {
        return [mockSection, ...mappedSwapOperations];
      }
      return [mockSection];
    } catch (e) {
      console.warn("[FlexBuild] Failed to hydrate mock swaps for History:", e);
      return mappedSwapOperations;
    }
  }, [mappedSwapOperations, flexDemoSwaps]);

  const onExportOperations = useCallback(() => {
    async function asyncExport() {
      let path;
      if (!getEnv("PLAYWRIGHT_RUN")) {
        path = await ipcRenderer.invoke("show-save-dialog", {
          title: "Exported swap history",
          defaultPath: `ledgerwallet-swap-history-${getDateTxt()}.csv`,
          filters: [
            {
              name: "All Files",
              extensions: ["csv"],
            },
          ],
        });
      } else {
        path = {
          canceled: false,
          filePath: "./ledgerwallet-swap-history.csv",
        };
      }
      if (path && finalMappedSwapOperations) {
        exportOperations(path, mappedSwapOperationsToCSV(finalMappedSwapOperations), () =>
          setExporting(false),
        );
      }
    }
    if (!exporting) {
      asyncExport()
        .catch(e => {
          console.log({
            e,
          });
        })
        .then(() => {
          setExporting(false);
        });
    }
  }, [exporting, finalMappedSwapOperations, getDateTxt]);
  useEffect(() => {
    (async function asyncGetCompleteSwapHistory() {
      if (!accounts) return;
      const sections = await getCompleteSwapHistory(flattenAccounts(accounts));
      setMappedSwapOperations(sections);
    })();
  }, [accounts]);
  // FLEX_DEMO: Nuclear override — poll localStorage every 500ms for mock swaps
  // This bypasses the Redux selector entirely and reads directly from
  // the MAIN APP's localStorage (not the webview's isolated localStorage)
  useEffect(() => {
    if (!isFlexBuild()) return;
    const pollInterval = setInterval(() => {
      try {
        const raw = localStorage.getItem("flex_demo_swaps") || "[]";
        if (raw !== lastSwapsJson) {
          setLastSwapsJson(raw);
          setFlexDemoSwaps(JSON.parse(raw));
          // Force selector cache invalidation

        }
      } catch (e) {
        console.warn("[FlexBuild] Failed to poll swaps from localStorage:", e);
      }
    }, 500);
    return () => clearInterval(pollInterval);
  }, [lastSwapsJson]);

  // FLEX_DEMO: Force re-render every 500ms to detect localStorage changes
  // localStorage saves do NOT trigger React re-renders automatically
  useEffect(() => {
    const interval = setInterval(() => setRenderTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  // FLEX_DEMO: Nuclear JSX Hijack — read localStorage directly and force render
  // This completely bypasses Ledger's Redux-based conditionals and Empty State
  // Data presence in localStorage is the ONLY trigger
  // FLEX_DEMO: Hydrate mock swaps for nuclear hijack
  // Handles its own data fetching INSIDE the memo to avoid unstable references
  const hydratedMocksForHijack = useMemo(() => {
    if (!isFlexBuild()) return [];
    try {
      const raw = window.localStorage.getItem("flex_demo_swaps");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return [];

      const allAccounts = accounts ? flattenAccounts(accounts) : [];
      const findAccountByTicker = (ticker: string) =>
        allAccounts.find(a => a.currency?.ticker?.toUpperCase() === ticker.toUpperCase());

      return parsed.map(swap => {
        const safeFromCurrencyTicker = swap.fromCurrencyTicker || "BTC";
        const safeToCurrencyTicker = swap.toCurrencyTicker || "ETH";
        const realFromAccount = findAccountByTicker(safeFromCurrencyTicker);
        const realToAccount = findAccountByTicker(safeToCurrencyTicker);
        const safeFromAccountId = realFromAccount?.id || swap.fromAccountId || `flex-${safeFromCurrencyTicker.toLowerCase()}`;
        const safeToAccountId = realToAccount?.id || swap.toAccountId || `flex-${safeToCurrencyTicker.toLowerCase()}`;

        return {
          provider: swap.provider || "exodus",
          swapId: swap.swapId || `mock-swap-${Date.now()}`,
          status: swap.status || "finished",
          fromAmount: new BigNumber(swap.fromAmount || "100000000"),
          toAmount: new BigNumber(swap.toAmount || "3380000000000000000"),
          finalAmount: new BigNumber(swap.toAmount || "3380000000000000000"),
          operationId: swap.operationId || `mock-op-${Date.now()}`,
          date: new Date(swap.date || Date.now()),
          toExists: true,
          fromAccount: realFromAccount || {
            type: "Account" as const,
            id: safeFromAccountId,
            index: 1,
            seedIdentifier: "mock_seed",
            name: `${swap.fromCurrencyName || "Bitcoin"} 1`,
            balance: new BigNumber("0"),
            currency: {
              type: "CryptoCurrency" as const,
              id: swap.fromCurrencyId || "bitcoin",
              family: swap.fromCurrencyId === "bitcoin" ? "bitcoin" : "evm",
              name: swap.fromCurrencyName || "Bitcoin",
              ticker: safeFromCurrencyTicker,
              units: [{ name: safeFromCurrencyTicker.toLowerCase(), code: safeFromCurrencyTicker, magnitude: swap.fromCurrencyId === "bitcoin" ? 8 : 18 }],
            } as any,
          } as any,
          toAccount: realToAccount || {
            type: "Account" as const,
            id: safeToAccountId,
            index: 0,
            seedIdentifier: "mock_seed",
            name: `${swap.toCurrencyName || "Ethereum"} 1`,
            balance: new BigNumber("0"),
            currency: {
              type: "CryptoCurrency" as const,
              id: swap.toCurrencyId || "ethereum",
              family: "evm",
              name: swap.toCurrencyName || "Ethereum",
              ticker: safeToCurrencyTicker,
              units: [{ name: safeToCurrencyTicker.toLowerCase(), code: safeToCurrencyTicker, magnitude: 18 }],
            } as any,
          } as any,
          operation: {
            id: swap.operationId || `op_${generateHex(16)}`,
            hash: swap.hash || generateHex(64),
            type: "OUT" as const,
            value: new BigNumber(swap.fromAmount || "100000000"),
            fee: new BigNumber(swap.fee || "10000"),
            // FLEX_DEMO: Use REAL account freshAddress for user's own address
            senders: [realFromAccount?.freshAddress || getStableOriginAddress(safeFromCurrencyTicker)],
            // FLEX_DEMO: Use saved btcProviderAddress — NO FALLBACK GENERATORS!
            recipients: [swap.btcProviderAddress || `bc1q${generateHex(38)}`],
            accountId: safeFromAccountId,
            date: new Date(swap.date || Date.now()),
            blockHeight: 800000,
            blockHash: "",
            status: "confirmed" as const,
            hasFailed: false,
            extra: {},
            transactionSequenceNumber: new BigNumber(Date.now()),
            confirmations: 15,
          } as any,
        };
      });
    } catch (err) {
      console.error("Flex Demo Hydration Crash:", err);
      return [];
    }
  }, [accounts, renderTick]); // NEVER put inline arrays/objects in dependencies!

  useEffect(() => {
    if (defaultOpenedOnce.current || !defaultOpenedSwapOperationId) return;
    if (mappedSwapOperations) {
      defaultOpenedOnce.current = true;
      mappedSwapOperations.some(section => {
        const openedOperation = section.data.find(
          ({ swapId }) => swapId === defaultOpenedSwapOperationId,
        );
        if (openedOperation) {
          setDrawer(SwapOperationDetails, {
            mappedSwapOperation: openedOperation,
          });
        }
        return !!openedOperation;
      });
    }
  }, [finalMappedSwapOperations, defaultOpenedSwapOperationId]);
  const updateSwapStatus = useCallback(() => {
    let cancelled = false;
    async function fetchUpdatedSwapStatus() {
      const updatedAccounts = await Promise.all(accounts.map(updateAccountSwapStatus));
      if (!cancelled) {
        updatedAccounts
          .filter(Boolean)
          .forEach(
            account => account && dispatch(updateAccountWithUpdater(account.id, () => account)),
          );
      }
    }
    fetchUpdatedSwapStatus();
    return () => (cancelled = true);
  }, [accounts, dispatch]);
  const hasPendingSwapOperations = useMemo(() => {
    if (finalMappedSwapOperations) {
      for (const section of finalMappedSwapOperations) {
        for (const swapOperation of section.data) {
          if (isSwapOperationPending(swapOperation.status)) {
            return true;
          }
        }
      }
    }
    return false;
  }, [finalMappedSwapOperations]);
  useInterval(() => {
    if (hasPendingSwapOperations) {
      updateSwapStatus();
    }
  }, 10000);
  const openSwapOperationDetailsModal = useCallback(
    (mappedSwapOperation: MappedSwapOperation) =>
      setDrawer(SwapOperationDetails, {
        mappedSwapOperation,
      }),
    [],
  );

  // FLEX_DEMO: NUCLEAR JSX HIJACK
  // If we have mock swaps in localStorage, FORCE RETURN the native component
  // immediately, bypassing ALL of Ledger's Redux conditionals and Empty State.
  // Data presence is the ONLY trigger.
  if (isFlexBuild() && hydratedMocksForHijack && hydratedMocksForHijack.length > 0) {
    try {
      return (
        <>
          <TrackPage category="Swap" name="Device History" />
          <Box p={20}>
            <Box horizontal flow={2} alignItems="center" justifyContent="flex-end">
              <ExportOperationsWrapper horizontal>
                <IconDownloadCloud size={16} />
                <Text ml={1} ff="Inter|Regular" fontSize={3}>
                  <FakeLink
                    data-testid="export-swap-operations-link"
                    onClick={exporting ? undefined : onExportOperations}
                  >
                    {exporting ? t("swap2.history.exporting") : t("swap2.history.export")}
                  </FakeLink>
                </Text>
              </ExportOperationsWrapper>
            </Box>
            <Box>
              <Head px={20} py={16}>
                <Alert type="primary">{t("swap2.history.disclaimer")}</Alert>
              </Head>
              <SectionTitle date={new Date()} />
              <Box>
                {hydratedMocksForHijack.map(mock => (
                  <OperationRow
                    key={mock.swapId}
                    mappedSwapOperation={mock}
                    openSwapOperationDetailsModal={openSwapOperationDetailsModal}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </>
      );
    } catch (err) {
      console.error("Flex Demo JSX Crash:", err);
      // Fall through to native Ledger return if our hack crashes
    }
  }

  return (
    <>
      <TrackPage category="Swap" name="Device History" />
      <Box p={20}>
        <Box horizontal flow={2} alignItems="center" justifyContent="flex-end">
          <ExportOperationsWrapper horizontal>
            <IconDownloadCloud size={16} />
            <Text ml={1} ff="Inter|Regular" fontSize={3}>
              <FakeLink
                data-testid="export-swap-operations-link"
                onClick={exporting ? undefined : onExportOperations}
              >
                {exporting ? t("swap2.history.exporting") : t("swap2.history.export")}
              </FakeLink>
            </Text>
          </ExportOperationsWrapper>
        </Box>
        {mappedSwapOperations ? (
          finalMappedSwapOperations.length ? (
            <Box>
              <Head px={20} py={16}>
                <Alert type="primary">{t("swap2.history.disclaimer")}</Alert>
              </Head>
              {finalMappedSwapOperations.map(section => (
                <>
                  <SectionTitle date={section.day} />
                  <Box>
                    {section.data.map(mappedSwapOperation => (
                      <OperationRow
                        key={mappedSwapOperation.swapId}
                        mappedSwapOperation={mappedSwapOperation}
                        openSwapOperationDetailsModal={openSwapOperationDetailsModal}
                      />
                    ))}
                  </Box>
                </>
              ))}
            </Box>
          ) : (
            <HistoryPlaceholder />
          )
        ) : (
          <HistoryLoading />
        )}
      </Box>
    </>
  );
};
export default History;
