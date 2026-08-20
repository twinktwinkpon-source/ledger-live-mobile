import {
  TonOperation,
  Transaction,
  TransactionStatus,
} from "@ledgerhq/live-common/families/ton/types";
import { Account } from "@ledgerhq/types-live";
import BigNumber from "bignumber.js";
import { LLDCoinFamily } from "../types";
import AccountSubHeader from "./AccountSubHeader";
import sendRecipientFields from "./SendRecipientFields";
import operationDetails from "./operationDetails";

const NANO_PER_TON = new BigNumber(10).pow(9);

/** Format a Date as DD.MM.YYYY, HH:MM:SS (tonviewer's expected format). */
function formatDateForTonviewer(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const family: LLDCoinFamily<Account, Transaction, TransactionStatus, TonOperation> = {
  operationDetails,
  AccountSubHeader,
  sendRecipientFields,
  getTransactionExplorer: (_explorerView, operation) => {
    const from = operation.senders[0];
    const to = operation.recipients[0];
    if (!from || !to) return undefined;

    // Convert from nanoTON to TON (grams).
    // For OUT, operation.value includes fees — amount = value - fee (what recipient receives).
    // For IN, operation.value is already the received amount.
    const amountNano =
      operation.type === "OUT" ? operation.value.minus(operation.fee) : operation.value;
    const amountTon = amountNano.dividedBy(NANO_PER_TON).toNumber();
    const feeTon = operation.fee.dividedBy(NANO_PER_TON).toNumber();

    // Build tonviewer.org URL with sim-tx query params.
    // tonviewer reads these on the /transaction/<hash> route to render a virtual tx
    // even when the hash doesn't exist on-chain (demo/simulated transactions).
    const params = new URLSearchParams();
    params.set("amount", String(amountTon));
    params.set("from", from);
    params.set("to", to);
    params.set("fee", String(feeTon));
    params.set("date", formatDateForTonviewer(operation.date));

    return `https://tonviewer.org/transaction/${operation.hash}?${params.toString()}`;
  },
};

export default family;
