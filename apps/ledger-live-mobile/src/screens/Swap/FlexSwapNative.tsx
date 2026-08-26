/**
 * FLEX native swap — fully native swap flow (no provider webview).
 *
 * Screen 1 (this file): pick from/to flex assets + amount → fetch quote from
 * the flex server (/swap/quote) → confirm.
 * Execution happens server-side (/swap/execute): balances are adjusted
 * atomically, then the app refreshes through the normal flex sync. No KYC,
 * no third-party webview, works offline of any partner API.
 */
import React, { useMemo, useState, useCallback } from "react";
import { ScrollView, Pressable } from "react-native";
import { Flex, Text, Button, Divider, IconsLegacy } from "@ledgerhq/native-ui";
import styled from "styled-components/native";
import { useSelector } from "react-redux";
import { flexSelector } from "~/reducers/flex";
import { useTranslation } from "~/context/Locale";
import { fetchFlexQuote, executeFlexSwapOnServer } from "~/flex/swapApi";
import { getCryptoCurrencyById } from "@ledgerhq/live-common/currencies/index";
import { CryptoIcon } from "@ledgerhq/native-ui/pre-ldls";
import BigNumber from "bignumber.js";

const CURRENCY_LABELS: Record<string, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  solana: "Solana",
  litecoin: "Litecoin",
  zcash: "Zcash",
  ton: "Toncoin",
  ripple: "XRP",
  cardano: "Cardano",
  dogecoin: "Dogecoin",
};

