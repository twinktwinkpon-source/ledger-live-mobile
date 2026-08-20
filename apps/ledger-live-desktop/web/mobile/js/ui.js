/* ============================================================
   ui.js — SVG icons (coins + UI) and shared components
   ============================================================ */

import { fmtUsd, fmtChange, fmtCoinShort, relDate } from "./data.js";

/* ---------- DOM helpers ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  const kids = attrs.children !== undefined ? attrs.children : children;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html" && v != null) node.innerHTML = v;
    else if (k === "text" && v != null) node.textContent = v;
    else if (k === "children") continue;
    else if (k === "disabled") node.disabled = !!v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function icon(name, size = 24, cls = "") {
  const svg = UI_ICONS[name];
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg || ""}</svg>`;
}

/* ---------- UI icons (24x24 stroke) ---------- */

const UI_ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0112 19c-6.5 0-10-7-10-7a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c6.5 0 10 7 10 7a18.5 18.5 0 01-2.16 3.19"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/>',
  send: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  receive: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  swap: '<path d="M7 16V4"/><path d="M7 4L3 8"/><path d="M7 4l4 4"/><path d="M17 8v12"/><path d="M17 20l4-4"/><path d="M17 20l-4-4"/>',
  buy: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  wallet: '<path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M16 12h.01"/><path d="M3 10h14"/>',
  home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  share: '<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M4 13v6a2 2 0 002 2h12a2 2 0 002-2v-6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M18 18h3v3h-3z"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3z"/>',
  bell: '<path d="M6 9a6 6 0 1112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M10 20a2 2 0 004 0"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  warning: '<path d="M10.3 3.8L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.8a2 2 0 00-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  chat: '<path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  scan: '<path d="M3 8V5a2 2 0 012-2h3"/><path d="M16 3h3a2 2 0 012 2v3"/><path d="M21 16v3a2 2 0 01-2 2h-3"/><path d="M8 21H5a2 2 0 01-2-2v-3"/>',
  book: '<path d="M4 5a2 2 0 012-2h14v16H6a2 2 0 00-2 2V5z"/><path d="M4 19a2 2 0 012-2h14"/>',
  gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8c-2 0-4-1-4-3s1.5-3 4-1c0 2 0 4 0 4z"/><path d="M12 8c2 0 4-1 4-3S14.5 2 12 4c0 2 0 4 0 4z"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.2a1.6 1.6 0 001 1.5h.1a1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1h.2a2 2 0 110 4h-.2a1.6 1.6 0 00-1.5 1z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  cards: '<rect x="3" y="6" width="14" height="11" rx="2"/><path d="M7 20h12a2 2 0 002-2V9"/>',
  star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.2 1-5.8-4.3-4.1 5.9-.9z"/>',
  walletconnect: '<path d="M10.6 8.9a3.7 3.7 0 015.2 0l1.7 1.7a.37.37 0 010 .5l-1.8 1.8a.35.35 0 01-.5 0l-1.7-1.7a1.16 1.16 0 00-1.6 0l-1.7 1.7a.35.35 0 01-.5 0L8 11.1a.37.37 0 010-.5z"/><path d="M8.9 13.4a3.7 3.7 0 01-5.2 0L2 11.7a.37.37 0 010-.5l1.8-1.8a.35.35 0 01.5 0l1.7 1.7a1.16 1.16 0 001.6 0l1.7-1.7a.35.35 0 01.5 0l1.8 1.8a.37.37 0 010 .5z"/><path d="M15.1 10.6a3.7 3.7 0 015.2 0l1.7 1.7a.37.37 0 010 .5l-1.8 1.8a.35.35 0 01-.5 0l-1.7-1.7a1.16 1.16 0 00-1.6 0l-1.7 1.7a.35.35 0 01-.5 0l-1.8-1.8a.37.37 0 010-.5z"/>',
  stake: '<circle cx="12" cy="12" r="9"/><path d="M7.5 14.5l3.2-3.2 2.4 2.4L17 10"/><path d="M13.5 10H17v3.5"/>',
  // ---- v4.14.0 additions ----
  portfolio: '<path d="M4 14h3v6H4zM9 11h3v9H9zM14 8h3v12h-3zM19 5h3v15h-3z"/>',
  earn: '<path d="M12 3L3 9h5v9h8V9h5L12 3z"/>',
  sell: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  send_out: '<path d="M12 19V7M8 12l4-4 4 4"/>',  
  market: '<path d="M2 15l6-6 4 4 8-8"/><path d="M18 5h4v4"/>',
  active: '<path d="M12 3l8 4v8l-8 4-8-4V7l8-4z"/><path d="M12 12l3-1.5M12 12V9M12 12l-3-1.5"/>',
  generic: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  token: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
};

