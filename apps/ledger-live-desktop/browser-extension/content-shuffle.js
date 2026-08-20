// content-shuffle.js - Shuffle.com content script (MV3 MAIN world)
// Full flow:
//   1. Fake balances / deposits / withdrawals injected into GraphQL responses.
//   2. Deposit address replacement (deterministic per currency) so a Ledger
//      payment to the shown address is matched back by the extension.
//   3. Payments sent from the Ledger app are polled and turned into native
//      pending -> received deposits (response interception + WS injection via
//      the site's real subscriptions: notificationCreated + balanceUpdated).
//   4. Badge -> Ledger deposit popup.

(function() {
  "use strict";

  const API_BASE = "http://127.0.0.1:56237";
  const GEN = {};
  const KNOWN_ADDR = "0x588830dA7F8950E6C93F9F832f20eF2C5D927564";

  // ─── Utility functions ─────────────────────────────────────
  function h(n) { let s = ""; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
  function randBase58(n) { const c = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let s = ""; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * 58)]; return s; }

  function addr(curr) {
    const k = curr || "ETH";
    if (GEN[k]) return GEN[k];
    const M = {
      BTC: () => "bc1q" + randBase58(32),
      ETH: () => "0x" + h(40),
      SOL: () => randBase58(44),
      LTC: () => "L" + randBase58(33),
      DOGE: () => "D" + randBase58(33),
      XRP: () => "r" + randBase58(33),
      TRX: () => "T" + randBase58(33),
      ADA: () => "addr1" + randBase58(58),
      DOT: () => "1" + randBase58(45),
      BNB: () => "0x" + h(40),
      AVAX: () => "0x" + h(40),
      SHFL: () => "0x" + h(40),
      MATIC: () => "0x" + h(40),
    };
    const fn = M[(curr || "ETH").toUpperCase()] || (() => "0x" + h(40));
    GEN[k] = fn();
    return GEN[k];
  }

  // ─── Known GraphQL operations ─────────────────────────────
  const KNOWN = [
    "GetWallets", "GetWithdrawals", "GetWithdrawableAmount", "GetMyRakebackBalances",
    "GetMyProfile", "GetMyBalance", "GetMyUsdWagered", "GetReferralInfo", "GetAffiliateStats",
    "GetRakeback", "GetDeposits", "GetVaultBalance", "GetRewards", "GetSports", "GetChallengeCount",
    "GetGameTopWins", "GetVipWeeklyBonus", "GetWelcomeOffer", "GetVipMonthlyBonus",
    "GetChallengeRewards", "GetTournamentPrizes", "GetActiveFreeSpinsBonuses", "GetRaceUserReward",
    "GetMyBetCount", "CoinflipClassicPlay", "CoinflipClassicProgressiveActiveBet",
    "CoinflipClassicProgressivePlay", "GetMyKyc", "UpdateRolloverProgress", "getAppSettingAndPrices",
    "tokenInfo", "GetAppSettings", "GetCurrentGameSeeds", "GetGameBySlug", "GetGameById",
    "ActiveTournaments", "SportsBetsCount", "airdropInfo", "GetCachedGames", "activeRollovers",
    "GetRaceLeaderBoardV2", "GetFavouriteGameIds", "GetUnseenNotificationsCount", "getLatestLotteryDraw",
    "GetLatestAirdropEvent", "GetGameProviders", "AirdropUserInfo", "AirdropLeaderBoard",
    "MyAirdropEventInfo", "GetUserSessions", "GetVipDailyRakeback", "GetVipBonus",
    "GetVipUpgradeBonuses", "getSportsProviderStatus", "intercomJwtToken",
  ];

  // ─── State ────────────────────────────────────────────────
  const BALANCES = [
    { currency: "EUR", amount: 50000, available: 50000, __typename: "Balance" },
    { currency: "ETH", amount: 15, available: 15, __typename: "Balance" },
    { currency: "BTC", amount: 0.5, available: 0.5, __typename: "Balance" },
    { currency: "USD", amount: 55000, available: 55000, __typename: "Balance" },
    { currency: "USDT", amount: 55000, available: 55000, __typename: "Balance" },
  ];

  const SH_DECIMALS = { ETH: 18, BTC: 8, SOL: 9, LTC: 8, DOGE: 8, TRX: 6, BNB: 18, AVAX: 18, MATIC: 18, SHFL: 18, USDT: 6, USDC: 6 };
  const SH_RATES = { ETH: 2500, BTC: 50000, SOL: 150, LTC: 80, DOGE: 0.15, TRX: 0.12, BNB: 300, AVAX: 30, MATIC: 0.7, SHFL: 0.05, USDT: 1, USDC: 1 };
  let depositHistory = [];
  let shuffleSeenPayments = {};
  let shufflePollTimer = null;
  let shufflePlateCool = {};

  // ─── Seen payments / plate cooldown persistence (localStorage) ─────
  // Without this every page reload re-processes the same deposit: plates fire
  // again and the notifications list keeps accumulating duplicates.
  const SH_STATE_KEY = "llb-sh-state";
  function shLoadState() {
    try {
      const r = JSON.parse(localStorage.getItem(SH_STATE_KEY) || "{}");
      if (r.seen && typeof r.seen === "object") shuffleSeenPayments = r.seen;
      if (r.cool && typeof r.cool === "object") shufflePlateCool = r.cool;
    } catch(e) {}
  }
  function shSaveState() {
    try { localStorage.setItem(SH_STATE_KEY, JSON.stringify({ seen: shuffleSeenPayments, cool: shufflePlateCool })); } catch(e) {}
  }
  shLoadState();

  // Geo bypass: the site persists globalState.userCountry/userRegion via
  // redux-persist (persist:* keys). Even though x-country headers are stripped,
  // a previously persisted restricted country (e.g. FI) survives reloads and
  // re-opens the client-side "LOCATION RESTRICTIONS" blocking modal. Null it on
  // every load, before the app rehydrates.
  function shScrubPersistedGeo() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf("persist:") !== 0) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let obj; try { obj = JSON.parse(raw); } catch(e) { continue; }
        let changed = false;
        (function walk(o) {
          if (!o || typeof o !== "object") return;
          if (Array.isArray(o)) { for (const x of o) walk(x); return; }
          if ("userCountry" in o && o.userCountry != null) { o.userCountry = null; changed = true; }
          if ("userRegion" in o && o.userRegion != null) { o.userRegion = null; changed = true; }
          for (const k in o) { if (o[k] && typeof o[k] === "object") walk(o[k]); }
        })(obj);
        if (changed) { localStorage.setItem(key, JSON.stringify(obj)); console.log("[LLB-SH] Scrubbed persisted userCountry/userRegion (" + key + ")"); }
      }
    } catch(e) {}
  }
  shScrubPersistedGeo();

  // ─── Notification persistence (localStorage) ─────────────
  const SH_NOTIF_KEY = "llb-sh-notifs";
  function shLoadNotifs() { try { const r = JSON.parse(localStorage.getItem(SH_NOTIF_KEY) || "[]"); return Array.isArray(r) ? r : []; } catch(e) { return []; } }
  function shSaveNotifs(list) { try { localStorage.setItem(SH_NOTIF_KEY, JSON.stringify(list.slice(0, 50))); } catch(e) {} }
  let shNotifStore = shLoadNotifs();
  function shNotifKey(n) { return String((n && n.type) || "") + "|" + String((n && n.metadata && n.metadata.currency) || "") + "|" + String((n && n.metadata && n.metadata.amount) || ""); }
  function shDedupeNotifs() {
    // Keep the newest notification per (type, currency, amount): the same test
    // deposit is reprocessed on every reload unless seenPayments already dedupes
    // it, and this cleans up any pairs that slipped through before.
    const seen = new Set();
    const out = [];
    for (const n of shNotifStore) {
      if (!n || !n.id) continue;
      const k = shNotifKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    if (out.length !== shNotifStore.length) { shNotifStore = out; shSaveNotifs(shNotifStore); }
  }
  function shAddNotif(n) {
    const k = shNotifKey(n);
    shNotifStore = shNotifStore.filter(x => x && shNotifKey(x) !== k);
    shNotifStore.unshift(n);
    shSaveNotifs(shNotifStore);
  }
  shDedupeNotifs();
  function shSeedNotifs() {
    if (shNotifStore.length) return;
    const now = Date.now();
    const mk = (id, type, amount, currency, minsAgo, depositId) => ({
      __typename: "NotificationDto", id, accountId: "llb-account", type,
      readAt: null, seenAt: null,
      createdAt: new Date(now - minsAgo * 60000).toISOString(),
      updatedAt: new Date(now - minsAgo * 60000).toISOString(),
      metadata: { __typename: "DepositMetadataDto", amount, currency, depositId },
    });
    shNotifStore.push(
      mk("notif_llb_seed1", "DEPOSIT_CREDITED", 1.5, "ETH", 130, "llb_dep_seed1"),
      mk("notif_llb_seed2", "DEPOSIT_CREDITED", 0.5, "BTC", 2900, "llb_dep_seed2"),
    );
    shSaveNotifs(shNotifStore);
  }
  shSeedNotifs();

  // ─── Shuffle deposit helpers ──────────────────────────────
  function shuffleCryptoFromSmallest(currency, smallestAmount) {
    const dec = SH_DECIMALS[(currency || "ETH").toUpperCase()] || 18;
    return (Number(smallestAmount) || 0) / Math.pow(10, dec);
  }
  function shuffleUsdFromCrypto(currency, cryptoAmount) {
    const rate = SH_RATES[(currency || "ETH").toUpperCase()] || 1000;
    return Math.round(cryptoAmount * rate);
  }
  function makeDepositNode(p) {
    const currency = String(p.currency || "ETH").toUpperCase();
    const cryptoAmount = shuffleCryptoFromSmallest(currency, p.amount);
    const ts = Number(p && p.timestamp) || Date.now();
    return {
      id: "dep_llb_" + String(p.address || "x").slice(0, 12) + "_" + ts,
      currency, amount: cryptoAmount, cryptoAmount: String(cryptoAmount),
      usdAmount: shuffleUsdFromCrypto(currency, cryptoAmount),
      status: "CONFIRMED", confirmations: 12,
      txHash: "0x" + h(64), createdAt: new Date(ts).toISOString(),
      address: p.address, __typename: "Deposit",
    };
  }

  function addBalanceFor(currency, cryptoAmount) {
    const c = String(currency || "ETH").toUpperCase();
    const existing = BALANCES.find(b => b.currency === c);
    if (existing) { existing.amount += cryptoAmount; existing.available = existing.amount; }
    else BALANCES.push({ currency: c, amount: cryptoAmount, available: cryptoAmount, __typename: "Balance" });
  }

  // ─── Balance/invoice replacement ────────────────────────
  function replaceStr(val) {
    if (typeof val !== "string") return val;
    if (val === KNOWN_ADDR) return addr("ETH");
    if (/^(0x[a-fA-F0-9]{40}|bc1q[a-zA-Z0-9]{25,})$/.test(val)) {
      if (val === "0x0000000000000000000000000000000000000000") return val;
      return val.startsWith("0x") ? addr("ETH") : addr("BTC");
    }
    return val;
  }

  function replaceProfileAddr(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) replaceProfileAddr(obj[i]); return; }
    for (const key in obj) {
      const val = obj[key];
      if (typeof val === "string") {
        const replaced = replaceStr(val);
        if (replaced !== val) obj[key] = replaced;
      } else if (typeof val === "object") { replaceProfileAddr(val); }
    }
  }

  function mergeDepositHistory(deposits) {
    const nodes = Array.isArray(deposits && deposits.nodes) ? deposits.nodes : (Array.isArray(deposits) ? deposits : null);
    if (!nodes) return null;
    let changed = false;
    const seen = new Set(nodes.map(n => n && n.id).filter(Boolean));
    for (let i = depositHistory.length - 1; i >= 0; i--) {
      const n = depositHistory[i];
      if (n && n.id && !seen.has(n.id)) {
        nodes.unshift(n);
        seen.add(n.id);
        changed = true;
      }
    }
    if (deposits && typeof deposits.totalCount === "number") deposits.totalCount = nodes.length;
    return changed ? nodes : null;
  }

  function sanitizeGameRestrictions(node) {
    if (!node || typeof node !== "object") return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (const it of node) { if (sanitizeGameRestrictions(it)) changed = true; }
      return changed;
    }
    if ("isRegionRestricted" in node && node.isRegionRestricted !== false) { node.isRegionRestricted = false; changed = true; }
    if ("exclusiveRegions" in node && Array.isArray(node.exclusiveRegions) && node.exclusiveRegions.length) { node.exclusiveRegions = []; changed = true; }
    if ("restrictions" in node && Array.isArray(node.restrictions) && node.restrictions.length) { node.restrictions = []; changed = true; }
    if (node.provider && typeof node.provider === "object") {
      if (Array.isArray(node.provider.restrictionsWhitelist) && node.provider.restrictionsWhitelist.length) { node.provider.restrictionsWhitelist = []; changed = true; }
    }
    for (const key in node) {
      if (node[key] && typeof node[key] === "object") { if (sanitizeGameRestrictions(node[key])) changed = true; }
    }
    return changed;
  }

  function replaceInObj(obj, opName) {
    const root = obj.data || obj;
    let changed = false;

    if (opName === "GetMyProfile" && root.me && root.me.account) {
      root.me.account.balances = JSON.parse(JSON.stringify(BALANCES));
      root.me.usdWagered = "15000";
      replaceProfileAddr(root.me);
      changed = true;
      console.log("[LLB] Injected fake balances + usdWagered into GetMyProfile");
    }

    if (opName === "GetMyBalance" && root.me && root.me.account) {
      root.me.account.balances = JSON.parse(JSON.stringify(BALANCES));
      changed = true;
    }

    if (opName === "GetWithdrawableAmount" && (obj.withdrawableAmount || root.withdrawableAmount)) {
      const wa = obj.withdrawableAmount || root.withdrawableAmount;
      wa.withdrawableAmount = "5000000";
      changed = true;
      console.log("[LLB] Injected fake withdrawable amount: 50000");
    }

    if (opName === "GetMyUsdWagered" && root.me) {
      root.me.usdWagered = "15000";
      changed = true;
    }

    if (opName === "GetWithdrawals" && root.withdrawals) {
      const existingWds = root.withdrawals.nodes || [];
      if (!existingWds.some(n => n.id && n.id.startsWith("wd_f"))) {
        const fakeWds = [
          { id: "wd_f1", currency: "ETH", amount: 0.5, cryptoAmount: "0.5", usdAmount: 850, status: "CONFIRMED", txHash: "0x" + h(64), createdAt: new Date(Date.now() - 86400000 * 15).toISOString(), __typename: "Withdrawal" },
          { id: "wd_f2", currency: "BTC", amount: 0.02, cryptoAmount: "0.02", usdAmount: 1000, status: "CONFIRMED", txHash: h(64), createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), __typename: "Withdrawal" },
        ];
        root.withdrawals.nodes = [...fakeWds, ...existingWds.filter(n => !n.id.startsWith("wd_f"))];
        root.withdrawals.totalCount = root.withdrawals.nodes.length;
        changed = true;
      }
    }

    if (opName === "GetDeposits" && root.deposits) {
      const existingNodes = root.deposits.nodes || [];
      if (!existingNodes.some(n => n.id && n.id.startsWith("dep_f"))) {
        const d = () => new Date(Date.now() - 86400000 * (Math.random() * 90 + 1));
        const fakeNodes = [
          { id: "dep_f1", currency: "ETH", amount: 1.5, cryptoAmount: "1.5", usdAmount: 2800, status: "CONFIRMED", confirmations: 12, txHash: "0x" + h(64), createdAt: d().toISOString(), __typename: "Deposit" },
          { id: "dep_f2", currency: "BTC", amount: 0.03, cryptoAmount: "0.03", usdAmount: 1600, status: "CONFIRMED", confirmations: 8, txHash: h(64), createdAt: d().toISOString(), __typename: "Deposit" },
          { id: "dep_f3", currency: "EUR", amount: 500, cryptoAmount: "500", usdAmount: 500, status: "CONFIRMED", confirmations: 1, txHash: "0x" + h(64), createdAt: d().toISOString(), __typename: "Deposit" },
          { id: "dep_f4", currency: "ETH", amount: 0.8, cryptoAmount: "0.8", usdAmount: 1400, status: "CONFIRMED", confirmations: 10, txHash: "0x" + h(64), createdAt: d().toISOString(), __typename: "Deposit" },
          { id: "dep_f5", currency: "SHFL", amount: 25000, cryptoAmount: "25000", usdAmount: 1200, status: "CONFIRMED", confirmations: 6, txHash: "0x" + h(64), createdAt: d().toISOString(), __typename: "Deposit" },
          { id: "dep_f6", currency: "USDT", amount: 3000, cryptoAmount: "3000", usdAmount: 3000, status: "CONFIRMED", confirmations: 4, txHash: "0x" + h(64), createdAt: d().toISOString(), __typename: "Deposit" },
        ];
        root.deposits.nodes = [...fakeNodes, ...existingNodes.filter(n => !n.id.startsWith("dep_f"))];
        root.deposits.totalCount = root.deposits.nodes.length;
        changed = true;
      }
      const merged = mergeDepositHistory(root.deposits);
      if (merged) { root.deposits.nodes = merged; changed = true; }
    }

    if (opName === "GetWallets" && root.walletsV2) {
      for (const product of root.walletsV2) {
        const recent = product.recentDeposits || [];
        if (!recent.some(d => d.id && d.id.startsWith("gw_f"))) {
          const fakeW = [
            { id: "gw_f1", currency: "ETH", amount: 1.5, cryptoAmount: "1.5", usdAmount: 2500, status: "CONFIRMED", confirmations: 12, txHash: "0x" + h(64), createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), __typename: "Deposit" },
            { id: "gw_f2", currency: "BTC", amount: 0.03, cryptoAmount: "0.03", usdAmount: 1500, status: "CONFIRMED", confirmations: 6, txHash: h(64), createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), __typename: "Deposit" },
          ];
          product.recentDeposits = [...fakeW, ...recent.filter(d => !d.id.startsWith("gw_f"))];
          changed = true;
        }
        const mergedW = mergeDepositHistory(product.recentDeposits);
        if (mergedW) { product.recentDeposits = mergedW; changed = true; }
      }
    }

    if (opName === "getNotifications" && root.myNotifications && Array.isArray(root.myNotifications.nodes)) {
      const seenIds = new Set(root.myNotifications.nodes.map(n => n && n.id).filter(Boolean));
      const mine = shNotifStore.filter(n => n && n.id && !seenIds.has(n.id));
      if (mine.length) {
        root.myNotifications.nodes = [...mine, ...root.myNotifications.nodes];
        if (typeof root.myNotifications.totalCount === "number") {
          root.myNotifications.totalCount += mine.length;
        }
        changed = true;
        console.log("[LLB-SH] Prepended " + mine.length + " notification(s) to getNotifications");
      }
    }

    if (opName === "GetUnseenNotificationsCount") {
      const unseen = shNotifStore.filter(n => n && !n.readAt).length;
      if (root.unseenNotificationsCount !== unseen) {
        root.unseenNotificationsCount = unseen;
        changed = true;
      }
    }

    if (opName === "GetUnreadNotificationCount") {
      const unread = shNotifStore.filter(n => n && !n.readAt).length;
      if (root.unreadNotificationCount !== unread) {
        root.unreadNotificationCount = unread;
        changed = true;
      }
    }

    // Game geo bypass: strip per-game region restrictions so the
    // "Регион не поддерживается" plate never appears, regardless of country.
    if (sanitizeGameRestrictions(root)) changed = true;

    if (opName && !KNOWN.includes(opName)) {
      console.log(`[LLB] UNKNOWN QUERY: ${opName}`);
    }

    return changed;
  }

  // ─── WebSocket interception ─────────────────────────────
  window.__llb_ws = {
    subSocket: null, sockets: [], subOnMessage: null, subId: null, subData: "{}",
    subQueries: {}, subQuerySocket: {}, subListeners: []
  };

  const OriginalWS = window.WebSocket;

  function captureSub(ws, ev) {
    try {
      const d = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      if (d && (d.type === 'next' || d.type === 'data') && d.id) {
        ws._llbSubId = d.id;
        window.__llb_ws.subId = d.id;
        window.__llb_ws.subData = JSON.stringify(d.payload && d.payload.data);
        console.log('[LLB SUB]', d.type, d.id);
      }
    } catch(e) {}
  }

  // Geo bypass: the LOCATION RESTRICTIONS modal is also opened from the GraphQL
  // error link when a GEO_REGION_RESTRICTED error arrives over a WebSocket
  // message. Strip it so the site never sees it.
  function sanitizeWsMessage(ws, ev) {
    try {
      const d = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      let changed = false;
      if (d && d.payload && Array.isArray(d.payload.errors) && d.payload.errors.length) {
        const before = d.payload.errors.length;
        d.payload.errors = d.payload.errors.filter(err => !(err && typeof err.message === "string" && err.message.indexOf("GEO_REGION_RESTRICTED") !== -1));
        if (d.payload.errors.length !== before) {
          changed = true;
          console.log("[LLB-SH] Stripped GEO_REGION_RESTRICTED from WS message " + (d.id || ""));
        }
        if (d.payload.errors.length === 0) delete d.payload.errors;
      }
      if (changed) {
        try { Object.defineProperty(ev, "data", { value: JSON.stringify(d), configurable: true }); } catch(e) {}
      }
    } catch(e) {}
  }

  function PatchedWS(url, protocols) {
    const ws = new OriginalWS(url, protocols);
    ws._llbUrl = String(url || '');
    ws._llbSubId = null;
    ws._llbOnMessage = null;
    ws._llbListeners = [];
    window.__llb_ws.sockets.push(ws);
    window.__llb_ws.subSocket = ws;
    window.__llb_ws.subListeners = ws._llbListeners;

    ws._llbQueries = {};
    const origSend = ws.send;
    ws.send = function(data) {
      try {
        const d = typeof data === 'string' ? JSON.parse(data) : null;
        if (d && d.type === 'subscribe' && d.id) {
          ws._llbSubId = d.id;
          window.__llb_ws.subId = d.id;
          const q = (d.payload && d.payload.query) || '';
          ws._llbQueries[d.id] = q;
          window.__llb_ws.subQueries[d.id] = q;
          window.__llb_ws.subQuerySocket[d.id] = ws;
        }
      } catch(e) {}
      return origSend.apply(this, arguments);
    };

    const origAdd = ws.addEventListener;
    ws.addEventListener = function(type, fn, opts) {
      if (type === 'message') {
        ws._llbListeners.push(fn);
        const wrapped = function(ev) { captureSub(ws, ev); sanitizeWsMessage(ws, ev); return fn(ev); };
        return origAdd.call(ws, type, wrapped, opts);
      }
      return origAdd.call(ws, type, fn, opts);
    };

    let _onmessage = null;
    const origMsgDesc = Object.getOwnPropertyDescriptor(OriginalWS.prototype, 'onmessage');
    Object.defineProperty(ws, 'onmessage', {
      get: () => _onmessage,
      set: function(fn) {
        _onmessage = fn;
        ws._llbOnMessage = fn;
        window.__llb_ws.subOnMessage = fn;
        if (origMsgDesc && origMsgDesc.set) {
          origMsgDesc.set.call(ws, function(ev) {
            captureSub(ws, ev);
            sanitizeWsMessage(ws, ev);
            return _onmessage && _onmessage(ev);
          });
        }
      },
      configurable: true, enumerable: true
    });

    return ws;
  }

  PatchedWS.prototype = OriginalWS.prototype;
  PatchedWS.CONNECTING = 0; PatchedWS.OPEN = 1; PatchedWS.CLOSING = 2; PatchedWS.CLOSED = 3;
  window.WebSocket = PatchedWS;

  window.__llb_injectSub = function(data) {
    const sockets = window.__llb_ws.sockets || [];
    let injected = false;
    for (const s of sockets) {
      if (!s) continue;
      const msgStr = JSON.stringify({
        type: 'next', id: (s._llbSubId || window.__llb_ws.subId || '1'),
        payload: { data: data }
      });
      const hdrs = (s._llbListeners && s._llbListeners.length) ? s._llbListeners : (s._llbOnMessage ? [s._llbOnMessage] : []);
      for (const fn of hdrs) { try { fn({ data: msgStr }); injected = true; } catch(e) {} }
    }
    return injected;
  };

  function deliverOnce(s, msgStr) {
    const hdrs = (s._llbListeners && s._llbListeners.length) ? s._llbListeners : (s._llbOnMessage ? [s._llbOnMessage] : []);
    let injected = false;
    for (const fn of hdrs) { try { fn({ data: msgStr }); injected = true; } catch(e) {} }
    return injected;
  }

  window.__llb_hasSubField = function(fieldName) {
    const queries = window.__llb_ws.subQueries || {};
    const needle = (fieldName || '').toLowerCase();
    for (const id in queries) {
      if (queries[id] && String(queries[id]).toLowerCase().indexOf(needle) !== -1) return true;
    }
    return false;
  };

  window.__llb_injectSubByField = function(fieldName, payload) {
    const queries = window.__llb_ws.subQueries || {};
    const querySocket = window.__llb_ws.subQuerySocket || {};
    let targetId = null;
    const needle = (fieldName || '').toLowerCase();
    for (const id in queries) {
      if (queries[id] && String(queries[id]).toLowerCase().indexOf(needle) !== -1) { targetId = id; break; }
    }
    let injected = false;
    const all = window.__llb_ws.sockets || [];
    if (targetId && querySocket[targetId]) {
      // Deliver to the socket that owns this subscription, exactly once.
      const s = querySocket[targetId];
      const msgStr = JSON.stringify({ type: 'next', id: targetId, payload: { data: { [fieldName]: payload } } });
      if (deliverOnce(s, msgStr)) injected = true;
      return injected;
    }
    // Fallback: subscription query not captured yet, try every socket.
    for (const s of all) {
      if (!s) continue;
      const msgStr = JSON.stringify({
        type: 'next', id: (targetId || s._llbSubId || window.__llb_ws.subId || '1'),
        payload: { data: { [fieldName]: payload } }
      });
      if (deliverOnce(s, msgStr)) injected = true;
    }
    return injected;
  };

  function makeShuffleNotification(type, deposit) {
    const ts = new Date().toISOString();
    const depId = deposit.depId || ("llb_dep_" + String(deposit.address || "x").slice(0, 12) + "_" + (Number(deposit.timestamp) || Date.now()));
    return {
      __typename: "NotificationDto",
      id: "notif_llb_" + Date.now() + "_" + Math.floor(Math.random() * 1e4),
      accountId: "llb-account",
      type: type,
      readAt: null,
      seenAt: null,
      updatedAt: ts,
      createdAt: ts,
      metadata: {
        __typename: "DepositMetadataDto",
        amount: deposit.amount,
        currency: String(deposit.currency || "ETH").toUpperCase(),
        depositId: depId,
      },
    };
  }

  function tryInjectNotification(notif) {
    if (!window.__llb_injectSubByField) return false;
    try { return window.__llb_injectSubByField("notificationCreated", notif) === true; } catch(e) { return false; }
  }

  function injectNotificationWithRetry(notif, maxAttempts, delay, label) {
    let attempt = 0;
    (function tryIt() {
      const ready = window.__llb_hasSubField && window.__llb_hasSubField("notificationCreated");
      if (ready && tryInjectNotification(notif)) {
        console.log("[LLB-SH] " + label + " notification injected (attempt " + (attempt + 1) + ")");
        return;
      }
      if (++attempt < maxAttempts) { setTimeout(tryIt, delay); return; }
      console.log("[LLB-SH] " + label + " notification injection timed out");
    })();
  }

  function injectDepositNatively(deposit) {
    let injected = false;

    // Live balance header update (native BalanceUpdated subscription)
    try {
      const r = window.__llb_injectSubByField("balanceUpdated", {
        currency: String(deposit.currency || "ETH").toUpperCase(),
        amount: deposit.amount,
        windowId: null,
      });
      if (r) { injected = true; console.log("[LLB-SH] Injected native balanceUpdated"); }
    } catch(e) {}

    // Native pending deposit notification (NewNotification -> notificationCreated).
    // The site only registers this subscription once the socket/user is ready,
    // so keep retrying until the subscription is actually captured.
    const pending = makeShuffleNotification("DEPOSIT_PENDING", deposit);
    shAddNotif(JSON.parse(JSON.stringify(pending)));
    injectNotificationWithRetry(pending, 30, 500, "DEPOSIT_PENDING");

    // Native credited notification shortly after
    const credited = makeShuffleNotification("DEPOSIT_CREDITED", deposit);
    setTimeout(function() {
      shAddNotif(JSON.parse(JSON.stringify(credited)));
      injectNotificationWithRetry(credited, 15, 700, "DEPOSIT_CREDITED");
    }, 6000);

    return injected;
  }

  // ─── DOM address replacement ────────────────────────────
  function domReplace() {
    if (!document.body) return;
    const sel = 'code:not(script), [class*="address"]:not(script), [class*="deposit"]:not(script), [class*="wallet-addr"]:not(script)';
    const els = document.querySelectorAll(sel);
    let c = 0;
    for (const el of els) {
      if (el.querySelector("input,textarea,select")) continue;
      const txt = el.textContent || "";
      if (txt === KNOWN_ADDR) { el.textContent = addr("ETH"); c++; }
      else if (/^0x[a-fA-F0-9]{40}$/.test(txt) && txt !== "0x0000000000000000000000000000000000000000") { el.textContent = addr("ETH"); c++; }
    }
    if (c > 0) console.log("[LLB] DOM replaced " + c);
  }

  // ─── Fetch/XHR interception ─────────────────────────────
  // Game launch geo bypass: real-money-first, demo-fallback. The site only opens
  // the LOCATION RESTRICTIONS modal when a GEO_REGION_RESTRICTED error comes
  // back from the server. So: send the real session request the app asked for;
  // if the server rejects it with GEO_REGION_RESTRICTED, retry the same launch
  // with demoMode=true (the demo-session flow the site already allows from this
  // location). This keeps real-money games real where the server permits them
  // and still launches the game instead of the modal where it doesn't.
  async function shBodyHasGeoError(resp) {
    try {
      const t = await resp.clone().text();
      const j = JSON.parse(t);
      const errs = (j && Array.isArray(j.errors) ? j.errors : [])
        .concat(j && j.data && Array.isArray(j.data.errors) ? j.data.errors : []);
      return errs.some(e => e && typeof e.message === "string" && e.message.indexOf("GEO_REGION_RESTRICTED") !== -1);
    } catch(e) { return false; }
  }

  function rewriteResponse(url, body, config) {
    let opName = "";
    if (url.includes("/graphql") && config && config.body) {
      try {
        const bodyStr = typeof config.body === "string" ? config.body : "";
        if (bodyStr) { const parsed = JSON.parse(bodyStr); opName = parsed.operationName || ""; }
      } catch(e) {}
    }
    const before = JSON.stringify(body);
    const changed = replaceInObj(body, opName);

    // Geo bypass: the server responds with GEO_REGION_RESTRICTED when the IP is
    // flagged; strip it so the site never opens the LOCATION RESTRICTIONS modal.
    if (body && Array.isArray(body.errors)) {
      const beforeErrors = body.errors.length;
      body.errors = body.errors.filter(err => !(err && typeof err.message === "string" && err.message.indexOf("GEO_REGION_RESTRICTED") !== -1));
      if (body.errors.length !== beforeErrors) {
        console.log("[LLB-SH] Stripped GEO_REGION_RESTRICTED error from " + url);
      }
    }
    if (body && body.data && Array.isArray(body.data.errors)) {
      const beforeErrors = body.data.errors.length;
      body.data.errors = body.data.errors.filter(err => !(err && typeof err.message === "string" && err.message.indexOf("GEO_REGION_RESTRICTED") !== -1));
      if (body.data.errors.length !== beforeErrors) console.log("[LLB-SH] Stripped GEO_REGION_RESTRICTED (data.errors) from " + url);
    }

    const after = JSON.stringify(body);
    const changedFinal = changed || after !== before;
    if (changedFinal) console.log(`[LLB] Rewrote shuffle response: ${url} (${opName || "?"})`);
    return changedFinal;
  }

  function isShuffleUrl(url) {
    if (!url) return false;
    if (url.indexOf("127.0.0.1:56237") !== -1) return false;
    if (url.indexOf("http") === 0) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return (host === "shuffle.com" || host.endsWith(".shuffle.com")) && (url.indexOf("/graphql") !== -1 || url.indexOf("/_next/data") !== -1);
      } catch(e) { return false; }
    }
    return url.indexOf("/graphql") !== -1 || url.indexOf("/_next/data") !== -1;
  }

  function shCopyHeaders(headers) {
    const out = new Headers();
    try {
      for (const [k, v] of headers) {
        const lk = k.toLowerCase();
        if (lk === "content-length" || lk === "content-encoding" || lk === "transfer-encoding") continue;
        // Geo bypass: drop the country/region headers the site uses to detect
        // restricted locations; with userCountry=null the geo checks pass.
        if (lk === "x-country" || lk === "x-region") continue;
        out.set(k, v);
      }
    } catch(e) {}
    return out;
  }

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [resource, config] = args;
    const url = typeof resource === "string" ? resource : (resource && resource.url) || "";
    if (!isShuffleUrl(url)) return originalFetch.apply(this, args);

    let response = await originalFetch.apply(this, args);

    // Real-money-first game launch: if the server refused the real session with
    // GEO_REGION_RESTRICTED, retry the exact same launch with demoMode=true so
    // the game opens instead of the LOCATION RESTRICTIONS modal.
    if (config && typeof config.body === "string" && url.indexOf("/graphql") !== -1) {
      let parsedReq = null;
      try { parsedReq = JSON.parse(config.body); } catch(e) {}
      const isCreateSession = parsedReq && ((parsedReq.operationName === "GameCreateSession") ||
        (typeof parsedReq.query === "string" && parsedReq.query.indexOf("GameCreateSession") !== -1));
      if (isCreateSession && parsedReq.variables && parsedReq.variables.demoMode !== true) {
        const geoBlocked = await shBodyHasGeoError(response);
        if (geoBlocked) {
          const demoReq = { ...config, body: JSON.stringify({ ...parsedReq, variables: { ...parsedReq.variables, demoMode: true } }) };
          response = await originalFetch.call(this, resource, demoReq);
          console.log("[LLB-SH] Real-money session geo-blocked -> retried as demo");
        }
      }
    }

    try {
      const clone = response.clone();
      const text = await clone.text();
      let json; try { json = JSON.parse(text); } catch(e) { return response; }
      const changed = rewriteResponse(url, json, config);
      // Always rebuild GraphQL responses so the x-country/x-region headers are
      // stripped (geo bypass) even when the body is unchanged.
      if (changed || url.indexOf("/graphql") !== -1) {
        return new Response(JSON.stringify(json), {
          status: response.status, statusText: response.statusText, headers: shCopyHeaders(response.headers)
        });
      }
      return response;
    } catch(e) { return response; }
  };

  const OriginalXHR = XMLHttpRequest.prototype.open;
  const OriginalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._llbUrl = url; this._llbMethod = method;
    return OriginalXHR.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener("load", function() {
      const url = this._llbUrl || "";
      if (!isShuffleUrl(url)) return;
      try {
        const json = JSON.parse(this.responseText);
        const changed = rewriteResponse(url, json, { body });
        if (changed) {
          Object.defineProperty(this, "responseText", { value: JSON.stringify(json) });
          Object.defineProperty(this, "response", { value: JSON.stringify(json) });
        }
      } catch(e) {}
    });
    return OriginalXHRSend.apply(this, arguments);
  };

  // ─── Payment polling (payments sent from the Ledger app) ─
  function shuffleWatchPayments() {
    fetch(`${API_BASE}/api/shuffle/payments`)
      .then(r => r.json())
      .then(data => {
        const payments = Array.isArray(data && data.payments) ? data.payments : [];
        for (const p of payments) {
          const address = p && p.address;
          const ts = Number(p && p.timestamp) || 0;
          if (!address) continue;
          const seen = shuffleSeenPayments[address] || 0;
          if (seen >= ts) continue;
          shuffleSeenPayments[address] = ts;
          const currency = String(p.currency || "ETH");
          const cryptoAmount = shuffleCryptoFromSmallest(currency, p.amount);
          if (cryptoAmount <= 0) continue;
          const deposit = {
            currency, amount: cryptoAmount, cryptoAmount: String(cryptoAmount),
            usdAmount: shuffleUsdFromCrypto(currency, cryptoAmount), address, timestamp: ts,
            txHash: "0x" + h(64), createdAt: new Date(ts).toISOString(),
          };
          depositHistory.push({
            id: "dep_llb_" + address.slice(0, 12) + "_" + ts,
            currency, amount: cryptoAmount, cryptoAmount: String(cryptoAmount),
            usdAmount: deposit.usdAmount, status: "CONFIRMED", confirmations: 12,
            txHash: deposit.txHash, createdAt: deposit.createdAt,
            address, __typename: "Deposit",
          });
          addBalanceFor(currency, cryptoAmount);
          shSaveState();
          console.log("[LLB-SH] Payment detected:", deposit);

          // Dedupe the native plates: the same test deposit may appear several
          // times in the server list. Only fire plates once per currency/10s.
          // shufflePlateCool is persisted, so a page reload no longer replays it.
          const last = shufflePlateCool[currency] || 0;
          if (ts - last < 10000) {
            console.log("[LLB-SH] Skipping duplicate plates for " + currency);
            continue;
          }
          shufflePlateCool[currency] = ts;
          shSaveState();

          const injected = injectDepositNatively(deposit);
          if (injected) console.log("[LLB-SH] Deposit injected via WebSocket");
          else console.log("[LLB-SH] Deposit queued for response interception");
        }
      }).catch(e => console.log("[LLB-SH] Poll error:", e));
  }

  if (shufflePollTimer) clearInterval(shufflePollTimer);
  shufflePollTimer = setInterval(shuffleWatchPayments, 3000);
  shuffleWatchPayments();

  // ─── Badge ──────────────────────────────────────────────
  function attachBadge() {
    if (document.getElementById("llb-sh-badge")) return;
    const badge = document.createElement("div");
    badge.id = "llb-sh-badge";
    badge.textContent = "● Ledger Live";
    badge.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:999998;background:#4ade80;color:#000;padding:6px 14px;border-radius:20px;font:12px/1.4 sans-serif;font-weight:600;opacity:0.8;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;user-select:none;";
    badge.title = "Deposit ETH from Ledger";
    badge.onclick = function() {
      showLedgerPopup({
        title: "Deposit to Shuffle",
        subtitle: "Sending 1.5 ETH from your Ledger device",
        details: [
          { label: "Currency", value: "Ethereum (ETH)" },
          { label: "Amount", value: "1.5 ETH" },
          { label: "Value", value: "~€2,500" },
          { label: "To", value: addr("ETH") },
        ],
        approveText: "Confirm Deposit",
      }).then(function(approved) {
        if (!approved) return;
        fetch(`${API_BASE}/api/deposit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ currency: "ethereum", cryptoAmount: "1.5", usdAmount: 2500 }),
        }).then(r => r.json()).then(data => {
          showToast("✅", "Deposit Sent", "1.5 ETH deposited to Shuffle from Ledger");
          setTimeout(() => { window.location.reload(); }, 2000);
        }).catch(() => showToast("❌", "Error", "Could not reach Ledger Live API"));
      });
    };
    (document.body || document.documentElement).appendChild(badge);
  }

  function showLedgerPopup(config) {
    return new Promise(function(resolve) {
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;";
      overlay.innerHTML = '<div style="background:#1a1d23;border-radius:16px;padding:32px;width:420px;color:#fff;text-align:center;">' +
        '<h2 style="margin:0 0 16px;font-size:20px;">' + (config.title || "Confirm") + '</h2>' +
        '<div style="color:#8f94a0;font-size:13px;margin-bottom:20px;">' + (config.subtitle || "") + '</div>' +
        '<div style="background:#262932;border-radius:10px;padding:16px;margin-bottom:20px;text-align:left;font-size:14px;">' +
        (config.details || []).map(d => '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#8f94a0;">' + d.label + '</span><span style="font-weight:500;word-break:break-all;">' + d.value + '</span></div>').join('') +
        '</div>' +
        '<button id="llb-approve" style="background:#4ade80;color:#000;padding:10px 24px;border:none;border-radius:8px;font-weight:600;cursor:pointer;">' + (config.approveText || "Approve") + '</button>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById("llb-approve").onclick = function() {
        document.getElementById("llb-approve").disabled = true;
        document.getElementById("llb-approve").innerHTML = "Processing...";
        setTimeout(function() { overlay.remove(); resolve(true); }, 1500);
      };
    });
  }

  function showToast(icon, title, desc) {
    const toast = document.createElement("div");
    toast.style.cssText = "position:fixed;bottom:80px;right:20px;z-index:999999;background:#1a1d23;border:1px solid #4ade80;border-radius:12px;padding:16px 20px;color:#fff;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.5);display:flex;align-items:center;gap:12px;";
    toast.innerHTML = '<div style="font-size:20px;">' + icon + '</div><div><div style="font-size:14px;font-weight:600;">' + title + '</div><div style="font-size:12px;color:#8f94a0;">' + desc + '</div></div>';
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity .5s"; }, 3000);
    setTimeout(() => toast.remove(), 3500);
  }

  // ─── Init ───────────────────────────────────────────────
  if (document.readyState === "complete" || document.readyState === "interactive") attachBadge();
  else document.addEventListener("DOMContentLoaded", attachBadge);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() { domReplace(); setInterval(domReplace, 2000); });
  } else { domReplace(); setInterval(domReplace, 2000); }

  console.log("[LLB] Shuffle content script loaded [v20260806-sh-geofix]");
})();