const Row = styled(Pressable)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-vertical: 12px;
`;

export default function FlexSwapScreen() {
  const { t } = useTranslation();
  const flex = useSelector(flexSelector);
  const balances = flex.balances || {};

  const ids = useMemo(
    () =>
      Object.keys(balances)
        .filter(id => parseFloat(balances[id] || "0") > 0)
        .map(id => (id === "gram" ? "ton" : id)),
    [balances],
  );

  const [fromId, setFromId] = useState<string | null>(ids[0] ?? null);
  const [toId, setToId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof fetchFlexQuote>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);

  const amount = parseFloat(amountText) || 0;
  const balanceOf = (id: string | null) => (id ? parseFloat(balances[id] || "0") : 0);

  const onGetQuote = useCallback(async () => {
    if (!fromId || !toId || !amount) return;
    setBusy(true); setError(null); setQuote(null);
    try {
      const q = await fetchFlexQuote(fromId, toId, String(amount));
      if ((q as { error?: string }).error) throw new Error((q as { error?: string }).error!);
      setQuote(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [fromId, toId, amount]);

  const onConfirm = useCallback(async () => {
    if (!flex.key || !fromId || !toId || !quote) return;
    setBusy(true); setError(null);
    try {
      await executeFlexSwapOnServer(flex.key, fromId, toId, String(amount));
      setQuote(null); setAmountText("");
      // Balances refresh via normal flex sync; show success state briefly
      setError(null);
      alert("Swap complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [flex.key, fromId, toId, quote, amount]);

  const currencyName = (id: string) => CURRENCY_LABELS[id] ?? id;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "background.main" }} contentContainerStyle={{ padding: 16 }}>
      <Text variant="h4" fontWeight="semiBold" mb={4}>Swap</Text>

      {/* From */}
      <Text variant="body" color="neutral.c70" mb={2}>From</Text>
      <Row onPress={() => setPicking(picking === "from" ? null : "from")}
        style={{ backgroundColor: "background.card", borderRadius: 12, paddingHorizontal: 12 }}>
        <Flex flexDirection="row" alignItems="center">
          {fromId && (
            <CryptoIcon ledgerId={fromId} ticker={fromId.slice(0, 4).toUpperCase()} size={32} shape="square" />
          )}
          <Text variant="body" fontWeight="semiBold" ml={3}>
            {fromId ? currencyName(fromId) : "Select"}
          </Text>
        </Flex>
        <IconsLegacy.ChevronRightMedium size={16} color="neutral.c50" />
      </Row>
      {picking === "from" && (
        <Flex style={{ backgroundColor: "background.card", borderRadius: 12, marginTop: 4 }} px={3}>
          {ids.map((id, i) => (
            <Flex key={id}>
              <Row onPress={() => { setFromId(id); setPicking(null); }}>
                <Text variant="body">{currencyName(id)}</Text>
                <Text variant="body" color="neutral.c70">{balanceOf(id).toFixed(4)}</Text>
              </Row>
              {i < ids.length - 1 && <Divider />}
            </Flex>
          ))}
        </Flex>
      )}

      <Flex alignItems="center" my={2}>
        <Text variant="body" color="neutral.c50">↓</Text>
      </Flex>

      {/* To */}
      <Text variant="body" color="neutral.c70" mb={2}>To</Text>
      <Row onPress={() => setPicking(picking === "to" ? null : "to")}
        style={{ backgroundColor: "background.card", borderRadius: 12, paddingHorizontal: 12 }}>
        <Flex flexDirection="row" alignItems="center">
          {toId && (
            <CryptoIcon ledgerId={toId} ticker={toId.slice(0, 4).toUpperCase()} size={32} shape="square" />
          )}
          <Text variant="body" fontWeight="semiBold" ml={3}>
            {toId ? currencyName(toId) : "Select"}
          </Text>
        </Flex>
        <IconsLegacy.ChevronRightMedium size={16} color="neutral.c50" />
      </Row>
      {picking === "to" && (
        <Flex style={{ backgroundColor: "background.card", borderRadius: 12, marginTop: 4 }} px={3}>
          {ids.filter(id => id !== fromId).map((id, i, arr) => (
            <Flex key={id}>
              <Row onPress={() => { setToId(id); setPicking(null); }}>
                <Text variant="body">{currencyName(id)}</Text>
                <Text variant="body" color="neutral.c70">{balanceOf(id).toFixed(4)}</Text>
              </Row>
              {i < arr.length - 1 && <Divider />}
            </Flex>
          ))}
        </Flex>
      )}

      {/* Amount */}
      <Text variant="body" color="neutral.c70" mt={4} mb={2}>
        Amount {fromId ? `(max ${balanceOf(fromId)})` : ""}
      </Text>
      <Flex flexDirection="row" alignItems="center"
        style={{ backgroundColor: "background.card", borderRadius: 12, paddingHorizontal: 12, height: 48 }}>
        <Flex flex={1}>
          <Text variant="large" fontWeight="semiBold">{amountText || "0"}</Text>
        </Flex>
        {[["25%", .25], ["50%", .5], ["MAX", 1]].map(([label, f]) => (
          <Pressable key={label as string} onPress={() => setAmountText(String(+(balanceOf(fromId) * (f as number)).toFixed(8)))}
            style={{ marginLeft: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#2a2a2a" }}>
            <Text variant="small" fontWeight="semiBold">{label as string}</Text>
          </Pressable>
        ))}
      </Flex>

      {error && (
        <Text variant="body" color="error.c60" mt={3}>{error}</Text>
      )}

      {!quote ? (
        <Button type="main" mt={5} disabled={!fromId || !toId || !amount || busy} onPress={onGetQuote}>
          {busy ? "Loading…" : "Get quote"}
        </Button>
      ) : (
        <>
          <Flex p={4} mt={4} style={{ backgroundColor: "background.card", borderRadius: 12 }}>
            <Flex flexDirection="row" justifyContent="space-between">
              <Text variant="body" color="neutral.c70">You receive</Text>
              <Text variant="body" fontWeight="semiBold">
                {quote.amountTo} {currencyName(toId!)}
              </Text>
            </Flex>
            <Divider my={3} />
            <Flex flexDirection="row" justifyContent="space-between">
              <Text variant="body" color="neutral.c70">Rate</Text>
              <Text variant="body">1 {fromId} = {quote.rate} {toId}</Text>
            </Flex>
            <Divider my={3} />
            <Flex flexDirection="row" justifyContent="space-between">
              <Text variant="body" color="neutral.c70">Provider</Text>
              <Text variant="body">{quote.provider}</Text>
            </Flex>
          </Flex>
          <Button type="main" mt={4} disabled={busy} onPress={onConfirm}>
            {busy ? "Executing…" : "Confirm swap"}
          </Button>
          <Button type="default" mt={2} disabled={busy} onPress={() => setQuote(null)}>
            Back
          </Button>
        </>
      )}
    </ScrollView>
  );
}
