/**
 * @jest-environment jsdom
 */

import BigNumber from "bignumber.js";
import { isConfirmedOperation } from "@ledgerhq/live-common/operation";
import { getFakeAccounts } from "~/renderer/mocks/fakeFlexBuild";
import reducer, { accountsSelector, clearFlexCache } from "../accounts";

jest.mock("~/renderer/mocks/fakeFlexBuild", () => ({
  getFakeAccounts: jest.fn(),
  isFlexBuild: jest.fn(() => true),
  persistFakeOperations: jest.fn(),
  deductFromServerBalance: jest.fn(),
  applyMockSwapSpoof: jest.fn((account: any) => account),
  getFlexDemoSwapsHash: jest.fn(() => "hash"),
}));

const mockGetFakeAccounts = getFakeAccounts as jest.Mock;

const baseAccount: any = {
  id: "js:2:bitcoin:0:my-account",
  name: "BTC",
  type: "Account",
  currency: { id: "bitcoin", name: "Bitcoin", ticker: "BTC" },
  balance: new BigNumber(15000000000),
  spendableBalance: new BigNumber(15000000000),
  operations: [],
  pendingOperations: [],
};

// Read-only operation — mimics the broadcast result of the fake bridge, which is
// frozen. Mutating it in place previously threw inside sanitizeAccount and aborted
// finishWithSuccess, leaving the Send flow stuck on the gray spinner.
const frozenOp: any = Object.freeze({
  id: "op-frozen",
  hash: "0xabc",
  type: "OUT",
  value: new BigNumber(1000000),
  fee: new BigNumber(1000),
  blockHeight: null,
  confirmations: 0,
  status: "pending",
  date: new Date("2026-01-01"),
});

describe("sanitizeAccount (via accountsSelector)", () => {
  beforeEach(() => {
    clearFlexCache();
  });

  it("does not throw on read-only operations and clones them before patching", () => {
    mockGetFakeAccounts.mockReturnValue([{ ...baseAccount, operations: [frozenOp] }]);

    const result = accountsSelector({ accounts: [] } as any);
    const outputOp = result[0].operations[0] as any;

    expect(outputOp).not.toBe(frozenOp);
    expect(outputOp.confirmations).toBe(99999);
    expect(outputOp.status).toBe("confirmed");
    expect(outputOp.blockHeight).toBe(98999999);
    expect(outputOp.id).toBe("op-frozen");

    // blockHeight must be below the account's so Ledger's own confirmation
    // logic (account.blockHeight - op.blockHeight + 1 >= nb) marks the
    // operation as confirmed — otherwise the mvvm History shows it as pending.
    expect(isConfirmedOperation(outputOp, result[0], 3)).toBe(true);

    // The source operation must not be mutated (it is read-only)
    expect(frozenOp.confirmations).toBe(0);
    expect(frozenOp.status).toBe("pending");
  });

  it("patches pending operations too without mutating the source", () => {
    mockGetFakeAccounts.mockReturnValue([{ ...baseAccount, pendingOperations: [frozenOp] }]);

    const result = accountsSelector({ accounts: [] } as any);
    const outputOp = result[0].pendingOperations[0] as any;

    expect(outputOp).not.toBe(frozenOp);
    expect(outputOp.confirmations).toBe(99999);
    expect(frozenOp.confirmations).toBe(0);
  });

  it("drops operations pre-seeded at the fake chain tip below it so they stay confirmed", () => {
    // createShuffleOperation seeds ops with blockHeight === account.blockHeight
    const tipOp = { ...frozenOp, id: "op-at-tip", blockHeight: 99999999, confirmations: 99999 };
    mockGetFakeAccounts.mockReturnValue([{ ...baseAccount, operations: [tipOp] }]);

    const result = accountsSelector({ accounts: [] } as any);
    const outputOp = result[0].operations[0] as any;

    expect(outputOp.blockHeight).toBe(98999999);
    expect(isConfirmedOperation(outputOp, result[0], 3)).toBe(true);
  });
});

describe("UPDATE_ACCOUNT reducer (flex)", () => {
  beforeEach(() => {
    clearFlexCache();
    mockGetFakeAccounts.mockReturnValue([{ ...baseAccount }]);
  });

  it("does not throw when the updater result contains a read-only operation and still updates flexCache", () => {
    // Populate flexCache the same way the app does (via accountsSelector during render)
    accountsSelector({ accounts: [] } as any);

    // The broadcast dispatch that previously crashed on the frozen op
    reducer([{ ...baseAccount }], {
      type: "UPDATE_ACCOUNT",
      payload: {
        accountId: baseAccount.id,
        updater: (account: any) => ({
          ...account,
          pendingOperations: [frozenOp],
        }),
      },
    });

    // The UI reads flexCache through accountsSelector after the dispatch
    const result = accountsSelector({ accounts: [] } as any);

    expect(result[0].operations[0].id).toBe("op-frozen");
    expect(result[0].operations[0]).not.toBe(frozenOp);
    expect((result[0].operations[0] as any).confirmations).toBe(99999);
    expect(result[0].pendingOperations).toHaveLength(0);
    // balance = 150 BTC - value - fee
    expect(result[0].balance.toString()).toBe("14998999000");
    expect(frozenOp.confirmations).toBe(0);
    expect(frozenOp.status).toBe("pending");
  });
});
