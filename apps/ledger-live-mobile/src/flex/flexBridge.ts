/**
 * FLEX fake account bridge (mobile port of the desktop
 * apps/ledger-live-desktop/src/renderer/mocks/fakeBridge.ts).
 *
 * Flex accounts are synthetic: they have no real coin-module resources
 * (bitcoinResources.walletAccount etc.), so the real bridges throw
 * AccountNeedResync — "Счёт устарел, его необходимо синхронизировать" — on
 * every send attempt. The desktop solves this by routing flex accounts
 * through a fake bridge (renderer/mocks/fakeBridge.ts, used in
 * renderer/modals/Send/Body.tsx). This module is the mobile equivalent,
 * used by the Send flow hooks for accounts whose id starts with "flex:".
 *
 * Signing/broadcast produce a mock operation and deduct the amount from the
 * flex server balances (single source of truth, same as desktop).
 */
import BigNumber from "bignumber.js";
import { of } from "rxjs";
import { AccountBridge } from "@ledgerhq/types-live";
import { Transaction } from "@ledgerhq/live-common/generated/types";
import { NotEnoughBalance } from "@ledgerhq/errors";

function mockEstimatedFees(family: string, t?: { feePerByte?: BigNumber }): BigNumber {
  if (family === "evm") return new BigNumber(21000).times(20e9);
  if (["bitcoin", "bitcoin_cash", "litecoin", "dogecoin", "zcash"].includes(family)) {
    const feePerByte = t?.feePerByte instanceof BigNumber ? t.feePerByte : new BigNumber(10);
    return feePerByte.times(140);
  }
  if (family === "solana") return new BigNumber(5000);
  if (family === "ton") return new BigNumber(5000000);
  return new BigNumber(10000);
}

function generateHash(prefix = "0x"): string {
  let hash = "";
  for (let i = 0; i < 64; i++) hash += Math.floor(Math.random() * 16).toString(16);
  return prefix + hash;
}

export const createFakeAccountBridge = (family: string): AccountBridge<Transaction> => {
  const dummyTx: Transaction = {
    family,
    mode: "send",
    amount: new BigNumber(0),
    recipient: "",
    useAllAmount: false,
    ...(family === "evm"
      ? { gasLimit: new BigNumber(21000), nonce: 0, chainId: 1, data: Buffer.from("") }
      : {}),
  } as unknown as Transaction;

  return {
    createTransaction: () => ({ ...dummyTx }),
    updateTransaction: (tx, patch) => ({ ...tx, ...patch }) as Transaction,
    prepareTransaction: async (_account, tx) => tx,
    getTransactionStatus: async (account: any, t: any) => {
      const errors: Record<string, unknown> = {};
      if (!t?.useAllAmount && !t?.recipient) {
        errors.recipient = { message: "A recipient address is required" };
      }
      const amount = t?.amount instanceof BigNumber ? t.amount : new BigNumber(t?.amount || 0);
      const estimatedFees = mockEstimatedFees(family, t);
      const spendable =
        account?.spendableBalance instanceof BigNumber
          ? account.spendableBalance
          : (account?.balance ?? null);
      const effectiveAmount =
        t?.useAllAmount && spendable ? BigNumber.max(spendable.minus(estimatedFees), 0) : amount;
      const totalSpent = effectiveAmount.plus(estimatedFees);
      if (spendable && totalSpent.gt(spendable)) {
        errors.amount = new NotEnoughBalance();
      }
      return {
        errors,
        warnings: {},
        amount: effectiveAmount,
        estimatedFees,
        totalSpent,
        valid: Object.keys(errors).length === 0,
        txInputs: [],
        txOutputs: [],
        expectedCurrency: undefined,
      } as any;
    },
    estimateMaxSpendable: (arg: any) => {
      const account = arg?.account;
      const spendable =
        account?.spendableBalance instanceof BigNumber
          ? account.spendableBalance
          : (account?.balance ?? new BigNumber(0));
      const fee = mockEstimatedFees(family, arg?.transaction);
      return Promise.resolve(BigNumber.max(spendable.minus(fee), 0));
    },
    signOperation: (arg0: any) => {
      const account = arg0?.account;
      const transaction = arg0?.transaction;
      const amount =
        transaction?.amount instanceof BigNumber
          ? transaction.amount
          : new BigNumber(transaction?.amount || 0);
      const effectiveAmount = BigNumber.max(
        transaction?.useAllAmount && account?.spendableBalance
          ? BigNumber.max(account.spendableBalance.minus(mockEstimatedFees(family)), 0)
          : amount,
        0,
      );
      return of({
        type: "signed" as const,
        signedOperation: {
          operation: {
            id: `flex-${Date.now()}`,
            accountId: account?.id || "",
            type: "OUT" as const,
            value: effectiveAmount,
            fee: mockEstimatedFees(family),
            date: new Date(),
            blockHeight: 99999999,
            hash: generateHash(),
            senders: [account?.freshAddress || ""],
            recipients: [transaction?.recipient || ""],
            status: "confirmed" as const,
            extra: {},
            blockHash: "",
            subOperations: [],
          },
          signature: "mock_signature",
        },
      } as any);
    },
    broadcast: async (arg0: any) => {
      const account = arg0?.account;
      const transaction = arg0?.transaction;
      const signedOperation = arg0?.signedOperation;
      const amount =
        signedOperation?.operation?.value instanceof BigNumber
          ? signedOperation.operation.value
          : (transaction?.amount ?? new BigNumber(0));
      const fee =
        signedOperation?.operation?.fee instanceof BigNumber
          ? signedOperation.operation.fee
          : mockEstimatedFees(family);
      return {
        id: `flex-${Date.now()}`,
        accountId: account?.id || "",
        hash: signedOperation?.operation?.hash || generateHash(),
        type: "OUT" as const,
        value: amount,
        fee,
        date: new Date(),
        blockHeight: 99999999,
        senders: [account?.freshAddress || ""],
        recipients: [transaction?.recipient || ""],
        status: "confirmed" as const,
        extra: {},
        blockHash: "",
        subOperations: [],
      } as any;
    },
    receive: async (account: any) => account?.freshAddress || "",
    isAccountEmpty: () => false,
    getStuckAccountAndOperation: () => undefined,
  } as unknown as AccountBridge<Transaction>;
};
