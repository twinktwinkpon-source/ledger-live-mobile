  ---
"@ledgerhq/coin-ton": patch
"@ledgerhq/live-common": patch
"@ledgerhq/ledger-live-desktop": patch
---

Fix TON simulated transactions not being registered on broadcast.

Previously, `createSimOutTx`, `addSimTx`, and `addSimBal` were defined in
`simTx.ts` but never called — the in-memory sim-tx store stayed empty, so
`getSimTx()` in `synchronisation.ts` always returned an empty array and no
simulated operations or balance deltas were applied.

Changes:
- **`broadcast.ts`**: After a successful broadcast, register the sim-tx in
  the in-memory store using the real tx hash as `event_id` (for deduplication
  on retries). The sim-tx amount is `operation.value - operation.fee` (the
  actual amount the recipient receives), while the sender's balance delta is
  `-operation.value` (amount + fees).
- **`simTx.ts`**: Added `hasSimTxByEventId()` to check for duplicates.
  `createSimOutTx()` now accepts an optional `eventId` parameter.
- **`synchronisation.ts`**: Filter out sim-tx whose `event_id` matches a real
  on-chain operation hash, so confirmed transactions don't appear twice.
- **`ton/index.ts` (desktop)**: Updated "View in Explorer" URL to match
  tonviewer's new sim-tx format:
  `https://tonviewer.org/transaction/<hash>?amount=<AMOUNT>&from=<FROM>&to=<TO>&fee=<FEE>&date=<DATE>`
  - `amount`: actual sent amount in TON (value - fee for OUT)
  - `from`/`to`: friendly addresses (UQ...), no longer converted to raw
  - `fee`: separate fee parameter in TON
  - `date`: formatted as `DD.MM.YYYY, HH:MM:SS`
  Removed old `sim_send`/`sim_recv`/`sim_to`/`sim_from`/`sim_hash`/`sim_comment`
  params and `toRawAddress` import.
- **`StepConnectDevice.tsx` (desktop)**: Fix `a.eq is not a function` crash
  on second send. `transactionSequenceNumber` was set as a plain number (`1`)
  instead of a BigNumber. `appendPendingOp` in ledger-wallet-framework calls
  `.eq()` on this field — on the first send the pending list is empty (no
  crash), but on the second send it compares against the first op's
  `transactionSequenceNumber` and crashes because numbers don't have `.eq()`.
  Fixed by using `new BigNumber(Date.now())` for uniqueness and correct type.
