import React, { useMemo } from "react";
import { Flex, Text } from "@ledgerhq/native-ui";
import BigNumber from "bignumber.js";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import { ScrollView } from "react-native";
import { useTranslation } from "~/context/Locale";
import { getDeviceIcon } from "LLM/utils/getDeviceIcon";
import { smallestToWhole } from "~/flex/server";
import CurrencyUnitValue from "~/components/CurrencyUnitValue";
import CounterValue from "~/components/CounterValue";
import { getCryptoCurrencyById } from "@ledgerhq/live-common/currencies/index";
import { getProductName } from "LLM/utils/getProductName";

/**
 * Flex device screen ("Мой Ledger" → device card → Open).
 * Native Ledger Manager-style layout: device header with the real device
 * symbol, installed apps list (from the desktop panel profile), and the
 * balance summary formatted with the standard currency units/countervalues.
 */
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
        const whole = smallestToWhole({ [id]: balances[id] || "0" })[id] || "0";
        return { id, nid, currency, whole };
      }),
    [activeIds, balances],
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
          <Text variant="small" color="success.c70" mt={1}>
            ✓ {t("manager.flexDevice.connected")}
          </Text>
        </Flex>
      </Flex>

      <Flex mt={6}>
        <Text variant="h5" fontWeight="semiBold" mb={3}>
          {t("manager.installedApps.title")}
        </Text>
        {(flex.profile?.installedApps?.length
          ? flex.profile.installedApps
          : rows
              .filter(r => r.currency)
              .map(r => ({ name: r.nid, version: "" }))
        ).map(app => (
          <Flex
            key={app.name}
            p={4}
            mb={2}
            style={{ backgroundColor: "background.card", borderRadius: 12 }}
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Text variant="body" fontWeight="semiBold" style={{ textTransform: "capitalize" }}>
              {app.name}
            </Text>
            {app.version ? (
              <Text variant="body" color="neutral.c70">
                v{app.version}
              </Text>
            ) : null}
          </Flex>
        ))}
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
