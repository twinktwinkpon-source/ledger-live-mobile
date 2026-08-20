import React, { PureComponent } from "react";
import { BigNumber } from "bignumber.js";
import { Unit } from "@ledgerhq/types-cryptoassets";
import { AccountLike } from "@ledgerhq/types-live";
import Box from "~/renderer/components/Box";
import FormattedVal from "~/renderer/components/FormattedVal";
import { isFlexBuild, getSpoofedBalance } from "~/renderer/mocks/fakeFlexBuild";
class Balance extends PureComponent<{
  unit: Unit;
  balance: BigNumber;
  disableRounding?: boolean;
  account?: AccountLike;
}> {
  render() {
    const { unit, balance, disableRounding, account } = this.props;
    // FLEX_DEMO: Component-level balance spoofing
    // Spoofed_Balance = Real_Redux_Balance.minus(Total_Sent).plus(Total_Received)
    const displayBalance =
      isFlexBuild() && account
        ? getSpoofedBalance(account, balance)
        : balance;
    return (
      <Box flex="30%" justifyContent="center" fontSize={4}>
        <FormattedVal
          alwaysShowSign={false}
          animateTicker={false}
          ellipsis
          color="neutral.c100"
          unit={unit}
          showCode
          val={displayBalance}
          disableRounding={disableRounding}
        />
      </Box>
    );
  }
}
export default Balance;
