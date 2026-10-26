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

describe("flexAccounts / server operations", () => {
  it("attaches server operations to the matching account and keeps their date/value", () => {
    const OPERATIONS = [
      {
        id: "flex-op-btc-3",
        hash: "a".repeat(64),
        currencyId: "bitcoin",
        amount: "100000000",
        fee: "1000",
        type: "IN",
        date: "2026-10-20T18:29:59Z",
        status: "confirmed",
        from: "1FLEXsender3",
        to: "1FLEXrecv3",
      },
      {
        id: "flex-op-btc-1",
        hash: "b".repeat(64),
        currencyId: "bitcoin",
        amount: "50000000",
        fee: "1000",
        type: "OUT",
        date: "2026-10-18T19:29:59Z",
        status: "confirmed",
        from: "1FLEXsender1",
        to: "1FLEXrecv1",
      },
      // Server may still report GRAM while the client normalises to ton.
      {
        id: "flex-op-gram-2",
        hash: "c".repeat(64),
        currencyId: "gram",
        amount: "400000000000",
        fee: "100000000",
        type: "IN",
        date: "2026-10-16T20:29:59Z",
        status: "confirmed",
        from: "EQflexsend",
        to: "EQflexrecv",
      },
      {
        id: "flex-op-xmr-1",
        hash: "d".repeat(64),
        currencyId: "monero",
        amount: "211000000000000",
        fee: "1000",
        type: "IN",
        date: "2026-10-15T10:00:00Z",
        status: "confirmed",
      },
    ];

    const accounts = buildFlexAccounts(BALANCES, OPERATIONS);

    const btc = accounts.find(a => a.currency.id === "bitcoin");
    expect(btc).toBeDefined();
    expect(btc.operations).toHaveLength(2);
    // newest first (push order preserved by the server)
    expect(btc.operations[0].id).toBe("flex-op-btc-3");
    expect(btc.operations[0].type).toBe("IN");
    expect(btc.operations[0].value.toString()).toBe("100000000");
    expect(btc.operations[0].date.toISOString()).toBe("2026-10-20T18:29:59.000Z");
    expect(btc.operations[0].senders).toEqual(["1FLEXsender3"]);
    expect(btc.operations[0].recipients).toEqual(["1FLEXrecv3"]);
    expect(btc.operations[1].type).toBe("OUT");

    const ton = accounts.find(a => a.currency.id === "ton");
    expect(ton).toBeDefined();
    // gram operations land on the ton account
    expect(ton.operations).toHaveLength(1);
    expect(ton.operations[0].id).toBe("flex-op-gram-2");

    // monero operations never create an account
    expect(accounts.find(a => a.currency.id === "monero")).toBeUndefined();
  });

  it("sets operationsCount so the UI history counters match the operations array", () => {
    const OPERATIONS = [
      {
        id: "flex-op-btc-9",
        hash: "e".repeat(64),
        currencyId: "bitcoin",
        amount: "1",
        fee: "1",
        type: "IN",
        date: "2026-10-22T00:00:00Z",
        status: "confirmed",
      },
    ];
    const btc = buildFlexAccounts(BALANCES, OPERATIONS).find(a => a.currency.id === "bitcoin");
    expect(btc.operationsCount).toBe(1);
  });
});
