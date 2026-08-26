/**
 * FLEX native swap — Wallet 4.0 design (Lumen UI).
 *
 * Fully native swap flow built with Ledger's own design system:
 * lumen Box/Text/Button/ListItem + lumen symbols + native-ui Flex.
 * Execution is server-side (/swap/execute on the flex license server) —
 * no provider webviews, no KYC gates.
 */
import React, { useMemo, useState, useCallback } from "react";
import { ScrollView } from "react-native";
import { Box, Text, Button, ListItem, ListItemLeading, ListItemContent, ListItemTitle } from "@ledgerhq/lumen-ui-rnative";
import { ChevronRight, TransferVertical } from "@ledgerhq/lumen-ui-rnative/symbols";
import { Flex } from "@ledgerhq/native-ui";
import BigNumber from "bignumber.js";
import { useTranslation } from "~/context/Locale";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import {
  getCryptoCurrencyById,
  findCryptoCurrencyByTicker,
} from "@ledgerhq/live-common/currencies/index";
import type { CryptoCurrency } from "@ledgerhq/types-cryptoassets";
import CurrencyIcon from "~/components/CurrencyIcon";
import CurrencyUnitValue from "~/components/CurrencyUnitValue";
import CounterValue from "~/components/CounterValue";
import { fetchFlexQuote, executeFlexSwapOnServer } from "~/flex/swapApi";

type FlexAsset = {
  id: string;
  currency: CryptoCurrency;
  balance: BigNumber;
};

function resolveCurrency(id: string): CryptoCurrency | null {
  try {
    return getCryptoCurrencyById(id);
  } catch {
    return findCryptoCurrencyByTicker(id.toUpperCase()) ?? null;
  }
}

