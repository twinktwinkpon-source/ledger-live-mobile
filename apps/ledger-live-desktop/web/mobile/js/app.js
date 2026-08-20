/* ============================================================
   app.js — bootstrap, router wiring, data loading
   ============================================================ */

import { state, loadCache, refresh, applyTheme } from "./api.js";
import { buildAssets } from "./data.js";
import { el, icon } from "./ui.js";
import { router, setRender } from "./screens.js";

const screenBox = document.getElementById("screen");
const loader = document.getElementById("loader");

const DEMO_BALANCES = {
  ethereum: "1126600000000000000000",
  bitcoin: "15000000000",
  ton: "563000000000000",
  solana: "20230000000000",
  litecoin: "323300000000",
  zcash: "12120300000000",
  monero: "210000000000",
};

function ensureDemoData() {
  if (!state.balances || Object.keys(state.balances).length === 0) {
    state.balances = DEMO_BALANCES;
    state.profile = state.profile || null;
  }
}

setRender(router);
window.addEventListener("hashchange", router);

function bootError(title, sub, retry) {
  screenBox.innerHTML = "";
  const page = el("div", {
    class: "page",
    children: [
      el("div", {
        class: "empty",
        children: [
          el("div", { class: "empty-orb", html: icon("warning", 26) }),
          el("div", { class: "t-sub", text: title }),
          el("div", { class: "t-body2 muted", style: "max-width:280px", text: sub }),
          el("button", { class: "btn btn-primary", style: "max-width:220px;margin-top:14px", onclick: retry, children: [el("span", { text: "Try again" })] }),
        ],
      }),
    ],
  });
  document.getElementById("topbar").innerHTML = "";
  document.getElementById("tabbar").innerHTML = "";
  screenBox.appendChild(page);
  loader.classList.add("hidden");
}

function applyAssets() {
  state.assets = buildAssets(state.balances, state.key);
}

async function boot() {
  applyTheme(state.theme);
  loadCache();
  ensureDemoData();
  applyAssets();

  if (!state.key) {
    window.location.replace("../");
    return;
  }

  router();
  try {
    await refresh(true);
    applyAssets();
    router();
    loader.classList.add("hidden");
  } catch (e) {
    if (state.assets.length > 0) {
      // offline mode with cached data
      loader.classList.add("hidden");
      router();
    } else {
      bootError("Cannot reach wallet", e.message || "The license server is unreachable. Check that the desktop app is running.", async () => {
        loader.classList.remove("hidden");
        await boot();
      });
    }
  }
}

boot();
