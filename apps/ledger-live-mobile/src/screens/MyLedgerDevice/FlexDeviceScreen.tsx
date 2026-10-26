import React from "react";
import { Flex } from "@ledgerhq/native-ui";
import FlexDeviceView from "./FlexDeviceView";

export default function FlexDeviceScreen() {
  return (
    <Flex flex={1} bg="background.main">
      <FlexDeviceView />
    </Flex>
  );
}
