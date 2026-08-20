/**
 * Fake Bridge - Mocks AccountBridge methods to prevent crashes in flex/demo builds.
 *
 * The real getAccountBridge() crashes for fake currencies because coin modules
 * aren't registered. This module provides drop-in replacements.
 *
 * IMPORTANT: Accounts must use REAL currencies from CAL (getCryptoCurrencyById)
 * so that getAccountBridge can find them. This file only provides the
 * useAccountBridge/useBridgeTransaction hook replacements.
 */
import { useState, useMemo, useCallback } from "react";
import { BigNumber } from "bignumber.js";
import { of, tap } from "rxjs";
import { Account, AccountLike, AccountBridge } from "@ledgerhq/types-live";
import { Transaction } from "@ledgerhq/live-common/generated/types";

// ---------------------------------------------------------------------------
// TON mock constants
// ---------------------------------------------------------------------------
const TON_SENDER = "UQDZ6qc0H749QllYLsLhnnZk0gUN7ln2gQ1qkgU70eiaY8dS";

// Monotonic counter so each fake operation has a unique transactionSequenceNumber,
// preventing addPendingOperation from deduplicating them (undefined !== undefined = false).
// Persisted to localStorage so the counter survives restarts.
const FLEX_SEQ_KEY = "flex_demo_seq_counter";
let _opSequenceCounter = (() => {
  try {
    return parseInt(localStorage.getItem(FLEX_SEQ_KEY) || "0", 10);
  } catch {
    return 0;
  }
})();

// ---------------------------------------------------------------------------
// Dummy transaction - covers all required fields for every family
// ---------------------------------------------------------------------------
const createDummyTx = (family: string = "evm"): Transaction => {
  const baseTx = {
    family,
    mode: "send",
    amount: new BigNumber(0),
    recipient: "",
    useAllAmount: false,
    subAccountId: undefined,
  };

  // Bitcoin family requires feeStrategy, strategy, networkInfo with feeItems,
  // utxoStrategy, rbf, feePerByte
  if (
    family === "bitcoin" ||
    family === "bitcoin_cash" ||
    family === "litecoin" ||
    family === "dogecoin"
  ) {
    return {
      ...baseTx,
      feeStrategy: "medium",
      strategy: "medium",
      feePerByte: new BigNumber(10),
      rbf: false,
      networkInfo: {
        family: "bitcoin",
        feeItems: {
          items: [{ key: "1", speed: "medium", feePerByte: "10" }],
          defaultFeePerByte: "10",
        },
      },
      utxoStrategy: {
        strategy: 0,
        excludeUTXOs: [],
      },
    } as Transaction;
  }

  // EVM family
  if (family === "evm") {
    return {
      ...baseTx,
      gasPrice: undefined,
      gasLimit: new BigNumber(21000),
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      nonce: 0,
      chainId: 1,
      data: Buffer.from(""),
    } as Transaction;
  }

  // Solana family
  if (family === "solana") {
    return {
      ...baseTx,
      recentBlockhash: "",
      feePayer: "",
    } as Transaction;
  }

  return baseTx as Transaction;
};

// ---------------------------------------------------------------------------
// Empty status
// ---------------------------------------------------------------------------
const EMPTY_STATUS = {
  errors: {},
  warnings: {},
  amount: new BigNumber(0),
  estimatedFees: new BigNumber(100),
  totalSpent: new BigNumber(100),
  valid: true,
  txInputs: [],
  txOutputs: [],
  expectedCurrency: undefined,
} as any;

