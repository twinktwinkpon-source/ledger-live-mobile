# Ledger Live Bridge — browser extension

Chrome/Edge MV2 extension that connects **bitrefill.com** and **shuffle.com** to the local
Ledger Live desktop app for demo flows.

## What it does

| Site | Behaviour |
|------|-----------|
| **bitrefill.com** | Green "Ledger Live" chip in the bottom-left. Click it to top up the account balance via a Ledger approval popup. On checkout / invoice / payment pages a Ledger popup appears with the order details; approving marks the invoice as paid in `background.js`, which rewrites the site's API responses (`balance`, `invoice`, `order`) so Bitrefill's own UI plays its native gift-card reveal animation. |
| **shuffle.com** | Injects fake balances / deposits / withdrawals into the GraphQL responses and makes `Play` mutations succeed. |

The local API server (port 56237) is started automatically by Ledger Live desktop
(`src/main/shuffle-api-server.ts`).

## Loading the extension (so it survives reboots)

Chrome removes manually-loaded unpacked extensions when the browser is closed, *unless* the
extension is "pinned" and you load it while Developer mode is on. To make it stick:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder:
   ```
   apps/ledger-live-desktop/browser-extension
   ```
4. The extension appears. Click the **pin** icon on `Ledger Live Bridge` (top-right toolbar)
   so the green chip works on any site.
5. Chrome keeps an unpacked extension across restarts as long as Developer mode stays on and
   the extension is not removed. If it ever disappears after a reboot, just re-run steps 1-3
   (Developer mode may have been toggled off).

> Note: do **not** delete or move the folder after loading — Chrome loads it by path.

## Loading the extension in Firefox

Firefox cannot load unpacked extensions permanently; unsigned add-ons must be
installed as **temporary** (survives until Firefox restarts) or in a
**Developer/Nightly** build.

**Temporary (any Firefox build, works immediately):**
1. Open `about:debugging`.
2. Click **This Firefox** (left sidebar).
3. Click **Load Temporary Add-on…**.
4. Select any file inside this folder (e.g. `manifest.json`).
5. The extension stays active until Firefox is closed. To keep it after a
   restart, redo steps 1-4 next session.

**Permanent (Firefox Developer Edition / Nightly / ESR only):**
1. Install [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)
   (regular Firefox ignores signature overrides).
2. Open `about:config` → search `xpinstall.signatures.required` → set to `false`.
3. Pack the extension: `cd apps/ledger-live-desktop/browser-extension && zip -r -FS ../bridge.xpi .`
   (the `.xpi` is just a zip with `manifest.json` at the root).
4. Open `about:addons` → gear icon → **Install Add-on From File…** → pick `bridge.xpi`.
5. The add-on now persists across restarts. Keep `xpinstall.signatures.required=false`
   set, otherwise Firefox disables it on next launch.

> Firefox exposes the standard `browser.*` API, so no shim is needed there; the
> code keeps a `chrome` fallback for Chrome MV2 compatibility.

## Testing flow (bitrefill.com)

1. Start Ledger Live desktop in flex mode (`pnpm --filter ledger-live-desktop start`), it
   opens the local API on `127.0.0.1:56237`.
2. Open `bitrefill.com` while logged in.
3. **Top-up**: click the green "Ledger Live" chip → popup → Approve → balance increases and
   the site's balance display updates live.
4. **Checkout**: add a gift card and go to the payment/invoice page. The Ledger popup shows
   the product + amount. Approve → background marks the invoice paid → the site's next
   invoice/order fetch returns `complete`/`delivered` → Bitrefill renders the gift card with
   its native animation.

## Files

- `manifest.json` — MV2 manifest (content scripts + permissions).
- `background.js` — webRequest interception (shuffle GraphQL + bitrefill REST), Bitrefill
  state machine (`brState`), local API proxy, `br-*` message handlers.
- `content-shuffle.js` — shuffle address gen, WebSocket patch, deposit badge, popup.
- `content-bitrefill.js` — bitrefill popup, top-up chip, invoice detection, balance patching.
- `icons/` — extension icons.

## Debugging

- Background console: `chrome://extensions` → `Ledger Live Bridge` → **Service worker /
  Inspect views: background page** → Console.
- Page console shows `[LLB-BR]` logs from the content script.
- Reset fake state anytime: in the page console run
  `chrome.runtime.sendMessage({ type: "br-reset" })`.
