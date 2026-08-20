import { useCallback, useMemo } from "react";
import { applyMemoToTransaction } from "@ledgerhq/live-common/bridge/descriptor/send/memo";
import useBridgeTransaction from "@ledgerhq/live-common/bridge/useBridgeTransaction";
import { useAccountBridgeOrNull } from "@ledgerhq/live-common/bridge/useAccountBridge";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";
import { useFakeAccountBridgeOrNull, useFakeBridgeTransaction } from "~/renderer/mocks/fakeBridge";
import type { Transaction } from "@ledgerhq/live-common/generated/types";
import type {
  SendFlowTransactionState,
  SendFlowTransactionActions,
  RecipientData,
} from "@ledgerhq/live-common/flows/send/types";
import type { Account, AccountLike } from "@ledgerhq/types-live";

type UseSendFlowTransactionParams = Readonly<{
  account: AccountLike | null;
  parentAccount: Account | null;
}>;

type UseSendFlowTransactionResult = Readonly<{
  state: SendFlowTransactionState;
  actions: SendFlowTransactionActions;
}>;

export function useSendFlowTransaction({
  account,
  parentAccount,
}: UseSendFlowTransactionParams): UseSendFlowTransactionResult {
  const isFlex = isFlexBuild();

  console.log(
    `[FlexSend] useSendFlowTransaction mounted, isFlex=${isFlex}, account=${account?.id ?? "none"}`,
  );

  // In flex/demo builds the real bridge's transaction status churns (real
  // network fee/prepare calls) which restarts the fake signing flow forever.
  // Use the fake bridge for every coin so the whole send behaves like GRAM/TON.
  const bridge = isFlex
    ? useFakeAccountBridgeOrNull<Transaction>(account, parentAccount)
    : useAccountBridgeOrNull<Transaction>(account, parentAccount);

  const {
    transaction,
    setTransaction: bridgeSetTransaction,
    updateTransaction: bridgeUpdateTransaction,
    status,
    bridgeError,
    bridgePending,
    setAccount,
  } = isFlex
    ? useFakeBridgeTransaction(bridge!, () => {
        if (!account) return { account: null, parentAccount: null };
        return { account, parentAccount: parentAccount ?? null };
      })
    : useBridgeTransaction(bridge, () => {
        if (!account) return {};
        return { account, parentAccount: parentAccount ?? undefined };
      });

  const setTransaction = useCallback(
    (tx: Transaction) => bridgeSetTransaction(tx),
    [bridgeSetTransaction],
  );

  const updateTransaction = useCallback(
    (updater: (tx: Transaction) => Transaction) => bridgeUpdateTransaction(updater),
    [bridgeUpdateTransaction],
  );

  const setRecipient = useCallback(
    (recipient: RecipientData) => {
      if (!account || !transaction || !bridge) return;

      const updates: Partial<Transaction> = { recipient: recipient.address };

      if (recipient.memo !== undefined) {
        Object.assign(
          updates,
          applyMemoToTransaction(
            transaction.family,
            recipient.memo.value,
            recipient.memo.type,
            transaction,
          ),
        );
      }

      if (recipient.destinationTag !== undefined) {
        const parsedTag = Number(recipient.destinationTag.trim());
        if (Number.isFinite(parsedTag)) {
          Object.assign(
            updates,
            applyMemoToTransaction(transaction.family, parsedTag, undefined, transaction),
          );
        }
      }

      bridgeSetTransaction(bridge.updateTransaction(transaction, updates));
    },
    [account, bridge, transaction, bridgeSetTransaction],
  );

  const setAccountForTransaction = useCallback(
    (newAccount: AccountLike, newParentAccount?: Account | null) => {
      setAccount(newAccount, newParentAccount ?? undefined);
    },
    [setAccount],
  );

  const state: SendFlowTransactionState = useMemo(
    () => ({
      transaction: transaction ?? null,
      status,
      bridgeError: bridgeError ?? null,
      bridgePending,
    }),
    [transaction, status, bridgeError, bridgePending],
  );

  const actions: SendFlowTransactionActions = useMemo(
    () => ({
      setTransaction,
      updateTransaction,
      setRecipient,
      setAccount: setAccountForTransaction,
    }),
    [setTransaction, updateTransaction, setRecipient, setAccountForTransaction],
  );

  return { state, actions };
}