// ---------------------------------------------------------------------------
// Generate unique TON-style 64-char hex hash
// ---------------------------------------------------------------------------
function generateTonHash(): string {
  let hash = "";
  for (let i = 0; i < 64; i++) {
    hash += Math.floor(Math.random() * 16).toString(16);
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Fake AccountBridge factory - creates bridge per family
// ---------------------------------------------------------------------------
const createFakeAccountBridge = (family: string): AccountBridge<Transaction> => {
  const dummyTx = createDummyTx(family);

  return {
    createTransaction: () => ({ ...dummyTx }) as Transaction,
    updateTransaction: (tx: Transaction, patch: Partial<Transaction>) =>
      ({ ...tx, ...patch }) as Transaction,
    prepareTransaction: async (_account: AccountLike, tx: Transaction) => tx,
    getTransactionStatus: async (_account: any, t: any) => {
      const errors: Record<string, any> = {};
      if (!t?.useAllAmount && !t?.recipient) {
        errors.recipient = { message: "A recipient address is required" };
      }
      const amount = t?.amount instanceof BigNumber ? t.amount : new BigNumber(t?.amount || 0);
      const estimatedFees = new BigNumber(100);
      return {
        errors,
        warnings: {},
        amount,
        estimatedFees,
        totalSpent: amount.plus(estimatedFees),
        valid: Object.keys(errors).length === 0,
        txInputs: [],
        txOutputs: [],
        expectedCurrency: undefined,
      };
    },
    estimateMaxSpendable: (arg: any) => {
      return Promise.resolve(arg.account.spendableBalance || arg.account.balance);
    },
    signOperation: (arg0: any) => {
      const account = arg0?.account;
      const transaction = arg0?.transaction;
      const isTon = account?.currency?.id === "ton";

      // Realistic TON fee: ~0.005 TON in nanotons = 5,000,000
      const tonFee = isTon ? new BigNumber(5000000) : new BigNumber(0);

      // Ensure amount is always BigNumber
      const amount =
        transaction?.amount instanceof BigNumber
          ? transaction.amount
          : new BigNumber(transaction?.amount || 0);

      // Unique hash for each transaction
      const txHash = isTon ? generateTonHash() : `0x${generateTonHash()}`;
      const seqNum = new BigNumber(++_opSequenceCounter);
      try {
        localStorage.setItem(FLEX_SEQ_KEY, String(_opSequenceCounter));
      } catch {}

      return of({
        type: "signed" as const,
        signedOperation: {
          operation: {
            id: isTon ? `flex-ton-${Date.now()}` : `flex-${Date.now()}`,
            accountId: account?.id || "",
            type: "OUT" as const,
            value: amount,
            fee: tonFee,
            date: new Date(),
            blockHeight: 0,
            hash: txHash,
            senders: isTon ? [TON_SENDER] : [account?.freshAddress || ""],
            recipients: [transaction?.recipient || ""],
            status: "confirmed" as const,
            extra: {},
            blockHash: "",
            subOperations: [],
            transactionSequenceNumber: seqNum,
          },
          signature: "mock_signature",
        },
      } as any).pipe(
        tap(async () => {
          if (isTon && account && amount.gt(0)) {
            const fee = tonFee || new BigNumber(0);
            const newBalance = account.balance.minus(amount).minus(fee);
            try {
              const { deductFromServerBalance } = await import("~/renderer/mocks/fakeFlexBuild");
              deductFromServerBalance(account.currency.id, amount, fee);
            } catch (e) {
              console.warn("Failed to deduct balance", e);
            }
          }
        }),
      );
    },
    broadcast: async (arg0: any) => {
      const account = arg0?.account;
      const transaction = arg0?.transaction;
      const signedOperation = arg0?.signedOperation;
      const isTon = account?.currency?.id === "ton" || family === "ton";

      if (isTon) {
        const amount =
          signedOperation?.operation?.value instanceof BigNumber
            ? signedOperation.operation.value
            : transaction?.amount instanceof BigNumber
              ? transaction.amount
              : new BigNumber(0);
        const fee =
          signedOperation?.operation?.fee instanceof BigNumber
            ? signedOperation.operation.fee
            : new BigNumber(5000000);
        const hash = signedOperation?.operation?.hash || generateTonHash();

        return {
          id: `flex-ton-${Date.now()}`,
          hash,
          type: "OUT" as const,
          value: amount,
          fee,
          date: new Date(),
          blockHeight: 0,
          senders: [TON_SENDER],
          recipients: [transaction?.recipient || ""],
          status: "confirmed" as const,
          extra: {},
          blockHash: "",
        } as any;
      }

      return {
        id: `flex-${Date.now()}`,
        hash: `0x${generateTonHash()}`,
        type: "OUT",
        value: new BigNumber(0),
        fee: new BigNumber(0),
        date: new Date(),
        blockHeight: 0,
        senders: [],
        recipients: [],
        status: "confirmed",
        extra: {},
        blockHash: "",
      } as any;
    },
    receive: async () => "",
    // Required by AccountHeaderActions.tsx (line: bridge.isAccountEmpty(account))
    isAccountEmpty: () => false,
    // Required by StepRecipient.tsx (line: bridge?.getStuckAccountAndOperation(account, parentAccount))
    getStuckAccountAndOperation: () => undefined,
  } as unknown as AccountBridge<Transaction>;
};

// ---------------------------------------------------------------------------
// useFakeAccountBridge - drop-in for useAccountBridge from live-common
// ---------------------------------------------------------------------------
export function useFakeAccountBridge<T = Transaction>(
  _account?: AccountLike | null,
  _parentAccount?: Account | null,
): AccountBridge<T> {
  // Get family from account if available
  const family =
    _account && "currency" in _account ? (_account as Account).currency?.family ?? "evm" : "evm";
  return createFakeAccountBridge(family) as unknown as AccountBridge<T>;
}

// Also export as useAccountBridgeOrNull name for StepRecipient
export const useFakeAccountBridgeOrNull = useFakeAccountBridge;

// ---------------------------------------------------------------------------
// useFakeBridgeTransaction - drop-in for useBridgeTransaction from live-common
//
// The real useBridgeTransaction internally calls getAccountBridge which
// crashes for fake accounts. This replaces the entire hook.
// ---------------------------------------------------------------------------
export function useFakeBridgeTransaction(
  _bridge: AccountBridge<any>,
  initFn: () => {
    account: AccountLike | null;
    parentAccount?: Account | null;
    transaction?: Transaction;
  },
) {
  const init = initFn();
  const account = init.account;
  const parentAccount = init.parentAccount ?? null;

  // Determine family from account
  const family =
    account && "currency" in account ? (account as Account).currency?.family ?? "evm" : "evm";

  // Initial transaction - use family-appropriate dummy
  const [transaction, setTransactionState] = useState<Transaction>(() => {
    return (init.transaction as Transaction) ?? createDummyTx(family);
  });

  const [status, setStatus] = useState(EMPTY_STATUS);

  const setTransaction = useCallback((tx: Transaction) => {
    setTransactionState(tx);
  }, []);

  const updateTransaction = useCallback(
    (updater: Transaction | ((tx: Transaction) => Transaction)) => {
      if (typeof updater === "function") {
        setTransactionState(prev => updater(prev));
      } else {
        setTransactionState(updater);
      }
    },
    [],
  );

  // Immediately resolve status (no network calls)
  useMemo(() => {
    if (account && transaction) {
      createFakeAccountBridge(family)
        .getTransactionStatus(account as Account, transaction)
        .then(setStatus);
    }
  }, [account, transaction, family]);

  return {
    transaction,
    setTransaction,
    updateTransaction,
    account,
    parentAccount,
    setAccount: () => {},
    updateAccount: () => {},
    status,
    bridgeError: null,
    bridgePending: false,
  };
}
