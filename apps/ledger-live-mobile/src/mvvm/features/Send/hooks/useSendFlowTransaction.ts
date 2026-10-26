import { useCallback, useMemo } from "react";
import useBridgeTransaction from "@ledgerhq/live-common/bridge/useBridgeTransaction";
import { useAccountBridgeOrNull } from "@ledgerhq/live-common/bridge/useAccountBridge";
import { applyMemoToTransaction } from "@ledgerhq/live-common/bridge/descriptor/send/memo";
import type { Account, AccountLike } from "@ledgerhq/types-live";
import type { Transaction } from "@ledgerhq/live-common/generated/types";
import type {
  SendFlowTransactionState,
  SendFlowTransactionActions,
  RecipientData,
} from "@ledgerhq/live-common/flows/send/types";
import { createFakeAccountBridge } from "~/flex/flexBridge";

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
  // FLEX: synthetic flex accounts have no real coin-module resources, so the
  // real bridge throws AccountNeedResync ("Счёт устарел") on every send.
  // Route them through the fake bridge — the mobile port of the desktop
  // renderer/mocks/fakeBridge.ts used by renderer/modals/Send/Body.tsx.
  const isFlexAccount = !!(account && account.id.startsWith("flex:"));
  const realBridge = useAccountBridgeOrNull<Transaction>(account, parentAccount);
  const bridge = isFlexAccount
    ? (createFakeAccountBridge(
        account && "currency" in account ? account.currency.family : "evm",
      ) as unknown as typeof realBridge)
    : realBridge;

  const {
    transaction,
    setTransaction,
    updateTransaction,
    status,
    bridgeError,
    bridgePending,
    setAccount,
  } = useBridgeTransaction(bridge, () => {
    if (!account) return {};
    return { account, parentAccount: parentAccount ?? undefined };
  });

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
            applyMemoToTransaction(transaction.family, parsedTag, transaction),
          );
        }
      }

      setTransaction(bridge.updateTransaction(transaction, updates));
    },
    [account, bridge, transaction, setTransaction],
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
      setAccount,
    }),
    [setTransaction, updateTransaction, setRecipient, setAccount],
  );

  return { state, actions };
}
