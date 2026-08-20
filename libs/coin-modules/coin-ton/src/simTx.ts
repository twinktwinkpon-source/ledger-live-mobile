import BigNumber from "bignumber.js";
import { encodeOperationId } from "@ledgerhq/ledger-wallet-framework/operation";
import { Address } from "@ton/core";
import { TonOperation } from "./types";

/**
 * In-memory storage for simulated transactions.
 * Key: raw address (urlSafe, non-bounceable) → array of sim-tx where this address is sender OR recipient.
 * Future: replace with MMKV/AsyncStorage for persistence across sessions.
 */
const simTxStore = new Map<string, SimTx[]>();

/**
 * In-memory storage for simulated balance deltas (in nanoTON).
 * Key: raw address → cumulative delta (nanoTON).
 * Used to adjust the real balance returned by the API.
 */
const simBalDeltas = new Map<string, BigNumber>();

/**
 * A simulated TON transaction (mirrors tonviewer's tv_sim_tx entry).
 */
export interface SimTx {
  /** Unique ID, e.g. "sim_" + timestamp + "_" + random */
  event_id: string;
  /** Amount in nanoTON (BigNumber for precision). */
  nano: BigNumber;
  /** Raw address of the counterparty. */
  counterpartyRaw: string;
  /** User-friendly address of the counterparty. */
  counterpartyFriendly: string;
  /** Unix timestamp (ms). */
  timestamp: number;
  /** Optional comment attached to the simulated transaction. */
  comment: string;
}

/**
 * Converts a user-friendly address to a normalized raw address
 * (urlSafe, non-bounceable), matching the format used in synchronisation.ts.
 */
export function toRawAddress(friendlyOrRaw: string): string {
  return Address.parse(friendlyOrRaw).toString({ urlSafe: true, bounceable: false });
}

/**
 * Generates a unique event ID for a simulated transaction.
 */
function generateEventId(): string {
  return `sim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Checks if a simulated transaction with the given event_id already exists
 * for the specified address. Used to prevent duplicate sim-tx on broadcast retries.
 */
export function hasSimTxByEventId(rawAddr: string, eventId: string): boolean {
  const list = simTxStore.get(rawAddr);
  return Boolean(list && list.some(tx => tx.event_id === eventId));
}

/**
 * Creates a simulated OUT transaction (user sends TON).
 * Mirrors tonviewer's sendTon().
 *
 * @param amountGram - Amount in TON (grams), e.g. 1.5 = 1.5 TON.
 * @param recipientFriendly - User-friendly address of the recipient.
 * @param recipientRaw - Raw address of the recipient (pre-computed for consistency).
 * @param accountAddr - Raw address of the current account (the sender).
 * @param comment - Optional comment text.
 */
export function createSimOutTx(
  amountGram: number,
  recipientFriendly: string,
  recipientRaw: string,
  _accountAddr: string,
  comment = "",
  eventId?: string,
): SimTx {
  return {
    event_id: eventId ?? generateEventId(),
    nano: new BigNumber(amountGram).times(new BigNumber(10).pow(9)),
    counterpartyRaw: recipientRaw,
    counterpartyFriendly: recipientFriendly,
    timestamp: Date.now(),
    comment,
  };
}

/**
 * Creates a simulated IN transaction (user receives TON).
 * Mirrors tonviewer's receiveTon().
 *
 * @param amountGram - Amount in TON (grams).
 * @param senderFriendly - User-friendly address of the sender.
 * @param senderRaw - Raw address of the sender (pre-computed for consistency).
 * @param accountAddr - Raw address of the current account (the recipient).
 * @param comment - Optional comment text.
 */
export function createSimInTx(
  amountGram: number,
  senderFriendly: string,
  senderRaw: string,
  _accountAddr: string,
  comment = "",
): SimTx {
  return {
    event_id: generateEventId(),
    nano: new BigNumber(amountGram).times(new BigNumber(10).pow(9)),
    counterpartyRaw: senderRaw,
    counterpartyFriendly: senderFriendly,
    timestamp: Date.now(),
    comment,
  };
}

/**
 * Adds a simulated transaction to the in-memory store for a given address.
 * The same SimTx can be added for both participants (sender and recipient),
 * so each side sees it in their operation list.
 *
 * @param simTx - The simulated transaction to store.
 * @param selfRaw - Raw address of the account this tx should appear for.
 * @param counterpartyRaw - Raw address of the counterparty (also gets the tx if desired).
 */
export function addSimTx(simTx: SimTx, selfRaw: string, counterpartyRaw: string): void {
  // Add for self
  const selfList = simTxStore.get(selfRaw) ?? [];
  selfList.push(simTx);
  simTxStore.set(selfRaw, selfList);

  // Add for counterparty so they see the mirrored operation
  const counterpartyList = simTxStore.get(counterpartyRaw) ?? [];
  counterpartyList.push(simTx);
  simTxStore.set(counterpartyRaw, counterpartyList);
}

/**
 * Retrieves all simulated transactions for a given raw address.
 * Returns an empty array if none exist.
 */
export function getSimTx(rawAddr: string): SimTx[] {
  return simTxStore.get(rawAddr) ?? [];
}

/**
 * Adds (accumulates) a balance delta for a given raw address.
 * Used to adjust the real balance returned by the API.
 * Positive delta = balance increase, negative = decrease.
 *
 * @param rawAddr - Raw address to apply the delta to.
 * @param deltaNano - Delta in nanoTON (BigNumber).
 */
export function addSimBal(rawAddr: string, deltaNano: BigNumber): void {
  const current = simBalDeltas.get(rawAddr) ?? new BigNumber(0);
  simBalDeltas.set(rawAddr, current.plus(deltaNano));
}

/**
 * Gets the cumulative balance delta (nanoTON) for a given raw address.
 * Returns 0 if no delta exists.
 */
export function getSimBal(rawAddr: string): BigNumber {
  return simBalDeltas.get(rawAddr) ?? new BigNumber(0);
}

/**
 * Converts a SimTx into a TonOperation that the Ledger UI can render.
 *
 * @param sim - The simulated transaction.
 * @param accountId - The Ledger account ID (encoded).
 * @param accountAddr - Raw address of the current account.
 * @param opType - "IN" or "OUT" (explicit, to avoid ambiguity).
 */
export function simTxToTonOperation(
  sim: SimTx,
  accountId: string,
  accountAddr: string,
  opType: "IN" | "OUT",
): TonOperation {
  const hash = sim.event_id;
  const date = new Date(sim.timestamp);

  // For OUT: senders = [accountAddr], recipients = [counterparty]
  // For IN:  senders = [counterparty], recipients = [accountAddr]
  const isOut = opType === "OUT";

  return {
    id: encodeOperationId(accountId, hash, opType),
    hash,
    type: opType,
    value: sim.nano,
    fee: new BigNumber(0),
    blockHeight: null,
    blockHash: null,
    hasFailed: false,
    accountId,
    senders: isOut ? [accountAddr] : [sim.counterpartyFriendly],
    recipients: isOut ? [sim.counterpartyFriendly] : [accountAddr],
    date,
    extra: {
      lt: sim.event_id,
      explorerHash: "",
      comment: {
        isEncrypted: false,
        text: sim.comment,
      },
    },
  };
}

/**
 * Clears all simulated transactions and balance deltas.
 * Useful for testing and reset scenarios.
 */
export function clearSimTx(): void {
  simTxStore.clear();
  simBalDeltas.clear();
}
