import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Pressable } from "react-native";
import { Flex, Text, Button, Input, Alert } from "@ledgerhq/native-ui";
import { useSelector, useDispatch } from "~/context/hooks";
import { flexSelector, flexPushBalances } from "~/reducers/flex";
import { getFakeSwapQuotes, FakeSwapQuote } from "~/flex/fakeSwapQuotes";
import { wholeToSmallest, smallestToWhole } from "~/flex/server";
import BigNumber from "bignumber.js";
import { getCryptoCurrencyById } from "@ledgerhq/live-common/currencies/index";

type SwapRecord = {
  id: string;
  fromId: string;
  toId: string;
  fromAmount: string;
  toAmount: string;
  timestamp: number;
  provider: string;
};

const STORAGE_KEY = "flex_swap_history_v1";
const historyCache: SwapRecord[] = [];

function loadHistory(): SwapRecord[] {
  return historyCache;
}
function pushHistory(r: SwapRecord) {
  historyCache.unshift(r);
  if (historyCache.length > 50) historyCache.pop();
}

export default function FlexSwapScreen() {
  const flex = useSelector(flexSelector);
  const dispatch = useDispatch();
  const currencies = useMemo(() => Object.keys(flex.balances || {}), [flex.balances]);
  const [fromId, setFromId] = useState<string>(currencies[0] || "bitcoin");
  const [toId, setToId] = useState<string>(currencies[1] || "ethereum");
  useEffect(() => {
    if (currencies.length >= 2) {
      if (!currencies.includes(fromId)) setFromId(currencies[0]);
      if (!currencies.includes(toId) || toId === fromId) setToId(currencies[1] || currencies[0]);
    }
  }, [currencies, fromId, toId]);
  const [amount, setAmount] = useState<string>("0.1");
  const [quotes, setQuotes] = useState<FakeSwapQuote[]>([]);
  const [selected, setSelected] = useState<FakeSwapQuote | null>(null);
  const [history, setHistory] = useState<SwapRecord[]>(loadHistory());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fromBalWhole = useMemo(() => {
    const smallest = flex.balances[fromId] || "0";
    return smallestToWhole({ [fromId]: smallest })[fromId] || "0";
  }, [flex.balances, fromId]);

  const handleGetQuotes = useCallback(() => {
    if (!fromId || !toId || fromId === toId) {
      setError("Выберите разные активы");
      return;
    }
    const amt = amount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      setError("Введите корректную сумму");
      return;
    }
    const fromSmallest = wholeToSmallest({ [fromId]: amt })[fromId] || "0";
    const qs = getFakeSwapQuotes(fromId === "gram" ? "ton" : fromId, toId === "gram" ? "ton" : toId, fromSmallest);
    // Convert toAmount back to whole for display
    const qsWhole = qs.map(q => ({
      ...q,
      toAmount: smallestToWhole({ [toId]: q.toAmount })[toId] || q.toAmount,
      fromAmount: amt,
    }));
    setQuotes(qsWhole as FakeSwapQuote[]);
    setSelected(qsWhole[0] as FakeSwapQuote);
    setError(null);
    setSuccess(null);
  }, [fromId, toId, amount]);

  const handleSwap = useCallback(async () => {
    if (!selected) return;
    const fromSmallest = wholeToSmallest({ [fromId]: amount })[fromId] || "0";
    const toSmallest = wholeToSmallest({ [toId]: selected.toAmount })[toId] || "0";
    const fromBal = new BigNumber(flex.balances[fromId] || "0");
    if (fromBal.lt(new BigNumber(fromSmallest))) {
      setError(`Недостаточно ${fromId}: ${fromBalWhole}`);
      return;
    }
    const newBalances = { ...flex.balances };
    newBalances[fromId] = fromBal.minus(new BigNumber(fromSmallest)).toString();
    const toBal = new BigNumber(flex.balances[toId] || "0");
    newBalances[toId] = toBal.plus(new BigNumber(toSmallest)).toString();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (dispatch as any)(flexPushBalances({ balances: newBalances, tokens: flex.tokens || {} })).unwrap();
      const rec: SwapRecord = {
        id: selected.quoteId,
        fromId,
        toId,
        fromAmount: amount,
        toAmount: selected.toAmount,
        timestamp: Date.now(),
        provider: selected.provider,
      };
      pushHistory(rec);
      setHistory([...loadHistory()]);
      setSuccess(`Обмен ${amount} ${fromId} → ${selected.toAmount} ${toId} выполнен`);
      setError(null);
      setQuotes([]);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selected, fromId, toId, amount, flex.balances, flex.tokens, dispatch, fromBalWhole]);

  const fromCurrency = useMemo(() => {
    try {
      return getCryptoCurrencyById(fromId === "gram" ? "ton" : fromId);
    } catch {
      return null;
    }
  }, [fromId]);
  const toCurrency = useMemo(() => {
    try {
      return getCryptoCurrencyById(toId === "gram" ? "ton" : toId);
    } catch {
      return null;
    }
  }, [toId]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#000" }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text variant="h2">Flex Swap</Text>
      <Text variant="body" color="neutral.c70">
        Демо-обмен между flex-балансами (как на десктопе). Котировки — fake, история — локально, балансы синкаются через 10с.
      </Text>
      {flex.balances && Object.keys(flex.balances).length === 0 && (
        <Alert type="info" title="Нет активов — добавьте в Ctrl+Shift+L на десктопе" />
      )}
      <Flex flexDirection="column" style={{ gap: 12 }}>
        <Text variant="subtitle">Отдаёте</Text>
        <Flex flexDirection="row" style={{ gap: 8 }}>
          <Flex flex={1}>
            <Input value={amount} onChangeText={setAmount} placeholder="0.1" />
            <Text variant="small" color="neutral.c70" mt={2}>
              Баланс: {fromBalWhole} {fromCurrency?.ticker || fromId}
            </Text>
          </Flex>
          <Flex style={{ gap: 4 }}>
            {currencies.map(c => (
              <Button key={c} size="small" type={c === fromId ? "main" : "shade"} onPress={() => setFromId(c)}>
                {c}
              </Button>
            ))}
          </Flex>
        </Flex>
        <Text variant="subtitle" mt={4}>
          Получаете
        </Text>
        <Flex flexDirection="row" style={{ gap: 8 }}>
          <Flex flex={1} p={3} style={{ borderWidth: 1, borderColor: "#333", borderRadius: 8 }}>
            <Text color="neutral.c70">{selected ? `${selected.toAmount} ${toCurrency?.ticker || toId}` : "—"}</Text>
          </Flex>
          <Flex style={{ gap: 4 }}>
            {currencies.map(c => (
              <Button key={c} size="small" type={c === toId ? "main" : "shade"} onPress={() => setToId(c)}>
                {c}
              </Button>
            ))}
          </Flex>
        </Flex>
        <Button type="main" onPress={handleGetQuotes} mt={4}>
          Получить котировки
        </Button>
        {error && <Alert type="error" title={error} mt={3} />}
        {success && <Alert type="success" title={success} mt={3} />}
        {quotes.length > 0 && (
          <Flex mt={4} style={{ gap: 8 }}>
            <Text variant="subtitle">Котировки</Text>
            {quotes.map(q => (
              <Pressable
                key={q.quoteId}
                onPress={() => setSelected(q)}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderColor: selected?.quoteId === q.quoteId ? "#C4A24D" : "#222",
                  borderRadius: 8,
                  backgroundColor: selected?.quoteId === q.quoteId ? "rgba(196,162,77,0.1)" : "transparent",
                }}
              >
                <Text variant="body">
                  {q.provider}: {amount} {fromCurrency?.ticker} → {q.toAmount} {toCurrency?.ticker} (impact {q.priceImpact}%)
                </Text>
                <Text variant="small" color="neutral.c70">
                  rate {q.rate} • gas {q.estimatedGas}
                </Text>
              </Pressable>
            ))}
            <Button type="main" onPress={handleSwap} disabled={!selected}>
              Обменять
            </Button>
          </Flex>
        )}
        <Flex mt={6} style={{ gap: 8 }}>
          <Text variant="h3">История (локально)</Text>
          {history.length === 0 ? (
            <Text color="neutral.c70">Пока пусто</Text>
          ) : (
            history.map(h => (
              <Flex key={h.id} p={3} style={{ borderWidth: 1, borderColor: "#222", borderRadius: 8 }}>
                <Text>
                  {h.fromAmount} {h.fromId} → {h.toAmount} {h.toId} • {h.provider}
                </Text>
                <Text variant="small" color="neutral.c70">
                  {new Date(h.timestamp).toLocaleString()}
                </Text>
              </Flex>
            ))
          )}
        </Flex>
        <Flex mt={6} style={{ gap: 8 }}>
          <Text variant="h3">Latest operations (из flex)</Text>
          <Text variant="small" color="neutral.c70">
            Операции появятся в Portfolio → Последние операции после интеграции с live-common. Пока история выше — источник правды, балансы уже синкаются.
          </Text>
        </Flex>
      </Flex>
    </ScrollView>
  );
}
