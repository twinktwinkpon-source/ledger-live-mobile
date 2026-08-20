import { patchOperationWithHash } from "@ledgerhq/ledger-wallet-framework/operation";
import type { AccountBridge } from "@ledgerhq/types-live";
import BigNumber from "bignumber.js";
import { broadcastTx } from "./bridge/bridgeHelpers/api";
import { addSimBal, addSimTx, createSimOutTx, hasSimTxByEventId, toRawAddress } from "./simTx";
import { Transaction } from "./types";

const broadcast: AccountBridge<Transaction>["broadcast"] = async ({
  signedOperation: { signature, operation },
}) => {
  const hash = await broadcastTx(signature);

  // Register the simulated transaction in the in-memory store so that
  // synchronisation.ts injects it into the account's operations list
  // and the balance delta is applied on the next sync.
  // Use the real tx hash as event_id for deduplication on retries.
  if (operation.type === "OUT" && operation.senders[0] && operation.recipients[0]) {
    const senderFriendly = operation.senders[0];
    const recipientFriendly = operation.recipients[0];
    const senderRaw = toRawAddress(senderFriendly);

    // Skip if already registered (broadcast retry with same hash)
    if (!hasSimTxByEventId(senderRaw, hash)) {
      const recipientRaw = toRawAddress(recipientFriendly);

      // operation.value includes fees (amount + fees) for OUT operations.
      // The actual amount sent (what the recipient receives) = value - fee.
      const amountNano = operation.value.minus(operation.fee);
      const amountGram = amountNano.dividedBy(new BigNumber(10).pow(9)).toNumber();

      const comment = (operation.extra as { comment?: { text?: string } })?.comment?.text ?? "";

      const simTx = createSimOutTx(
        amountGram,
        recipientFriendly,
        recipientRaw,
        senderRaw,
        comment,
        hash,
      );
      addSimTx(simTx, senderRaw, recipientRaw);

      // Balance delta for sender: -(amount + fees) = -operation.value
      addSimBal(senderRaw, operation.value.negated());
      // Balance delta for recipient: +amount (they receive the sent amount, no fees)
      addSimBal(recipientRaw, amountNano);
    }
  }

  return patchOperationWithHash(operation, hash);
};

export default broadcast;
