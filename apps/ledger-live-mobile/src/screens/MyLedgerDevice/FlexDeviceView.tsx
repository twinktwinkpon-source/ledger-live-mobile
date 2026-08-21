import React from "react";
import { Flex, Text, Button } from "@ledgerhq/native-ui";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";
import { ScrollView } from "react-native";

export default function FlexDeviceView() {
  const flex = useSelector(flexSelector);
  const device = flex.profile?.device;
  const balances = flex.balances || {};
  const activeIds = Object.keys(balances);
  if (!device) {
    return (
      <Flex flex={1} p={6} justifyContent="center" alignItems="center">
        <Text variant="h3">Ledger Flex</Text>
        <Text color="neutral.c70" textAlign="center" mt={3}>
          Нет профиля устройства. Настройте на десктопе: Device Selection → Save Device
        </Text>
      </Flex>
    );
  }
  const modelName =
    device.modelId === "nanoX"
      ? "Nano X"
      : device.modelId === "nanoSP"
        ? "Nano S Plus"
        : device.modelId === "stax"
          ? "Stax"
          : device.modelId === "europa"
            ? "Flex"
            : device.modelId;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Flex p={4} style={{ backgroundColor: "#1a1a1a", borderRadius: 12 }} flexDirection="row" alignItems="center">
        <Flex width={64} height={64} borderRadius={12} style={{ backgroundColor: "#222" }} justifyContent="center" alignItems="center" mr={4}>
          <Text variant="large">🔒</Text>
        </Flex>
        <Flex flex={1}>
          <Text variant="h3">{device.name || `Ledger ${modelName}`}</Text>
          <Text color="neutral.c70">
            {modelName} • FW {device.firmwareVersion} • {device.batteryLevel}%
          </Text>
          <Text variant="small" color="success.c70">
            ✓ Подключено (Flex)
          </Text>
        </Flex>
      </Flex>
      <Flex>
        <Text variant="h3" mb={3}>
          Установленные приложения
        </Text>
        {(flex.profile?.installedApps && flex.profile.installedApps.length > 0
          ? flex.profile.installedApps
          : activeIds.map(id => ({ name: id, version: "1.0" }))
        ).length === 0 ? (
          <Text color="neutral.c70">Нет активов</Text>
        ) : (
          (flex.profile?.installedApps && flex.profile.installedApps.length > 0
            ? flex.profile.installedApps
            : activeIds.map(id => ({ name: id, version: "1.0" }))
          ).map(app => (
            <Flex key={app.name} p={3} mb={2} style={{ backgroundColor: "#111", borderRadius: 8, borderWidth: 1, borderColor: "#222" }} flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text variant="body" fontWeight="semiBold">
                {app.name.toUpperCase()}
              </Text>
              <Text variant="body" color="neutral.c70">
                v{app.version}
              </Text>
            </Flex>
          ))
        )}
        {/* Fallback: also show balances as apps if no installedApps */}
        {(!flex.profile?.installedApps || flex.profile.installedApps.length === 0) &&
          activeIds.length > 0 && (
            <Flex mt={4}>
              <Text variant="small" color="neutral.c70" mb={2}>
                Балансы:
              </Text>
              {activeIds.map(id => (
                <Flex key={`bal-${id}`} p={2} mb={1} style={{ backgroundColor: "#0f0f0f", borderRadius: 6 }} flexDirection="row" justifyContent="space-between">
                  <Text variant="small">{id}</Text>
                  <Text variant="small" color="neutral.c70">
                    {balances[id]}
                  </Text>
                </Flex>
              ))}
            </Flex>
          )}
      </Flex>
      <Flex>
        <Text variant="small" color="neutral.c70" textAlign="center">
          Это flex-устройство с десктопа (как в Manager → DeviceDashboard). Реальные Apps ставятся на десктопе.
        </Text>
      </Flex>
    </ScrollView>
  );
}
