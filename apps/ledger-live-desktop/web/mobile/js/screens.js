/* ============================================================
   screens.js — v4.14.0 interface (Wallet‑40 style)
   ============================================================ */
import { state } from "./api.js";
import { el, icon, coinIcon, formatCrypto, formatFiat } from "./ui.js";

let _render = null;
export function setRender(fn) { _render = fn; }

const DEMO_PROFILE = {
  name: "Wallet",
  device: { modelId: "stax", name: "Ledger Stax", firmwareVersion: "2.5.0", batteryLevel: 87 },
  activeAssets: ["ethereum","bitcoin","ton","solana","litecoin","zcash","monero"],
};

/* ─── ROUTER ─────────────────────────────────────────────── */
export function router() {
  if (!state.assets) state.assets = [];
  if (!state.profile || !state.profile.device) state.profile = DEMO_PROFILE;
  const route = location.hash.slice(1) || "home";
  renderTopbar(route);
  renderMain(route);
  renderTabbar(route);
}

/* ─── TOPBAR: total portfolio + device chip ──────────────── */
function renderTopbar(route) {
  const bar = document.getElementById("topbar");
  const total = state.assets.reduce((s, a) => s + (Number(a.fiat) || 0), 0);
  const dp = state.profile?.device;
  bar.innerHTML = `
    <div class="topbar-inner">
      <div class="topbar-left">
        <div class="total-label">Portfolio <span class="muted">· ${state.assets.length} assets</span></div>
        <div class="total-amount">${formatFiat(total)}</div>
      </div>
      <div class="topbar-right">
        <span class="chip">${dp?.name || "Wallet"}</span>
        <div class="device-dot ${dp?.batteryLevel > 20 ? 'online' : 'low'}"></div>
      </div>
    </div>`;
}

/* ─── TAB BAR ────────────────────────────────────────────── */
function renderTabbar(route) {
  const TABS = [
    { id: "home", label: "Home",    icon: "portfolio",   iconFill: "portfolio-fill" },
    { id: "earn", label: "Earn",    icon: "earn",        iconFill: "earn-fill" },
    { id: "swap", label: "Swap",    icon: "swap",        iconFill: "swap-fill" },
    { id: "card", label: "Card",    icon: "card",        iconFill: "card-fill" },
    { id: "more", label: "More",    icon: "more",        iconFill: "more-fill" },
  ];
  document.getElementById("tabbar").innerHTML =
    TABS.map(t => {
      const act = route === t.id ? " active" : "";
      return `<button class="tab${act}" data-tab="${t.id}" onclick="location.hash='#${t.id}'">
        <span class="tab-icon">${icon(t.icon, 24)}</span>
        <span class="tab-label">${t.label}</span>
      </button>`;
    }).join("");
}

/* ─── MAIN SCREEN ────────────────────────────────────────── */
function renderMain(route) {
  const box = document.getElementById("screen");
  switch (route) {
    case "earn":  return renderEarn(box);
    case "swap":  return renderSwap(box);
    case "card":  return renderCard(box);
    case "more":  return renderMore(box);
    default:      return renderHome(box);
  }
}

/* ─── HOME (Portfolio) ───────────────────────────────────── */
function renderHome(box) {
  box.innerHTML = `
    <div class="page home-page">

      <!-- Quick Actions -->
      <div class="quick-actions">
        ${buildQuickActions()}
      </div>

      <!-- Portfolio graph area (placeholder) -->
      <div class="graph-card">
        <div class="graph-header">
          <span class="graph-title">7 days</span>
          <span class="graph-change ${state.assets.reduce((s,a)=>s+(a.fiat||0),0) >= 0 ? 'green' : 'red'}">
            ${state.assets.reduce((s,a)=>s+(a.fiat||0),0) >= 0 ? '▲' : '▼'} +2.4%
          </span>
        </div>
        <div class="graph-placeholder">
          <svg width="100%" height="120" viewBox="0 0 340 120" preserveAspectRatio="none">
            <path d="M0,80 Q42,90 85,65 T170,50 T255,70 T340,45" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.6"/>
          </svg>
        </div>
      </div>

      <!-- Asset list -->
      <div class="assets-section">
        <div class="section-title">Assets</div>
        <div id="assetList" class="asset-list">${buildAssetRows()}</div>
      </div>

    </div>
  `;
}

function buildQuickActions() {
  const actions = [
    { label: "Buy",   icon: "buy",     color: "#00C853" },
    { label: "Sell",  icon: "sell",    color: "#FF1744" },
    { label: "Swap",  icon: "swap",    color: "#2979FF" },
    { label: "Send",  icon: "send",    color: "#651FFF" },
    { label: "Stake", icon: "stake",   color: "#00BFA5" },
  ];
  return actions.map(a => `
    <button class="qa-btn" onclick="alert('${a.label}')">
      <span class="qa-icon" style="background:${a.color}">${icon(a.icon, 22)}</span>
      <span class="qa-label">${a.label}</span>
    </button>
  `).join("");
}

function buildAssetRows() {
  return (state.assets || []).map(a => {
    const priceChange = ((Math.random() * 10) - 5).toFixed(1);
    const dir = Number(priceChange) >= 0 ? "▲" : "▼";
    return `
      <div class="asset-row" onclick="location.hash='#asset-${a.id}'">
        <div class="asset-left">
          <span class="asset-icon">${coinIcon(a.id, 32)}</span>
          <div class="asset-info">
            <div class="asset-name">${a.name || a.id}</div>
            <div class="asset-ticker">${(a.ticker || a.id || "").toUpperCase()}</div>
          </div>
        </div>
        <div class="asset-right">
          <div class="asset-balance">${formatCrypto(a.amount, a.id)}</div>
          <div class="asset-fiat">${formatFiat(a.fiat || 0)}</div>
        </div>
      </div>`;
  }).join("");
}

/* ─── EARN ───────────────────────────────────────────────── */
function renderEarn(box) {
  box.innerHTML = `<div class="page"><div class="empty">
    <div class="empty-orb">${icon("earn", 40)}</div>
    <div class="t-sub">Earn</div>
    <div class="t-body2 muted">Stake your assets and earn rewards.<br>Coming soon.</div>
  </div></div>`;
}
/* ─── SWAP ───────────────────────────────────────────────── */
function renderSwap(box) {
  box.innerHTML = `<div class="page"><div class="empty">
    <div class="empty-orb">${icon("swap", 40)}</div>
    <div class="t-sub">Swap</div>
    <div class="t-body2 muted">Exchange one asset for another.<br>Coming soon.</div>
  </div></div>`;
}
/* ─── CARD ───────────────────────────────────────────────── */
function renderCard(box) {
  box.innerHTML = `<div class="page"><div class="empty">
    <div class="empty-orb">${icon("card", 40)}</div>
    <div class="t-sub">Ledger Card</div>
    <div class="t-body2 muted">Spend your crypto anywhere.<br>Coming soon.</div>
  </div></div>`;
}
/* ─── MORE ───────────────────────────────────────────────── */
function renderMore(box) {
  box.innerHTML = `<div class="page"><div class="empty" style="margin-top:40px">
    <div class="t-sub">Settings</div>
    <div class="t-body2 muted">Device: ${state.profile?.device?.name || "—"}<br>Battery: ${state.profile?.device?.batteryLevel || "—"}%<br>Version: 4.14.0</div>
    <button class="btn btn-outline" style="margin-top:20px" onclick="location.hash=''" onclick="localStorage.clear();location.reload()">Reset Wallet</button>
  </div></div>`;
}