// Registers the coin modules and the supported currency list, exactly as the
// app entry point does (src/live-common-setup.ts). Without it, both registries
// are empty in the test environment and every template build returns null
// before the coin-module gate can even be exercised.
import { coinModuleLoaders } from "@ledgerhq/live-common/coin-modules/loaders";
import {
  getRegisteredFamilies,
  registerCoinModules,
} from "@ledgerhq/live-common/coin-modules/registry";
import { setSupportedCurrencies } from "@ledgerhq/live-common/currencies/index";

import { buildFlexAccounts } from "./flexAccounts";

registerCoinModules(coinModuleLoaders);
setSupportedCurrencies([
  "bitcoin",
  "ethereum",
  "litecoin",
  "zcash",
  "ton",
  "monero",
] as never);

const BALANCES = {
  bitcoin: "108933247",
  ethereum: "12295824000000000000",
  litecoin: "142100000000",
  zcash: "54000000000",
  ton: "431000000000",
  // monero has NO coin module in this repo (upstream never shipped
  // @ledgerhq/coin-monero). A balance for it must not produce an Account:
  // the template would pass checkAccountSupported(), but Portfolio's bridge
  // layer throws `CurrencyNotSupported: No coin module registered for family
  // "monero"` and takes the whole React tree down (black screen).
  monero: "211000000000000",
};

describe("flexAccounts / coin-module gate", () => {
  it("builds accounts only for currencies whose family has a coin module", () => {
    const accounts = buildFlexAccounts(BALANCES, []);

    const ids = accounts.map(a => a.currency.id).sort();
    expect(ids).toEqual(["bitcoin", "ethereum", "litecoin", "ton", "zcash"]);
    expect(ids).not.toContain("monero");
  });

  it("never emits a family without a registered coin module", () => {
    const families = getRegisteredFamilies();
    const accounts = buildFlexAccounts(BALANCES, []);
    for (const account of accounts) {
      expect(families).toContain(account.currency.family);
    }
  });
});
