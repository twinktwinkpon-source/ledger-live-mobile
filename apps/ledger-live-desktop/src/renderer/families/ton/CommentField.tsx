import { useAccountBridge } from "@ledgerhq/live-common/bridge/useAccountBridge";
import { Transaction, TransactionStatus } from "@ledgerhq/live-common/families/ton/types";
import { useFeature } from "@ledgerhq/live-common/featureFlags/index";
import { Account } from "@ledgerhq/types-live";
import { CurrencyNotSupported } from "@ledgerhq/errors";
import invariant from "invariant";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import MemoTagField from "LLD/features/MemoTag/components/MemoTagField";
import Input from "~/renderer/components/Input";
import { useFakeAccountBridge } from "~/renderer/mocks/fakeBridge";

const CommentField = ({
  onChange,
  account,
  transaction,
  status,
  autoFocus,
}: {
  onChange: (a: Transaction) => void;
  account: Account;
  transaction: Transaction;
  status: TransactionStatus;
  autoFocus?: boolean;
}) => {
  // TON transaction should always have family "ton". Guard against a transaction
  // that lost its family (e.g. created before the account bridge finished
  // initialising) so the Send screen doesn't hard-crash. We still surface a
  // warning for diagnostics.
  if (transaction.family !== "ton") {
    console.warn("[TON] CommentField: transaction.family is not 'ton':", transaction?.family);
  }

  const { t } = useTranslation();

  // FLEX: fake accounts (IDs starting with "flex-" or "mock-") are not real
  // Ledger Live accounts, so the real useAccountBridge cannot resolve a bridge
  // for them (decodeAccountId fails on the non-standard id). Use the fake
  // bridge instead, which provides a working updateTransaction.
  const isFakeAccount = (account as any)?.id?.startsWith?.("flex-") || (account as any)?.id?.startsWith?.("mock-");
  let bridge;
  if (isFakeAccount) {
    bridge = useFakeAccountBridge<Transaction>(account);
  } else {
    try {
      bridge = useAccountBridge<Transaction>(account);
    } catch (e) {
      if (
        e instanceof CurrencyNotSupported &&
        typeof process !== "undefined" &&
        process.env.FLEX_DEMO === "true"
      ) {
        bridge = {
          updateTransaction: (tx: Transaction, patch: Partial<Transaction>) =>
            ({ ...tx, ...patch } as Transaction),
        };
      } else {
        throw e;
      }
    }
  }
  const lldMemoTag = useFeature("lldMemoTag");

  const onCommentFieldChange = useCallback(
    (value: string) => {
      onChange(
        bridge.updateTransaction(transaction, {
          comment: { isEncrypted: false, text: value ?? "" },
        }),
      );
    },
    [onChange, transaction, bridge],
  );

  const InputField = lldMemoTag?.enabled ? MemoTagField : Input;

  // Safely handle undefined comment (e.g. with fake bridge transactions in FLEX_DEMO)
  const commentText = transaction.comment?.text ?? "";

  return (
    <InputField
      warning={status.warnings.transaction}
      error={status.errors.transaction}
      value={commentText}
      placeholder={t("families.ton.commentPlaceholder")}
      onChange={onCommentFieldChange}
      spellCheck="false"
      autoFocus={autoFocus}
    />
  );
};

export default CommentField;
