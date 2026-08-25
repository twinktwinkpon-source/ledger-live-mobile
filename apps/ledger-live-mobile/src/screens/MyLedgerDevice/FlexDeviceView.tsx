import React, { useMemo } from "react";
import { Flex, Text, Divider, Icons } from "@ledgerhq/native-ui";
import BigNumber from "bignumber.js";
import styled from "styled-components/native";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import { ScrollView, Pressable } from "react-native";
import { useTranslation } from "~/context/Locale";
import { getDeviceIcon } from "LLM/utils/getDeviceIcon";
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

/**
 * Flex device screen ("Мой Ledger" → device card → Open).
 * Native Ledger Manager-style layout: device header with the real device
 * symbol, installed apps list (from the desktop panel profile), and the
 * balance summary formatted with the standard currency units/countervalues.
 */

const AppRow = styled(Pressable)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-vertical: 14px;

  :active {
    background-color: ${p => p.theme.colors.neutral.c30};
  }
`;

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
  const balances = flex.balances || {};
  const activeIds = Object.keys(balances);

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
        const whole = balances[id] || "0";
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
      <Flex flex={1} p={6} justifyContent="center" alignItems="center">
        <Text variant="h3">Ledger Nano X</Text>
        <Text color="neutral.c70" textAlign="center" mt={3}>
          {t("manager.selectDevice.title")}
        </Text>
      </Flex>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "background.main" }} contentContainerStyle={{ padding: 16 }}>
      <Flex p={4} style={{ backgroundColor: "background.card", borderRadius: 16 }} flexDirection="row" alignItems="center">
        <Flex
          width={64}
          height={64}
          borderRadius={16}
          justifyContent="center"
          alignItems="center"
          mr={4}
          style={{ backgroundColor: "background.main" }}
        >
          {getDeviceIcon({ modelId: device.modelId } as never, 32)}
        </Flex>
        <Flex flex={1}>
          <Text variant="h4" fontWeight="semiBold">
            {device.name || getProductName(device.modelId as never)}
          </Text>
          <Text variant="body" color="neutral.c70" mt={1}>
            {t("manager.flexDevice.firmware")} {device.firmwareVersion} · {device.batteryLevel}%
          </Text>
          <Flex flexDirection="row" alignItems="center" mt={1}>
            <Icons.CheckmarkCircleFill size="S" color="success.c60" />
            <Text variant="small" color="success.c70">
              {t("manager.flexDevice.connected")}
            </Text>
          </Flex>
        </Flex>
      </Flex>

      <Flex mt={6} style={{ backgroundColor: "background.card", borderRadius: 16 }} px={4}>
        <Text variant="h5" fontWeight="semiBold" mt={4} mb={2}>
          {t("manager.installedApps")}
        </Text>
        {apps.length === 0 ? (
          <Text variant="body" color="neutral.c70" pb={4}>
            {t("manager.appList.noAppsInstalled")}
          </Text>
        ) : (
          apps.map((app, index) => (
            <Flex key={`${app.name}-${index}`}>
              <AppRow>
                <Flex flexDirection="row" alignItems="center" flexShrink={1} pr={4}>
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
                    color="neutral.c100"
                    ml={3}
                    numberOfLines={1}
                    style={{ textTransform: "capitalize", flexShrink: 1 }}
                  >
                    {app.currency ? app.currency.name : app.name}
                  </Text>
                </Flex>
                <Icons.ChevronRight size="S" color="neutral.c50" />
              </AppRow>
              {index < apps.length - 1 && <Divider />}
            </Flex>
          ))
        )}
        <Flex pb={2} />
      </Flex>

      {rows.length > 0 && (
        <Flex mt={4}>
          <Text variant="h5" fontWeight="semiBold" mb={3}>
            {t("distribution.header")}
          </Text>
          {rows.map(
            r =>
              r.currency && (
                <Flex
                  key={`bal-${r.id}`}
                  p={4}
                  mb={2}
                  style={{ backgroundColor: "background.card", borderRadius: 12 }}
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Text variant="body" fontWeight="medium" style={{ textTransform: "capitalize" }}>
                    {r.currency.name}
                  </Text>
                  <Flex alignItems="flex-end">
                    <Text variant="body" fontWeight="semiBold">
                      <CurrencyUnitValue
                        unit={r.currency.units[0]}
                        value={new BigNumber(r.whole)}
                      />
                    </Text>
                    <Text variant="small" color="neutral.c70">
                      <CounterValue currency={r.currency} value={new BigNumber(r.whole)} />
                    </Text>
                  </Flex>
                </Flex>
              ),
          )}
        </Flex>
      )}
    </ScrollView>
  );
}