export default function FlexSwapNative() {
  const { t } = useTranslation();
  const flex = useSelector(flexSelector);

  const balances = flex.balances || {};

  const assets = useMemo(() => {
    const list: FlexAsset[] = [];
    for (const raw of Object.keys(balances)) {
      const id = raw === "gram" ? "ton" : raw;
      const currency = resolveCurrency(id);
      if (!currency) continue;
      const balance = new BigNumber(balances[raw] || "0");
      if (balance.gt(0)) list.push({ id, currency, balance });
    }
    return list.sort((a, b) => b.balance.comparedTo(a.balance));
  }, [balances]);

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [pickerFor, setPickerFor] = useState<"from" | "to" | null>(null);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof fetchFlexQuote>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveFrom = fromId ?? assets[0]?.id ?? null;

  const fromAsset = assets.find(a => a.id === effectiveFrom) ?? null;
  const toAsset = assets.find(a => a.id === toId) ?? null;

  const amount = useMemo(() => {
    if (!amountText || !fromAsset) return new BigNumber(0);
    const unit = fromAsset.currency.units[0];
    return new BigNumber(amountText).times(new BigNumber(10).pow(unit.magnitude));
  }, [amountText, fromAsset]);

  const insufficient = !!fromAsset && amount.gt(fromAsset.balance);

  const onGetQuote = useCallback(async () => {
    if (!effectiveFrom || !toId || amount.lte(0) || !fromAsset) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const whole = amount.dividedBy(
        new BigNumber(10).pow(fromAsset.currency.units[0].magnitude),
      );
      const q = await fetchFlexQuote(effectiveFrom, toId, whole.toFixed(8));
      if ((q as unknown as { error?: string }).error)
        throw new Error((q as unknown as { error?: string }).error!);
      setQuote(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [effectiveFrom, toId, amount, fromAsset]);

  const onConfirm = useCallback(async () => {
    if (!flex.key || !effectiveFrom || !toId || !quote) return;
    setBusy(true);
    setError(null);
    try {
      await executeFlexSwapOnServer(flex.key, effectiveFrom, toId, quote.amountFrom);
      setQuote(null);
      setAmountText("");
      setToId(null);
      // balances refresh through the normal flex sync
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [flex.key, effectiveFrom, toId, quote]);

  const pickerList = pickerFor
    ? assets.filter(a => (pickerFor === "to" ? a.id !== effectiveFrom : true))
    : [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* From */}
      <Box lx={{ marginBottom: "s4" }}>
        <Text typography="body2" lx={{ color: "muted" }}>
          {t("transfer.swap.from")}
        </Text>
      </Box>
      <ListItem
        onPress={() => setPickerFor(pickerFor === "from" ? null : "from")}
        lx={{ backgroundColor: "surface", borderRadius: "md", paddingVertical: "s6", marginBottom: "s8" }}
      >
        <ListItemLeading>
          {fromAsset && <CurrencyIcon currency={fromAsset.currency} size={36} />}
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>
            {fromAsset ? fromAsset.currency.name : t("exchange.swap2.selectAsset")}
          </ListItemTitle>
          {fromAsset && (
            <CurrencyUnitValue
              unit={fromAsset.currency.units[0]}
              value={fromAsset.balance}
              showCode
            />
          )}
        </ListItemContent>
        <ChevronRight size={20} color="muted" />
      </ListItem>

      {/* Direction */}
      <Box lx={{ alignItems: "center", marginVertical: "s8" }}>
        <TransferVertical size={20} color="muted" />
      </Box>

      {/* To */}
      <Box lx={{ marginBottom: "s4" }}>
        <Text typography="body2" lx={{ color: "muted" }}>
          {t("transfer.swap.to")}
        </Text>
      </Box>
      <ListItem
        onPress={() => setPickerFor(pickerFor === "to" ? null : "to")}
        lx={{ backgroundColor: "surface", borderRadius: "md", paddingVertical: "s6" }}
      >
        <ListItemLeading>
          {toAsset && <CurrencyIcon currency={toAsset.currency} size={36} />}
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>
            {toAsset ? toAsset.currency.name : t("exchange.swap2.selectAsset")}
          </ListItemTitle>
          {toAsset && (
            <CurrencyUnitValue
              unit={toAsset.currency.units[0]}
              value={toAsset.balance}
              showCode
            />
          )}
        </ListItemContent>
        <ChevronRight size={20} color="muted" />
      </ListItem>

      {/* Asset picker */}
      {pickerFor ? (
        <Box lx={{ marginTop: "s8" }}>
          {pickerList.map(a => (
            <ListItem
              key={a.id}
              onPress={() => {
                if (pickerFor === "from") setFromId(a.id);
                else setToId(a.id);
                setQuote(null);
                setPickerFor(null);
              }}
              lx={{ backgroundColor: "surface", borderRadius: "md", paddingVertical: "s4", marginBottom: "s4" }}
            >
              <ListItemLeading>
                <CurrencyIcon currency={a.currency} size={32} />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>{a.currency.name}</ListItemTitle>
              </ListItemContent>
              <CurrencyUnitValue unit={a.currency.units[0]} value={a.balance} showCode />
            </ListItem>
          ))}
        </Box>
      ) : null}

      {/* Amount card */}
      <Box
        lx={{
          backgroundColor: "surface",
          borderRadius: "lg",
          paddingHorizontal: "s16",
          paddingVertical: "s12",
          marginTop: "s16",
        }}
      >
        <Flex flexDirection="row" alignItems="center" justifyContent="space-between">
          <Text
            typography="heading1"
            lx={{ color: insufficient ? "error" : "base" }}
            style={{ flex: 1 }}
          >
            {amountText || "0"}
          </Text>
          {fromAsset && (
            <Text typography="body1" lx={{ color: "muted" }}>
              {fromAsset.currency.ticker}
            </Text>
          )}
        </Flex>
        {fromAsset && (
          <CounterValue
            currency={fromAsset.currency}
            value={amount}
            alwaysShowValue
          />
        )}
        {insufficient && (
          <Box lx={{ marginTop: "s8" }}>
            <Text typography="body2" lx={{ color: "error" }}>
              {t("yourBalance")}:{" "}
              {fromAsset && (
                <CurrencyUnitValue
                  unit={fromAsset.currency.units[0]}
                  value={fromAsset.balance}
                />
              )}
            </Text>
          </Box>
        )}
        {!quote && (
          <Box lx={{ flexDirection: "row", marginTop: "s12" }}>
            {[0.25, 0.5, 1].map((f, idx) => (
              <Button
                key={f}
                size="sm"
                appearance="gray"
                disabled={!fromAsset || fromAsset.balance.lte(0)}
                onPress={() =>
                  setAmountText(
                    fromAsset
                      ? fromAsset.balance.times(f).toFixed(8).replace(/\.?0+$/, "")
                      : "0",
                  )
                }
                lx={{
                  marginRight: idx === 2 ? undefined : "s8",
                }}
              >
                {f === 1 ? t("common.max") : `${f * 100}%`}
              </Button>
            ))}
          </Box>
        )}
      </Box>

      {/* Error */}
      {error ? (
        <Box
          lx={{
            backgroundColor: "surface",
            borderRadius: "md",
            padding: "s12",
            marginTop: "s12",
          }}
        >
          <Text typography="body2" lx={{ color: "error" }}>
            {error}
          </Text>
        </Box>
      ) : null}

      {/* Quote summary */}
      {quote && toAsset ? (
        <Box
          lx={{
            backgroundColor: "surface",
            borderRadius: "lg",
            padding: "s16",
            marginTop: "s16",
          }}
        >
          <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text typography="body2" lx={{ color: "muted" }}>
              {t("swap2.form.youReceive")}
            </Text>
            <Flex flexDirection="column" alignItems="flex-end">
              <CurrencyUnitValue
                unit={toAsset.currency.units[0]}
                value={new BigNumber(quote.amountTo)}
                showCode
              />
              <CounterValue
                currency={toAsset.currency}
                value={new BigNumber(quote.amountTo)}
                alwaysShowValue
              />
            </Flex>
          </Flex>
          <Box lx={{ flexDirection: "row", justifyContent: "space-between", marginTop: "s12" }}>
            <Text typography="body2" lx={{ color: "muted" }}>
              {t("swap2.form.rate")}
            </Text>
            <Text typography="body1" lx={{ color: "base" }}>
              1 {fromAsset?.currency.ticker} ≈{" "}
              {Number(quote.rate).toFixed(6)} {toAsset.currency.ticker}
            </Text>
          </Box>
        </Box>
      ) : null}

      {/* CTA */}
      <Button
        size="lg"
        appearance="accent"
        isFull
        loading={busy}
        disabled={
          !fromAsset ||
          !toAsset ||
          amount.lte(0) ||
          insufficient ||
          busy
        }
        lx={{ marginTop: "s20" }}
        onPress={quote ? onConfirm : onGetQuote}
      >
        {quote ? t("swap2.form.confirm") : t("swap2.form.continue")}
      </Button>
      {quote ? (
        <Button
          size="lg"
          appearance="gray"
          isFull
          disabled={busy}
          lx={{ marginTop: "s8" }}
          onPress={() => setQuote(null)}
        >
          {t("common.back")}
        </Button>
      ) : null}
    </ScrollView>
  );
}
