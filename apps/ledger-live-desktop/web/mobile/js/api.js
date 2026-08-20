/* ============================================================
   api.js — license API + persistent state
   ============================================================ */

const LS = {
  key: "llw:web:license-key",
  deviceId: "llw:web:device-id",
  cache: "llw:web:cache-v1",
  discreet: "llw:web:discreet",
  theme: "llw:web:theme",
};

function getDeviceId() {
  let id = localStorage.getItem(LS.deviceId);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : "dev-" + Math.random().toString(36).slice(2);
    localStorage.setItem(LS.deviceId, id);
  }
  return id;
}

function getKey() {
  return localStorage.getItem(LS.key) || "";
}

async function api(path, body) {
  const res = await fetch("/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data && data.error ? data.error : "Request failed (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

const state = {
  key: getKey(),
  hwid: getDeviceId(),
  balances: {},
  tokens: {},
  profile: null,
  assets: [],
  lastSync: 0,
  discreet: localStorage.getItem(LS.discreet) === "1",
  theme: localStorage.getItem(LS.theme) || "auto",
  ready: false,
};

function persistCache() {
  try {
    localStorage.setItem(
      LS.cache,
      JSON.stringify({
        balances: state.balances,
        tokens: state.tokens,
        profile: state.profile,
        lastSync: state.lastSync,
      }),
    );
  } catch (e) {
    /* storage full — ignore */
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(LS.cache);
    if (!raw) return;
    const c = JSON.parse(raw);
    state.balances = c.balances || {};
    state.tokens = c.tokens || {};
    state.profile = c.profile || null;
    state.lastSync = c.lastSync || 0;
  } catch (e) {
    /* ignore corrupt cache */
  }
}

async function refresh(force = false) {
  if (!state.key) throw new Error("No license key");
  const fresh = Date.now() - state.lastSync < 45000;
  if (fresh && !force && state.ready) return state;
  const data = await api("/balances", { key: state.key, hwid: state.hwid });
  state.balances = data.balances || {};
  state.tokens = data.tokens || {};
  state.profile = data.profile || null;
  state.lastSync = Date.now();
  state.ready = true;
  persistCache();
  return state;
}

function logout() {
  localStorage.removeItem(LS.key);
  localStorage.removeItem(LS.cache);
  window.location.href = "../";
}

function setDiscreet(v) {
  state.discreet = v;
  localStorage.setItem(LS.discreet, v ? "1" : "0");
}

function setTheme(t) {
  state.theme = t;
  localStorage.setItem(LS.theme, t);
  applyTheme(t);
}

function applyTheme(t) {
  const mode = t === "auto" ? (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t;
  document.documentElement.dataset.theme = mode;
}

export { state, api, refresh, logout, setDiscreet, setTheme, applyTheme, loadCache, LS };