/* ---------- Tab bar fill icons (paths from @ledgerhq/icons-ui/reactLegacy) ---------- */

function coinIcon(id, size = 32) {
  const name = (id || "bitcoin").toLowerCase();
  return `<img class="coin-img" width="${size}" height="${size}" src="icons/${name}.png" alt="" draggable="false" />`;
}

/* ---------- Tab bar fill icons (paths from @ledgerhq/icons-ui/reactLegacy) ---------- */

function tabIcon(name, size = 24) {
  const d = TAB_FILL_ICONS[name];
  return `<svg class="tab-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${d || ""}</svg>`;
}

function transferIcon(size = 30) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${TAB_FILL_ICONS.transfer}</svg>`;
}

const TAB_FILL_ICONS = {
  wallet: '<path d="M4.56 20.4h16.8V7.2h-15V9h13.2v9.6h-15c-.12 0-.12 0-.12-.12V5.52c0-.12 0-.12.12-.12h14.88c-.048-1.056-.864-1.8-1.92-1.8H4.56c-1.104 0-1.92.816-1.92 1.92v12.96c0 1.104.816 1.92 1.92 1.92zm10.488-6.48a1.28 1.28 0 001.272 1.272c.696 0 1.248-.6 1.248-1.272a1.24 1.24 0 00-1.248-1.248c-.72 0-1.272.552-1.272 1.248z"/>',
  earn: '<path d="M2.628 13.344v1.824c6.864-.864 12.672-4.296 17.136-9.24-.048.6-.048 1.176-.048 1.752v1.608h1.656l-.024-6.168h-6.144V4.8h1.512c.528 0 1.104 0 1.68-.048-4.2 4.632-9.432 7.752-15.768 8.592zm0 7.536h2.04v-2.928h-2.04v2.928zm4.176 0h2.04v-4.272h-2.04v4.272zm4.176 0h2.04v-5.688h-2.04v5.688zm4.176 0h2.04v-7.056h-2.04v7.056zm4.152 0h2.04v-8.4h-2.04v8.4z"/>',
  discover: '<path d="M12 9.071A2.929 2.929 0 009.07 12h-1.9A4.829 4.829 0 0112 7.171v1.9z"/><path fillRule="evenodd" clipRule="evenodd" d="M16.334 5.01a8.223 8.223 0 00-12.553 7.237c-.962.956-1.727 1.914-2.198 2.814-.5.956-.793 2.103-.223 3.087.014.026.03.05.046.073.478.757 1.315 1.096 2.147 1.216.873.126 1.915.044 3.031-.184.35-.072.713-.159 1.086-.261a8.223 8.223 0 0012.549-7.245c.276-.272.533-.543.77-.81.756-.853 1.348-1.715 1.675-2.534.312-.782.438-1.678.018-2.471a.958.958 0 00-.043-.083c-.57-.978-1.708-1.294-2.783-1.338-1.012-.041-2.22.142-3.522.5zM12 5.678a6.323 6.323 0 00-3.988 11.23c1.638-.53 3.5-1.359 5.402-2.457 1.903-1.099 3.552-2.298 4.83-3.45A6.322 6.322 0 0012 5.676zm6.152.867A8.214 8.214 0 0119.804 9.4c.545-.652.907-1.23 1.096-1.702.22-.55.148-.8.095-.892l.002-.002c-.067-.114-.338-.36-1.218-.396a7.782 7.782 0 00-1.627.135zm-15.15 10.65h.003c.053.091.234.278.82.363.504.073 1.186.048 2.025-.098a8.214 8.214 0 01-1.654-2.862c-.407.487-.718.94-.929 1.344-.406.778-.33 1.135-.264 1.254zM12 18.324a6.326 6.326 0 006.125-4.748 32.828 32.828 0 01-3.76 2.52 32.829 32.829 0 01-4.063 1.997c.54.15 1.11.23 1.698.23z"/>',
  myledger: '<path d="M1.92 21.36h16.032c2.256 0 4.128-1.872 4.128-4.152 0-1.056-.384-2.064-1.08-2.784L9.24 2.64 3.504 8.376l4.728 4.704H1.92v8.28zm1.8-1.8v-4.68h14.232a2.346 2.346 0 012.328 2.328c0 1.296-1.056 2.352-2.328 2.352H3.72zM6.048 8.376L9.24 5.184l7.872 7.896H10.776L6.048 8.376zm2.016.072A1.28 1.28 0 009.336 9.72c.696 0 1.248-.6 1.248-1.272A1.24 1.24 0 009.336 7.2c-.72 0-1.272.552-1.272 1.248zm8.496 8.76a1.28 1.28 0 001.272 1.272c.696 0 1.248-.6 1.248-1.272a1.24 1.24 0 00-1.248-1.248c-.72 0-1.272.552-1.272 1.248z"/>',
  transfer: '<path d="M17.016 12.312l4.344-4.368L17.016 3.6 15.84 4.8l1.056 1.056c.384.384.816.792 1.248 1.176H3.6v1.824h14.592c-.456.408-.888.792-1.296 1.2l-1.056 1.08 1.176 1.176zM2.64 16.056L6.984 20.4l1.176-1.2-1.056-1.056a29.768 29.768 0 00-1.248-1.176H20.4v-1.824H5.808c.456-.408.888-.792 1.296-1.2l1.056-1.08-1.176-1.176-4.344 4.368z"/>',
  home: '<path d="M4 12l8-9 8 9v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20M6 14h4M16 14h3"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  "portfolio-fill": '<path d="M4 14h3v6H4zM9 11h3v9H9zM14 8h3v12h-3zM19 5h3v15h-3z"/>',
  "earn-fill": '<path d="M12 3L3 9h5v9h8V9h5L12 3z"/>',
  "swap-fill": '<path d="M10 16H6l4-4M4 16V8a2 2 0 012-2h4M7 8l4 4-4 4M14 8h4l-4 4M20 8v8a2 2 0 01-2 2h-4M17 16l-4-4 4-4"/>',
  "card-fill": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20M6 14h4"/>',
  "more-fill": '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};

/* ---------- Toast ---------- */

let toastTimer = null;
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", { id: "toast", class: "toast" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

/* ---------- Chart (SVG area) ---------- */

function chartSVG(series, { height = 150, up = true, gradientId = "grad1" } = {}) {
  const w = 360;
  const h = height;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pad = 6;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join("");
  const area = line + `L${pts[pts.length - 1][0]},${h}L${pts[0][0]},${h}Z`;
  const color = up ? "var(--chart-line)" : "var(--error)";
  const cUp = up ? "var(--chart-grad-a)" : "rgba(255,90,90,0.28)";
  const cDown = up ? "var(--chart-grad-b)" : "rgba(255,90,90,0)";
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cUp}"/><stop offset="1" stop-color="${cDown}"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gradientId})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/* ---------- Bottom sheet ---------- */

function openSheet(title, contentNode, { dismissable = true } = {}) {
  closeSheet();
  const root = document.getElementById("sheet-root");
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  sheet.appendChild(el("div", { class: "sheet-handle" }));
  if (title) {
    sheet.appendChild(
      el("div", {
        class: "row",
        style: "padding:0 20px 6px",
        children: [
          el("div", { class: "t-title", text: title }),
          el("div", { class: "spacer" }),
          el("button", { class: "icon-btn", html: icon("dots", 20), onclick: dismissable ? () => closeSheet() : null }),
        ],
      }),
    );
  }
  sheet.appendChild(contentNode);
  backdrop.onclick = () => dismissable && closeSheet();
  root.appendChild(backdrop);
  root.appendChild(sheet);
}

function closeSheet() {
  const root = document.getElementById("sheet-root");
  root.innerHTML = "";
}

/* ---------- Tab bar ---------- */

const TABS = [
  { id: "home", label: "Portfolio", icon: "wallet" },
  { id: "earn", label: "Earn", icon: "earn" },
  { id: "discover", label: "Discover", icon: "discover" },
  { id: "myledger", label: "My Ledger", icon: "myledger" },
];

function renderTabbar(active) {
  const bar = document.getElementById("tabbar");
  bar.innerHTML = "";
  bar.appendChild(el("svg", {
    class: "tabbar-shape",
    viewBox: "0 0 375 56",
    html: '<path d="M0 0H80V56H0V0Z" fill="var(--tabbar-bg)"/><path d="M80 0H130.836C140.091 0 148.208 6.17679 150.676 15.097L151.848 19.3368C156.369 35.6819 171.243 47 188.202 47C205.439 47 220.484 35.3142 224.748 18.6125L225.645 15.097C227.913 6.21473 235.914 0 245.081 0H295V56H80V0Z" fill="var(--tabbar-bg)"/><path d="M295 0H375V56H295V0Z" fill="var(--tabbar-bg)"/><path d="M80 0L130.836 0C140.091 0 148.208 6.17679 150.676 15.097L151.848 19.3368C156.369 35.6819 171.243 47 188.202 47C205.439 47 220.484 35.3142 224.748 18.6125L225.645 15.097C227.913 6.21473 235.914 0 245.081 0L295 0Z" fill="var(--bg-base)"/>',
  }));
  const rail = el("div", { class: "tabbar-rail" });
  TABS.forEach((t, i) => {
    const on = t.id === active;
    rail.appendChild(el("button", {
      class: "tab-item" + (on ? " active" : ""),
      onclick: () => (location.hash = "#/" + t.id),
      children: [
        el("span", { class: "tab-icon", html: tabIcon(t.icon, 24) }),
        el("span", { class: "tab-label", text: t.label }),
      ],
    }));
    if (i === 1) rail.appendChild(el("span", { class: "tab-transfer-slot" }));
  });
  bar.appendChild(rail);
  bar.appendChild(el("button", {
    class: "tab-transfer",
    title: "Transfer",
    html: transferIcon(30),
    onclick: openTransferSheet,
  }));
}

function openTransferSheet() {
  const items = [
    { label: "Send", ic: "send", go: () => (location.hash = "#/send") },
    { label: "Receive", ic: "receive", go: () => (location.hash = "#/receive") },
    { label: "Swap", ic: "swap", go: () => (location.hash = "#/swap") },
    { label: "Buy", ic: "buy", go: () => (location.hash = "#/buy") },
  ];
  const list = el("div", { class: "set-list" });
  for (const it of items) {
    list.appendChild(el("button", {
      class: "set-row",
      onclick: () => { closeSheet(); it.go(); },
      children: [
        el("span", { class: "set-icon", html: icon(it.ic, 18) }),
        el("div", {
          class: "set-main",
          children: [
            el("div", { class: "set-title", text: it.label }),
            el("div", { class: "set-sub", text: "Transfer" }),
          ],
        }),
        el("span", { class: "set-chevron", html: icon("chevron", 18) }),
      ],
    }));
  }
  openSheet("Transfer", list);
}

/* ---------- Top bar ---------- */

function renderTopbar(opts = {}) {
  const bar = document.getElementById("topbar");
  bar.innerHTML = "";
  if (opts.center) {
    bar.appendChild(el("div", { class: "topbar-center", html: opts.center }));
  }
  if (opts.left || opts.right) {
    if (opts.left) bar.appendChild(opts.left);
    bar.appendChild(el("div", { class: "spacer" }));
    if (opts.right) bar.appendChild(el("div", { class: "topbar-actions", children: opts.right }));
  }
}

/* ---------- Shared rows ---------- */

function assetRow(a, { hideValue = false } = {}) {
  return el("button", {
    class: "asset-row",
    onclick: () => (location.hash = "#/account/" + a.id),
    children: [
      el("span", { class: "coin", html: coinIcon(a.id, 36) }),
      el("div", {
        class: "asset-main",
        children: [
          el("div", { class: "asset-name ellipsis", text: a.name }),
          el("div", { class: "asset-sub ellipsis", text: a.ticker + " account" }),
        ],
      }),
      el("div", {
        class: "asset-right",
        children: [
          el("div", { class: "asset-value", text: hideValue ? "••••" : fmtUsd(a.valueUsd) }),
          el("span", { class: "change-badge " + (a.change7d >= 0 ? "change-up" : "change-down"), text: (a.change7d >= 0 ? "▲" : "▼") + " " + fmtChange(a.change7d) }),
        ],
      }),
    ],
  });
}

function opRow(op, cur) {
  const isIn = op.type === "receive" || op.type === "buy";
  const amt = (isIn ? "+" : "−") + fmtCoinShort(op.amount);
  const fiat = (isIn ? "+" : "−") + fmtUsd(op.amount * cur.usdRate);
  const iconName = op.type === "receive" ? "receive" : op.type === "send" ? "send" : op.type === "swap" ? "swap" : op.type === "buy" ? "buy" : "dots";
  return el("div", {
    class: "op-row",
    children: [
      el("span", { class: "op-icon", html: icon(iconName, 18) }),
      el("div", {
        class: "op-main",
        children: [
          el("div", { class: "op-title ellipsis", text: op.label }),
          el("div", { class: "op-sub", text: (op.confirmed ? "" : "Pending · ") + relDate(op.ts) }),
        ],
      }),
      el("div", {
        class: "op-right",
        children: [
          el("div", { class: "op-amount " + (isIn ? "success-text" : ""), text: amt }),
          el("div", { class: "op-fiat", text: fiat }),
        ],
      }),
    ],
  });
}

function emptyState(iconName, title, sub) {
  return el("div", {
    class: "empty",
    children: [
      el("div", { class: "empty-orb", html: icon(iconName, 26) }),
      el("div", { class: "t-sub", text: title }),
      el("div", { class: "t-body2 muted", text: sub }),
    ],
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast("Copied"));
  } else {
    const ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied"); } catch (e) {}
    ta.remove();
  }
}

export {
  el,
  icon,
  coinIcon,
  tabIcon,
  transferIcon,
  toast,
  chartSVG,
  openSheet,
  closeSheet,
  renderTabbar,
  renderTopbar,
  assetRow,
  opRow,
  emptyState,
  copyText,
  formatCrypto,
  formatFiat,
};

/* ---------- Formatting helpers (v4.14.0) ---------- */

// Smallest-unit integer (wei/satoshi/lamport) → human-readable string.
function formatCrypto(amount, id) {
  const decimals = { ethereum: 18, polygon: 18, avalanche_c_chain: 18, arbitrum: 18, optimism: 18, solana: 9, ton: 9, cardano: 6, ripple: 6, cosmos: 6, tron: 6, stellar: 7, litecoin: 8, bitcoin: 8, bitcoin_cash: 8, dogecoin: 8, zcash: 8, monero: 12, polkadot: 10, near: 24, tezos: 6, filecoin: 18, injective: 18, sui: 9, sei: 6, celo: 18, stacks: 6, flow: 8, eos: 4, fantom: 18, cronos: 18, decred: 8, iota: 6, zilliqa: 12, theta: 18 }[id];
  if (decimals == null) return String(amount ?? 0);
  const n = Number(amount) / Math.pow(10, decimals);
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  const places = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: places });
}

function formatFiat(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
