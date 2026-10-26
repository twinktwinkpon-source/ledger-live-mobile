import React, { useMemo } from "react";
import { ScrollView } from "react-native";
import { Box, Text } from "@ledgerhq/lumen-ui-rnative";
import BigNumber from "bignumber.js";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import { useTranslation } from "~/context/Locale";
import CurrencyUnitValue from "~/components/CurrencyUnitValue";
import CounterValue from "~/components/CounterValue";
import {
  getCryptoCurrencyById,
  findCryptoCurrencyByTicker,
} from "@ledgerhq/live-common/currencies/index";
import type { CryptoCurrency } from "@ledgerhq/types-cryptoassets";
import { CryptoIcon } from "@ledgerhq/native-ui/pre-ldls";
import { getValidCryptoIconSizeNative } from "@ledgerhq/live-common/helpers/cryptoIconSize";
import { getProductName } from "LLM/utils/getProductName";
import { getDeviceModel } from "@ledgerhq/devices";
import { getDeviceAnimationStyles } from "~/helpers/getDeviceAnimation";
import { DeviceNameFallback } from "./DeviceNameFallback";

/**
 * Flex device screen ("Мой Ledger" → device card → Open).
 * Wallet 4.0 / Lumen rendering of the Manager device dashboard: real device
 * animation (same lottie the rest of the app uses for that model), installed
 * apps list from the flex server profile, and the balance summary formatted
 * with the standard currency units/countervalues.
 */

const APP_ICON_SIZE = 36;

/** Resolve a profile app entry (ticker or currency id) to a currency. */
function resolveAppCurrency(name: string): CryptoCurrency | null {
  try {
    return getCryptoCurrencyById(name);
  } catch {
    // findCryptoCurrencyByTicker returns undefined when nothing matches —
    // normalize to null so callers can rely on a single "absent" value.
    return findCryptoCurrencyByTicker(name.toUpperCase()) ?? null;
  }
}

export default function FlexDeviceView() {
  const { t } = useTranslation();
  const flex = useSelector(flexSelector);
  const device = flex.profile?.device;
  const balances = flex.balances;
  const activeIds = useMemo(() => Object.keys(balances || {}), [balances]);

  const rows = useMemo(
    () =>
      activeIds.map(id => {
        const nid = id === "gram" ? "ton" : id;
        let currency = null;
        try {
          currency = getCryptoCurrencyById(nid);
        } catch {
          currency = null;
        }
        const whole = (balances && balances[id]) || "0";
        return { id, nid, currency, whole };
      }),
    [activeIds, balances],
  );

  // Installed apps come from the flex server profile (pushed by the desktop
  // admin panel). The panel sends only display names/tickers — it has no real
  // on-device app versions (the device itself is virtual), so versions are
  // never rendered: a clean list beats fake identical ones.
  const apps = useMemo(
    () =>
      (
        flex.profile?.installedApps?.length
          ? flex.profile.installedApps.map(a => ({ name: a.name }))
          : rows
              .filter(r => r.currency)
              .map(r => ({ name: r.currency?.ticker || r.nid }))
      ).map(a => ({ ...a, currency: resolveAppCurrency(a.name) })),
    [flex.profile, rows],
  );

  if (!device) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center" lx={{ padding: "s24" }}>
        <Text variant="h3">{getProductName("nanoX" as never)}</Text>
        <Text lx={{ marginTop: "s12" }} textAlign="center">
          {t("manager.selectDevice.title")}
        </Text>
      </Box>
    );
  }

  const modelId = device.modelId as never;
  const productName = getDeviceModel(modelId).productName;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
    >
      <Box
        lx={{
          marginTop: "s24",
          padding: "s16",
          borderRadius: "s20",
          gap: "s16",
        }}
      >
        <Box flexDirection="row" alignItems="center" lx={{ gap: "s16" }}>
          <Box
            justifyContent="center"
            alignItems="center"
            lx={{ borderRadius: "s20" }}
            style={getDeviceAnimationStyles(modelId, { width: 120, height: 120 })}
          >
            <DeviceNameFallback modelId={modelId} />
          </Box>
          <Box flex={1} lx={{ gap: "s4" }}>
            <Text variant="h4" fontWeight="semiBold">
              {device.name || productName}
            </Text>
            <Text variant="body">
              {t("manager.flexDevice.firmware")} {device.firmwareVersion} · {device.batteryLevel}%
            </Text>
          </Box>
        </Box>
      </Box>

      <Box lx={{ marginTop: "s24", gap: "s8" }}>
        <Text variant="h5" fontWeight="semiBold">
          {t("manager.installedApps")}
        </Text>
        {apps.length === 0 ? (
          <Text variant="body">{t("manager.appList.noAppsInstalled")}</Text>
        ) : (
          apps.map((app, index) => (
            <Box
              key={`${app.name}-${index}`}
              flexDirection="row"
              alignItems="center"
              lx={{ paddingVertical: "s14", gap: "s12" }}
            >
              {app.currency ? (
                <CryptoIcon
                  ledgerId={app.currency.id}
                  ticker={app.currency.ticker}
                  size={getValidCryptoIconSizeNative(APP_ICON_SIZE)}
                  shape="square"
                />
              ) : null}
              <Text
                variant="body"
                fontWeight="semiBold"
                numberOfLines={1}
                style={{ textTransform: "capitalize", flexShrink: 1 }}
              >
                {app.currency ? app.currency.name : app.name}
              </Text>
            </Box>
          ))
        )}
      </Box>

      {rows.length > 0 && (
        <Box lx={{ marginTop: "s24", gap: "s12" }}>
          <Text variant="h5" fontWeight="semiBold">
            {t("distribution.header")}
          </Text>
          {rows.map(
            r =>
              r.currency && (
                <Box
                  key={`bal-${r.id}`}
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  lx={{ padding: "s16", borderRadius: "s12" }}
                >
                  <Text
                    variant="body"
                    fontWeight="medium"
                    style={{ textTransform: "capitalize" }}
                  >
                    {r.currency.name}
                  </Text>
                  <Box alignItems="flex-end">
                    <Text variant="body" fontWeight="semiBold">
                      <CurrencyUnitValue
                        unit={r.currency.units[0]}
                        value={new BigNumber(r.whole)}
                      />
                    </Text>
                    <Text variant="small">
                      <CounterValue currency={r.currency} value={new BigNumber(r.whole)} />
                    </Text>
                  </Box>
                </Box>
              ),
          )}
        </Box>
      )}
    </ScrollView>
  );
}
