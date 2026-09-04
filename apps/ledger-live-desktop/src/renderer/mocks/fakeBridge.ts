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
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { BigNumber } from "bignumber.js";
import { of, tap } from "rxjs";
import {
  Account,
  AccountLike,
  AccountBridge,
  SignedOperation,
  Operation,
  BroadcastConfig,
  TransactionSource,
  TransactionCommon,
} from "@ledgerhq/types-live";
import type { LogEvent } from "@ledgerhq/live-common/hooks/useBroadcast";
import { NotEnoughBalance } from "@ledgerhq/errors";
import { Transaction } from "@ledgerhq/live-common/generated/types";
import { Action, Device } from "@ledgerhq/live-common/hw/actions/types";
import { getEnv } from "@ledgerhq/live-env";
import { getMainAccount } from "@ledgerhq/live-common/account/index";
import { getFakeDevice } from "./fakeFlexBuild";

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
  // utxoStrategy, rbf, feePerByte. feeItems must contain real BigNumber
  // feePerByte values (one per speed preset) so the bitcoin send descriptor's
  // getOptions() filter (isBigNumber) keeps them and the fee picker shows
  // distinct slow/medium/fast options.
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
      feesStrategy: "medium",
      feePerByte: new BigNumber(5),
      rbf: false,
      networkInfo: {
        family: "bitcoin",
        feeItems: {
          items: [
            { key: "slow", speed: "slow", feePerByte: new BigNumber(2) },
            { key: "medium", speed: "medium", feePerByte: new BigNumber(5) },
            { key: "fast", speed: "fast", feePerByte: new BigNumber(10) },
          ],
          defaultFeePerByte: new BigNumber(5),
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
// Realistic mock network fees (in smallest units) so the UI never shows $0.00.
// EVM: 21k gas x ~20 gwei. Bitcoin family: feePerByte x ~140 bytes. Others get
// a small but non-zero placeholder.
// ---------------------------------------------------------------------------
function mockEstimatedFees(family: string, t?: any): BigNumber {
  if (family === "evm") return new BigNumber(21000).times(20e9);
  if (["bitcoin", "bitcoin_cash", "litecoin", "dogecoin"].includes(family)) {
    const feePerByte = t?.feePerByte instanceof BigNumber ? t.feePerByte : new BigNumber(10);
    return feePerByte.times(140);
  }
  if (family === "solana") return new BigNumber(5000);
  if (family === "ton") return new BigNumber(5000000);
  return new BigNumber(10000);
}

// ---------------------------------------------------------------------------
// Empty status
// ---------------------------------------------------------------------------
const EMPTY_STATUS = {
  errors: {},
  warnings: {},
  amount: new BigNumber(0),
  estimatedFees: mockEstimatedFees("evm"),
  totalSpent: mockEstimatedFees("evm"),
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
export const createFakeAccountBridge = (family: string): AccountBridge<Transaction> => {
  const dummyTx = createDummyTx(family);

  return {
    createTransaction: () => ({ ...dummyTx }) as Transaction,
    updateTransaction: (tx: Transaction, patch: Partial<Transaction>) =>
      ({ ...tx, ...patch }) as Transaction,
    prepareTransaction: async (_account: AccountLike, tx: Transaction) => {
      // Mirror the real bitcoin bridge's inferFeePerByte: when a feesStrategy
      // is set, pick the matching preset's feePerByte so the fee picker (and
      // the estimated fee) react to slow/medium/fast instead of staying frozen
      // at the initial value.
      const family = tx.family;
      if (
        family === "bitcoin" ||
        family === "bitcoin_cash" ||
        family === "litecoin" ||
        family === "dogecoin"
      ) {
        const strategy = tx.feesStrategy;
        if (strategy && strategy !== "custom") {
          const items = (tx as any).networkInfo?.feeItems?.items as
            | { speed: string; feePerByte: BigNumber }[]
            | undefined;
          const item = items?.find(i => i.speed === strategy);
          if (item && BigNumber.isBigNumber(item.feePerByte)) {
            return { ...tx, feePerByte: item.feePerByte };
          }
        }
      }
      return tx;
    },
    getTransactionStatus: async (_account: any, t: any) => {
      const errors: Record<string, any> = {};
      if (!t?.useAllAmount && !t?.recipient) {
        errors.recipient = { message: "A recipient address is required" };
      }
      const amount = t?.amount instanceof BigNumber ? t.amount : new BigNumber(t?.amount || 0);
      const family = _account?.currency?.family ?? "evm";
      const estimatedFees = mockEstimatedFees(family, t);
      // FLEX: honor useAllAmount like the real bridges — fill amount with
      // spendable minus fees so the native "MAX" button shows the right value.
      const spendable =
        _account?.spendableBalance instanceof BigNumber
          ? _account.spendableBalance
          : _account?.balance instanceof BigNumber
            ? _account.balance
            : null;
      const effectiveAmount =
        t?.useAllAmount && spendable ? BigNumber.max(spendable.minus(estimatedFees), 0) : amount;
      const totalSpent = effectiveAmount.plus(estimatedFees);
      // FLEX: mirror the real bridges' balance check. Without it any amount was
      // accepted and the balance went negative after broadcast (deductFromServer
      // subtracts from the server balance). When useAllAmount is set the bridge
      // itself fills amount = balance - fees, so totalSpent == spendable and passes.
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
      };
    },
    estimateMaxSpendable: (arg: any) => {
      const account = arg?.account;
      const spendable =
        account?.spendableBalance instanceof BigNumber
          ? account.spendableBalance
          : account?.balance instanceof BigNumber
            ? account.balance
            : new BigNumber(0);
      // Native bridges return max spendable NET of fees so "MAX" leaves the
      // balance at exactly zero instead of negative.
      const fee = mockEstimatedFees(account?.currency?.family ?? "evm", arg?.transaction);
      return Promise.resolve(BigNumber.max(spendable.minus(fee), 0));
    },
    signOperation: (arg0: any) => {
      const account = arg0?.account;
      const transaction = arg0?.transaction;
      const isTon = account?.currency?.id === "ton";

      // Realistic mock fee per family; TON in nanotons = 5,000,000
      const tonFee = isTon
        ? new BigNumber(5000000)
        : mockEstimatedFees(account?.currency?.family ?? "evm", transaction);

      // Ensure amount is always BigNumber
      const amount =
        transaction?.amount instanceof BigNumber
          ? transaction.amount
          : new BigNumber(transaction?.amount || 0);

      // FLEX: honor useAllAmount (MAX) — deduct what the status actually computed
      // (spendable - fees), not the raw tx.amount which stays 0 when MAX is used.
      const allAmountBalance =
        transaction?.useAllAmount && account
          ? (account.spendableBalance instanceof BigNumber
              ? account.spendableBalance
              : account.balance) instanceof BigNumber
            ? (account.spendableBalance instanceof BigNumber
                ? account.spendableBalance
                : account.balance
              ).minus(tonFee)
            : amount
          : amount;
      const effectiveAmount = BigNumber.max(
        transaction?.useAllAmount ? allAmountBalance : amount,
        0,
      );

      // Unique hash for each transaction
      const txHash = isTon ? generateTonHash() : `0x${generateTonHash()}`;
      const seqNum = new BigNumber(++_opSequenceCounter);
      try {
        localStorage.setItem(FLEX_SEQ_KEY, String(_opSequenceCounter));
      } catch {
        void 0;
      }

      return of({
        type: "signed" as const,
        signedOperation: {
          operation: {
            id: isTon ? `flex-ton-${Date.now()}` : `flex-${Date.now()}`,
            accountId: account?.id || "",
            type: "OUT" as const,
            value: effectiveAmount,
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
          if (account && effectiveAmount.gt(0)) {
            const fee = tonFee || new BigNumber(0);
            try {
              const { deductFromServerBalance } = await import("~/renderer/mocks/fakeFlexBuild");
              deductFromServerBalance(account.currency.id, effectiveAmount, fee);
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
          accountId: account?.id || "",
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
          subOperations: [],
        } as any;
      }

      const amount =
        signedOperation?.operation?.value instanceof BigNumber
          ? signedOperation.operation.value
          : transaction?.amount instanceof BigNumber
            ? transaction.amount
            : new BigNumber(0);
      const fee =
        signedOperation?.operation?.fee instanceof BigNumber
          ? signedOperation.operation.fee
          : new BigNumber(10000);
      const hash = signedOperation?.operation?.hash || `0x${generateTonHash()}`;

      return {
        id: `flex-${Date.now()}`,
        accountId: account?.id || "",
        hash,
        type: "OUT",
        value: amount,
        fee,
        date: new Date(),
        blockHeight: 0,
        senders: [account?.freshAddress || ""],
        recipients: [transaction?.recipient || ""],
        status: "confirmed",
        extra: {},
        blockHash: "",
        subOperations: [],
      } as any;
    },
    receive: async (account: any) => account?.freshAddress || "",
    // Required by AccountHeaderActions.tsx (line: bridge.isAccountEmpty(account))
    isAccountEmpty: () => false,
    // Required by StepRecipient.tsx (line: bridge?.getStuckAccountAndOperation(account, parentAccount))
    getStuckAccountAndOperation: () => undefined,
  } as unknown as AccountBridge<Transaction>;
};

// ---------------------------------------------------------------------------
// useFakeAccountBridge - drop-in for useAccountBridge from live-common
// ---------------------------------------------------------------------------
export function useFakeAccountBridge<T extends TransactionCommon = Transaction>(
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
      const bridge = createFakeAccountBridge(family);
      bridge
        .prepareTransaction(account as Account, transaction)
        .then(prepared => bridge.getTransactionStatus(account as Account, prepared))
        .then(setStatus);
    }
  }, [account, transaction, family]);

  return {
    transaction,
    setTransaction,
    updateTransaction,
    account,
    parentAccount,
    setAccount: (_account: AccountLike, _parentAccount?: Account | null) => {},
    updateAccount: () => {},
    status,
    bridgeError: null,
    bridgePending: false,
  };
}

// ---------------------------------------------------------------------------
// Mock Transaction Action - makes native DeviceAction render device animation
// without a real hardware device. The mock action feeds state into the
// UNTOUCHED native DeviceAction component so it renders TransactionConfirm
// (with Lottie animation) just like a real signing flow.
// ---------------------------------------------------------------------------
type TransactionRequest = {
  tokenCurrency?: unknown;
  parentAccount: Account | null | undefined;
  account: AccountLike;
  transaction: Transaction;
  status?: unknown;
  appName?: string;
  manifestId?: string;
  manifestName?: string;
};

type TransactionState = {
  // AppState fields
  isLoading: boolean;
  requestQuitApp: boolean;
  requestOpenApp: string | null | undefined;
  requiresAppInstallation: unknown;
  opened: boolean;
  appAndVersion: { name: string; version: string; flags: number } | null;
  unresponsive: boolean;
  allowOpeningRequestedWording: string | null | undefined;
  allowOpeningGranted: boolean;
  allowManagerRequested: boolean;
  allowManagerGranted: boolean;
  device: Device | null | undefined;
  deviceInfo: unknown;
  deviceId: unknown;
  latestFirmware: unknown;
  error: Error | null | undefined;
  derivation: unknown;
  displayUpgradeWarning: boolean;
  isLocked: boolean;
  skippedAppOps: unknown[];
  listedApps: boolean;
  request: unknown;
  deviceDeprecationRules?: unknown;
  onRetry: () => void;
  passWarning: () => void;
  inWrongDeviceForAccount: unknown;
  // TransactionState fields
  signedOperation: SignedOperation | null | undefined;
  deviceSignatureRequested: boolean;
  deviceStreamingProgress: number | null | undefined;
  transactionSignError: Error | null | undefined;
  transactionChecksOptInTriggered: boolean;
  transactionChecksOptIn: boolean | null;
  manifestId?: string;
  manifestName?: string;
};

type TransactionResult =
  | { signedOperation: SignedOperation; device: Device; swapId?: string }
  | { transactionSignError: Error };

const FAKE_APP_AND_VERSION = {
  name: "Ethereum",
  version: "2.1.0",
  flags: 0,
};

export function createFakeTransactionAction(): Action<
  TransactionRequest,
  TransactionState,
  TransactionResult
> {
  return {
    useHook: (
      _device: Device | null | undefined,
      request: TransactionRequest,
    ): TransactionState => {
      const fakeDevice = useMemo(() => getFakeDevice(), []);
      const [phase, setPhase] = useState<"loading" | "signing" | "signed">("loading");
      const [signedOperation, setSignedOperation] = useState<SignedOperation | null>(null);
      const [transactionSignError, setTransactionSignError] = useState<Error | null>(null);

      const family =
        request?.account && "currency" in request.account
          ? (request.account as Account).currency?.family ?? "evm"
          : "evm";

      // The real bridge's status object (and therefore the DeviceAction request)
      // can churn identity while the user is on the signature screen. Restarting
      // the signing effect on every such change would keep killing the timers
      // below, so signing would never complete. Hold the latest request in a ref
      // instead and only start the fake flow once, keyed on stable identity.
      const requestRef = useRef(request);
      requestRef.current = request;

      useEffect(() => {
        const currentRequest = requestRef.current;
        if (!currentRequest || !currentRequest.transaction) return;

        let cancelled = false;
        setPhase("loading");
        setSignedOperation(null);
        setTransactionSignError(null);
        console.log("[FlexSend] fake signing effect started, family", family);

        // Phase 1: Loading (2.5s) — renderLoading() shows natively
        const timer1 = setTimeout(() => {
          if (cancelled) return;
          setPhase("signing");
          console.log("[FlexSend] fake signing phase=signing");

          // Phase 2: Signing with device animation (2.5s) — TransactionConfirm renders natively
          const timer2 = setTimeout(() => {
            if (cancelled) return;

            // Use the fake bridge to sign the transaction
            const fakeBridge = createFakeAccountBridge(family);
            const mainAccount = getMainAccount(
              currentRequest.account,
              currentRequest.parentAccount,
            );

            const sub = fakeBridge
              .signOperation({
                account: mainAccount,
                transaction: currentRequest.transaction,
                deviceId: fakeDevice.deviceId,
                deviceModelId: fakeDevice.modelId,
              })
              .subscribe({
                next: (e: any) => {
                  if (cancelled) return;
                  if (e.type === "signed" && e.signedOperation) {
                    console.log("[FlexSend] fake signing produced signedOperation");
                    setSignedOperation(e.signedOperation);
                    setPhase("signed");
                  }
                },
                error: (err: Error) => {
                  if (cancelled) return;
                  console.log("[FlexSend] fake signing error", err);
                  setTransactionSignError(err);
                  setPhase("signed");
                },
              });

            return () => sub.unsubscribe();
          }, 2500);

          return () => clearTimeout(timer2);
        }, 2500);

        return () => {
          cancelled = true;
          clearTimeout(timer1);
        };
        // Deliberately keyed ONLY on stable identity (family/device), NOT on the
        // request object: status churn from the real bridge must not restart the
        // fake signing flow. The internal timers drive loading->signing->signed.
      }, [family, fakeDevice]);

      const baseState: TransactionState = {
        isLoading: false,
        requestQuitApp: false,
        requestOpenApp: null,
        requiresAppInstallation: null,
        opened: true,
        appAndVersion: FAKE_APP_AND_VERSION,
        unresponsive: false,
        allowOpeningRequestedWording: null,
        allowOpeningGranted: false,
        allowManagerRequested: false,
        allowManagerGranted: false,
        device: fakeDevice,
        deviceInfo: null,
        deviceId: null,
        latestFirmware: null,
        error: null,
        derivation: null,
        displayUpgradeWarning: false,
        isLocked: false,
        skippedAppOps: [],
        listedApps: false,
        request: undefined,
        onRetry: () => {},
        passWarning: () => {},
        inWrongDeviceForAccount: null,
        signedOperation: null,
        deviceSignatureRequested: false,
        deviceStreamingProgress: null,
        transactionSignError: null,
        transactionChecksOptInTriggered: false,
        transactionChecksOptIn: null,
        manifestId: request?.manifestId,
        manifestName: request?.manifestName,
      };

      if (phase === "loading") {
        return { ...baseState, isLoading: true, device: null };
      }

      if (phase === "signing") {
        return {
          ...baseState,
          isLoading: false,
          device: fakeDevice,
          opened: true,
          appAndVersion: FAKE_APP_AND_VERSION,
          allowOpeningGranted: false,
          deviceSignatureRequested: true,
        };
      }

      // phase === "signed"
      return {
        ...baseState,
        isLoading: false,
        device: fakeDevice,
        opened: true,
        appAndVersion: FAKE_APP_AND_VERSION,
        deviceSignatureRequested: false,
        signedOperation,
        transactionSignError,
      };
    },
    mapResult: (state: TransactionState): TransactionResult | null | undefined => {
      if (state.signedOperation && state.device) {
        return { signedOperation: state.signedOperation, device: state.device };
      }
      if (state.transactionSignError) {
        return { transactionSignError: state.transactionSignError };
      }
      return null;
    },
  };
}

export function useFakeTransactionAction(): Action<
  TransactionRequest,
  TransactionState,
  TransactionResult
> {
  return useMemo(() => createFakeTransactionAction(), []);
}

// ---------------------------------------------------------------------------
// Fake rename-device action - drives the NATIVE DeviceAction rename phase
// machine (loading -> "allow rename on device" -> renamed) without hardware.
// The desktop UI then plays the same screens as with a real Nano: native
// loading spinner, the renderAllowManager({requestType:"rename"}) device
// illustration, then the native success state in EditDeviceName.
// ---------------------------------------------------------------------------
type FakeRenameState = {
  isLoading: boolean;
  allowRenamingRequested: boolean;
  unresponsive: boolean;
  device: Device | null | undefined;
  deviceInfo: null;
  error: null;
  completed: boolean;
  name: string;
  onRetry: () => void;
};

export function createFakeRenameDeviceAction(): Action<
  { name: string },
  FakeRenameState,
  string
> {
  return {
    useHook: (_device, request) => {
      const fakeDevice = useMemo(() => getFakeDevice(), []);
      const [phase, setPhase] = useState<"loading" | "permission" | "renamed">("loading");
      const name = request?.name ?? "";

      useEffect(() => {
        let cancelled = false;
        setPhase("loading");
        // Phase 1 (~1.8s): loading — native renderLoading().
        const timer1 = setTimeout(() => {
          if (cancelled) return;
          // Phase 2 (~2.8s): device asks to allow the rename — native
          // renderAllowManager({ requestType: "rename" }) illustration.
          setPhase("permission");
        }, 1800);
        // Phase 3: renamed — payload becomes truthy, OnResult fires -> the
        // caller shows the native "name changed to ..." success screen.
        const timer2 = setTimeout(() => {
          if (cancelled) return;
          setPhase("renamed");
        }, 4600);
        return () => {
          cancelled = true;
          clearTimeout(timer1);
          clearTimeout(timer2);
        };
      }, [name, fakeDevice]);

      return {
        isLoading: phase === "loading",
        allowRenamingRequested: phase === "permission",
        unresponsive: false,
        device: fakeDevice,
        deviceInfo: null,
        error: null,
        completed: phase === "renamed",
        name: phase === "renamed" ? name : "",
        onRetry: () => {},
      };
    },
    mapResult: (state: FakeRenameState) => (state.completed ? state.name : ""),
  };
}

// ---------------------------------------------------------------------------
// useFakeBroadcast - drop-in for useBroadcast from live-common
//
// The real useBroadcast calls getAccountBridge() which returns a real bridge
// that tries to broadcast on the blockchain. In flex/mock mode, we need to
// use the fake bridge's broadcast() instead.
// ---------------------------------------------------------------------------
type CommonLogEvent = {
  appVersion: string;
  source?: TransactionSource;
  currencyId: string;
  family: string;
  tokenId?: string;
};

export function useFakeBroadcast({
  account,
  parentAccount,
  broadcastConfig,
  logger,
}: {
  account?: AccountLike | null;
  parentAccount?: Account | null;
  broadcastConfig?: BroadcastConfig;
  logger?: (event: LogEvent) => void;
}) {
  return useCallback(
    async (signedOperation: SignedOperation): Promise<Operation> => {
      console.log("[FlexSend] useFakeBroadcast start", signedOperation);
      if (!account) throw new Error("account not present");
      const mainAccount = getMainAccount(account, parentAccount);

      if (getEnv("DISABLE_TRANSACTION_BROADCAST")) {
        console.log("[FlexSend] useFakeBroadcast DISABLE_TRANSACTION_BROADCAST -> optimistic op");
        return Promise.resolve(signedOperation.operation);
      }

      const family =
        mainAccount && "currency" in mainAccount
          ? (mainAccount as Account).currency?.family ?? "evm"
          : "evm";

      const fakeBridge = createFakeAccountBridge(family);
      const operation = await fakeBridge.broadcast({
        account: mainAccount,
        signedOperation,
        broadcastConfig,
      });
      console.log("[FlexSend] useFakeBroadcast resolved", operation);

      const commonLogEvent: CommonLogEvent = {
        appVersion: getEnv("LEDGER_CLIENT_VERSION"),
        source: broadcastConfig?.source,
        currencyId: mainAccount.currency.id,
        family: mainAccount.currency.family,
        ...(account.type === "TokenAccount" ? { tokenId: account.token.id } : {}),
      };

      if (logger) {
        logger({
          status: "success",
          ...commonLogEvent,
        });
      }

      return operation;
    },
    [account, parentAccount, broadcastConfig, logger],
  );
}
