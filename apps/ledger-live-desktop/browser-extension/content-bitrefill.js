// content-bitrefill.js — Bitrefill content script (MV3 MAIN world)
// All balance/order data is overridden at the API-response level before
// React renders it. We never patch DOM text nodes (that throws React #418).
// Key rule: the invoice POST (checkout creation) response is NEVER rewritten.

(function() {
  "use strict";

  const API_BASE = "http://127.0.0.1:56237";
  const BR_STATE_KEY = "llb-br-state";

  let fakeBalance = 2537.41;
  let fakeCurrency = "EUR";
  let brPurchasedOrders = [];
  let brPaidAddresses = [];
  let brUsedOrderIds = new Set();
  let brCartId = "";
  let brCartClearedFor = "";
  let brSeenPayments = {};
  let brPollTimer = null;
  let brFxRates = null;

  // ─── Helpers ─────────────────────────────────────────────
  function brConvertBalance(toCur) {
    const to = String(toCur || fakeCurrency).toUpperCase();
    if (to === String(fakeCurrency).toUpperCase()) return fakeBalance;
    try {
      if (brFxRates) {
        const r = brFxRates[fakeCurrency] || (brFxRates.rates && brFxRates.rates[fakeCurrency]);
        if (r && typeof r === "object" && typeof r[to] === "number") return fakeBalance * r[to];
      }
    } catch (e) {}
    return fakeBalance;
  }

  // Real order objects carry BOTH `operator` and `operatorObject` (each with
  // slug/_id). The UI reads `order.operatorObject.slug` / `.operatorObject._id`
  // and crashes with "Cannot read properties of undefined (reading 'slug')"
  // when a fake order lacks one. Normalize so every persisted order has both.
  function brNormalizeOrder(o) {
    if (!o || typeof o !== "object") return o;
    const opObj = o.operatorObject;
    const op = o.operator;
    if (!opObj && op && typeof op === "object") {
      o.operatorObject = {
        _id: op._id || op.slug || "",
        slug: op.slug || op._id || "",
        name: op.name || "",
        type: op.type || "",
        categories: op.categories || [],
        countries: op.countries || [],
        isPinBased: !!op.isPinBased,
      };
    } else if (!op && opObj && typeof opObj === "object") {
      o.operator = {
        _id: opObj._id || opObj.slug || "",
        slug: opObj.slug || opObj._id || "",
        name: opObj.name || "",
        type: opObj.type || "",
      };
    }
    if (typeof o.value !== "number") {
      if (typeof o.amount === "number") o.value = o.amount;
      else if (typeof o.price === "number") o.value = o.price;
    }
    if (typeof o.number !== "string") o.number = "";
    return o;
  }

  function brItemId(o) {
    if (!o || typeof o !== "object") return null;
    return o.id || o.order_id || o.invoice_id || o.cart_item_id ||
           (o.operator && (o.operator._id || o.operator.slug)) ||
           (o.product && (o.product.slug || o.product._id)) ||
           o.sku || o.product_id || null;
  }

  // Two paths used to persist the same purchase (cart items vs invoice orders)
  // under DIFFERENT id shapes (cart_item_id vs order_id), which is why every
  // purchase showed up twice in My Products. When ids can't agree, fall back
  // to matching on operator slug + amount (tolerating a 100x cents-vs-euros
  // unit mismatch) so the same product is only ever recorded once.
  function brProductSlug(o) {
    if (!o || typeof o !== "object") return "";
    const op = o.operatorObject || o.operator ||
               (o.product && (o.product.operator || o.operatorObject)) || null;
    const slug = (op && (op.slug || op._id)) ||
                 o.operator_slug || o.product_slug ||
                 (o.product && (o.product.slug || o.product._id)) || "";
    return String(slug || "");
  }

  function brAmountForCompare(o) {
    // amounts arrive as numbers (cents/micro-units) or numeric strings (cart
    // item `value: "80"`) — coerce strings so dedupe/filtering always works
    const pick = k => {
      const v = o[k];
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
      return 0;
    };
    const raw = pick("amount") || pick("value") || pick("price");
    return Math.abs(Number(raw));
  }

  function brClose(a, b) {
    if (!a || !b) return false;
    return Math.abs(a - b) / Math.min(Math.abs(a), Math.abs(b)) < 0.01;
  }

  function brProductKeyMatch(a, b) {
    const sa = brProductSlug(a), sb = brProductSlug(b);
    if (!sa || !sb || sa !== sb) return false;
    const ca = brAmountForCompare(a), cb = brAmountForCompare(b);
    if (!ca || !cb) return false;
    const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
    const ratio = hi / lo;
    return ratio < 1.01 || (ratio > 99 && ratio < 101);
  }

  // Exact-id membership test against previously persisted purchases. Used by
  // the delivery path so two genuinely different units of the same product
  // (5 Roblox cards) are each persisted as their own lot instead of being
  // collapsed into one via the fuzzy slug+amount matcher.
  function brHasPurchasedId(id) {
    if (!id) return false;
    const s = String(id);
    return brPurchasedOrders.some(p => String(brItemId(p)) === s);
  }

  // True when `v` is in the same ballpark as the invoice's crypto total
  // (both expressed in the payment asset's micro-units, e.g. 121695 vs
  // 615435). A sane fiat per-unit price (e.g. 200 = EUR 200.00) is orders of
  // magnitude smaller than 6e5, so it is NOT rewritten. This is what keeps
  // "5 x EUR 200.00 value" from turning into "5 x EUR 1,008.00 value".
  function brLooksLikeCryptoUnits(v, priceMicro) {
    if (typeof v !== "number" || v <= 0) return false;
    if (typeof priceMicro !== "number" || priceMicro <= 0) return false;
    const lo = Math.min(v, priceMicro), hi = Math.max(v, priceMicro);
    if (!lo) return false;
    return hi / lo < 100;
  }

  function brIsPurchased(item) {
    const id = brItemId(item);
    if (id) {
      const s = String(id);
      for (const p of brPurchasedOrders) {
        if (String(brItemId(p)) === s) return true;
      }
    }
    for (const p of brPurchasedOrders) {
      if (brProductKeyMatch(p, item)) return true;
    }
    return false;
  }
  // My Products displays `value` directly (no /100). For crypto invoices the
  // fiat price is inv.eurPrice/inv.usdPrice (decimal: 201.6 = EUR 201.60) —
  // inv.price is the payment amount in the ASSET's micro-units (121237 =
  // 0.121237 ETH), so it must NOT be used directly for the fiat display. The
  // renderer reads `createdTime` for the date, backfilled from invoiceTime.
  function brDisplayValue(copy, price) {
    const v = (typeof copy.value === "number" && copy.value > 0) ? copy.value
            : (typeof copy.amount === "number" && copy.amount > 0) ? copy.amount
            : (typeof copy.price === "number" && copy.price > 0) ? copy.price : 0;
    if (!v) return price ? price / 100 : 0;
    if (price && price > 0) {
      if (brClose(v * 100, price)) return v;        // already display units
      if (brClose(v, price)) return v / 100;         // cents -> display units
      return price / 100;                            // fall back to paid price
    }
    return v;
  }

  // Builds the My Products entry for ONE delivered unit. `inv.eurPrice` is the
  // invoice FIAT TOTAL, so it is divided by the line quantity: each lot must
  // carry the per-unit price, never the whole-invoice sum (that was the bug
  // that rendered "5 x EUR 1,008.00 value" and "EUR 10.08" in My Products).
  function brFakeOrderFrom(copy, inv, now, quantity, unitIndex, origValue) {
    const fiat = (typeof inv.eurPrice === "number" && inv.eurPrice > 0) ? inv.eurPrice
               : (typeof inv.usdPrice === "number" && inv.usdPrice > 0) ? inv.usdPrice
               : null;
    const price = (typeof inv.price === "number" && inv.price > 0) ? inv.price : null;
    const n = Math.max(1, Number(quantity) || 1);
    const perUnit = fiat !== null ? fiat / n : brDisplayValue(copy, price) / n;
    const ts = copy.createdTime || copy.invoiceTime || copy.created_at ||
               inv.invoiceTime || inv.created_at || now;
    // `value` carries the per-unit fiat display amount the My Products renderer
    // shows. `amount` keeps the ORIGINAL payload value (face value "30" or
    // crypto micro-units) so product-key dedupe still matches this order
    // against cart_items that carry the same raw `value` — this is what lets
    // the cart recognise the purchase as done and clears it.
    const oRaw = (typeof origValue === "number" && origValue > 0) ? origValue
               : (typeof origValue === "string") ? (Number(origValue) > 0 ? Number(origValue) : 0)
               : 0;
    const origAmount = oRaw > 0 ? oRaw
                     : (typeof copy.amount === "number" && copy.amount > 0) ? copy.amount
                     : (typeof copy.price === "number" && copy.price > 0) ? copy.price
                     : perUnit;
    return Object.assign({}, copy, {
      id: copy.id,
      order_id: copy.id,
      currency: copy.currency || inv.currency || fakeCurrency,
      value: perUnit,
      amount: origAmount,
      paidAmount: fiat !== null ? fiat : (price || perUnit * 100),
      quantity: 1,
      unitIndex: typeof unitIndex === "number" ? unitIndex : 0,
      used: false,
      is_used: false,
      delivered: true,
      status: "delivered",
      createdTime: ts,
      created_at: typeof ts === "number" ? new Date(ts).toISOString() : ts,
      time: ts,
      _fake: true,
    });
  }

  // ─── Persistence ─────────────────────────────────────────
  function brSaveState() {
    try {
      localStorage.setItem(BR_STATE_KEY, JSON.stringify({
        fakeBalance,
        fakeCurrency,
        brPaidAddresses,
        brSeenPayments,
        brUsedOrderIds: Array.from(brUsedOrderIds),
        brPurchasedOrders: brPurchasedOrders.map(o => JSON.parse(JSON.stringify(o))),
      }));
    } catch (e) {}
  }
  function brLoadState() {
    try {
      const r = JSON.parse(localStorage.getItem(BR_STATE_KEY) || "{}");
      if (typeof r.fakeBalance === "number") { fakeBalance = r.fakeBalance; fakeCurrency = r.fakeCurrency || "EUR"; }
      if (Array.isArray(r.brPaidAddresses)) brPaidAddresses = r.brPaidAddresses.slice();
      if (r.brSeenPayments && typeof r.brSeenPayments === "object") brSeenPayments = r.brSeenPayments;
      if (Array.isArray(r.brUsedOrderIds)) brUsedOrderIds = new Set(r.brUsedOrderIds.map(String));
      if (Array.isArray(r.brPurchasedOrders)) brPurchasedOrders = r.brPurchasedOrders.slice();
    } catch (e) {}
  }
  brLoadState();
  brSanitizePurchased();

  // One-time cleanup of the persisted purchase list. Older versions persisted
  // the same purchase twice (cart-shaped + invoice-shaped, different ids), with
  // cents as value (=> "EUR 15213.00") and no createdTime (=> "Invalid Date").
  function brSanitizePurchased() {
    if (!Array.isArray(brPurchasedOrders)) { brPurchasedOrders = []; return; }
    let keep = [];
    for (const o of brPurchasedOrders) {
      if (!o || typeof o !== "object") continue;
      // unrepairable cart artifacts from the old cart-delivery path: no real
      // amount/value/price anywhere -> would render as "€0"
      if (o._fake && !(typeof o.value === "number" && o.value > 0) &&
          !(typeof o.amount === "number" && o.amount > 0) &&
          !(typeof o.price === "number" && o.price > 0)) continue;
      const keepScore = x => (x.createdTime || x.invoiceTime || x.created_at ? 1 : 0) +
                            (typeof x.value === "number" && x.value > 0 ? 1 : 0) +
                            (x.operatorObject ? 1 : 0);
      const oid = String(brItemId(o) || "");
      let matched = false;
      if (oid) {
        // Entries with a real id are distinct lots (4 items => 4 lots). Only
        // collapse a true duplicate that reuses the SAME id, keeping the richer.
        for (let i = 0; i < keep.length; i++) {
          if (String(brItemId(keep[i]) || "") === oid) {
            if (keepScore(o) > keepScore(keep[i])) keep[i] = o;
            matched = true;
            break;
          }
        }
      } else {
        // Id-less legacy rows (cart-shaped) fall back to slug+amount collapse.
        for (let i = 0; i < keep.length; i++) {
          if (!String(brItemId(keep[i]) || "") && brProductKeyMatch(keep[i], o)) {
            if (keepScore(o) > keepScore(keep[i])) keep[i] = o;
            matched = true;
            break;
          }
        }
      }
      if (!matched) keep.push(o);
    }
    for (const o of keep) {
      const cartShaped = !o.createdTime && !o.invoiceTime && !o.created_at;
      if (cartShaped) {
        const ts = Date.now();
        o.createdTime = ts;
        o.created_at = new Date(ts).toISOString();
        o.time = ts;
      }
      // repair cents-as-euros on legacy rows (integer >= 1000 with no decimal
      // counterpart). The new persistence path stores per-unit display values
      // and always sets `quantity`, so this only ever touches old rows.
      if (!(typeof o.quantity === "number" && o.quantity > 0) &&
          typeof o.value === "number" && o.value >= 1000 &&
          (typeof o.amount !== "number" || o.amount === o.value)) {
        o.value = o.value / 100;
        if (typeof o.amount === "number") o.amount = o.value;
      }
      if (typeof o.createdTime === "undefined") o.createdTime = o.created_at || o.invoiceTime || Date.now();
      // every row in this list is a delivered fake purchase by construction
      o.delivered = true;
      o.status = "delivered";
      if (typeof o.value !== "number" || o.value === 0) {
        const p = typeof o.price === "number" && o.price > 0 ? o.price
                : typeof o.amount === "number" && o.amount > 0 ? o.amount : 0;
        if (p) o.value = p / 100;
      }
    }
    // Drop unrecoverable rows written by the pre-fix builds. Two signatures:
    //   1) `value` was the invoice TOTAL and later divided by 100 (EUR
    //      1,008.00 -> EUR 10.08) with no `quantity` stored -> value ≈ paidAmount/100.
    //   2) `value` was still the TOTAL while `amount` already carried the
    //      per-unit raw (value = 201.60, amount = 50.40, ratio 4) -> the old
    //      persist passed quantity=1 for separate order lines.
    keep = keep.filter(o => {
      if (!o || !o._fake) return true;
      if (typeof o.value !== "number" || o.value <= 0) return true;
      const badCents = typeof o.paidAmount === "number" && o.paidAmount > 0 &&
        !(typeof o.quantity === "number" && o.quantity > 0) &&
        Math.abs(o.paidAmount / o.value - 100) < 0.5;
      const badTotal = typeof o.amount === "number" && o.amount > 0 &&
        o.value / o.amount > 1.5;
      if (badCents || badTotal) {
        console.log("[LLB-BR] Dropped unrecoverable buggy order:", JSON.stringify({
          id: brItemId(o), operator: brProductSlug(o), value: o.value,
          amount: o.amount, paidAmount: o.paidAmount,
        }));
        return false;
      }
      return true;
    });
    brPurchasedOrders = keep;
    brSaveState();
  }

  // ─── URL / headers ───────────────────────────────────────
  function brIsBitrefillUrl(url) {
    if (!url) return false;
    if (url.indexOf("127.0.0.1:56237") !== -1) return false;
    if (url.indexOf("http") === 0) {
      try {
        const h = new URL(url).hostname.toLowerCase();
        return h === "bitrefill.com" || h.endsWith(".bitrefill.com");
      } catch (e) { return false; }
    }
    return true;
  }

  function brCopyHeaders(headers) {
    const out = new Headers();
    try {
      for (const [k, v] of headers) {
        const lk = k.toLowerCase();
        if (lk === "content-length" || lk === "content-encoding") continue;
        out.set(k, v);
      }
    } catch (e) {}
    return out;
  }

  // ─── Balance injection (only zero balance/credit values) ──
  function brInjectZeroBalances(obj) {
    if (!obj || typeof obj !== "object") return false;
    let c = false;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "number" && /^(balance|credit|total_balance|available_balance)$/i.test(k) && v === 0) {
        obj[k] = fakeBalance;
        c = true;
      } else if (v && typeof v === "object") {
        if (brInjectZeroBalances(v)) c = true;
      }
    }
    return c;
  }

  // ─── Invoice delivery (confirmation screen) ──────────────
  // Marks the invoice GET response as paid when its payment address was seen,
  // and persists the orders into My Products.
  // Status literals come from the frontend bundle embedded-session-*.js:
  //   invoice.status   ∈ {payment_detected, payment_confirmed, refunded,
  //                       expired, complete}
  //   "paid" is NOT a valid value (it crashed the exhaustive UI match), and
  //   paymentReceived is ignored by the UI. "complete" fires invoice_complete.
  function brDeliverInvoiceJson(inv) {
    if (!inv || typeof inv !== "object") return false;
    let changed = false;
    const now = new Date().toISOString();

    // An invoice can carry the same product in several arrays (cart_items AND
    // orders). Iterate all of them — richest (orders) first — so the delivered
    // flag is set everywhere AND the persisted copy is the order-shaped one
    // (product-dedupe then skips the cart-shaped duplicates).
    const sources = []
      .concat(Array.isArray(inv.orders) ? inv.orders : [])
      .concat(Array.isArray(inv.order_items) ? inv.order_items : [])
      .concat(Array.isArray(inv.items) ? inv.items : [])
      .concat(Array.isArray(inv.cart_items) ? inv.cart_items : []);

    // drive the checkout state machine to the delivered screen
    if (inv.status !== "complete") { inv.status = "complete"; changed = true; }
    if (inv.delivery_status !== "delivered") { inv.delivery_status = "delivered"; changed = true; }
    if (inv.paymentReceived === false) { inv.paymentReceived = true; changed = true; }
    if (inv.paid === false) { inv.paid = true; changed = true; }
    if (inv.is_paid === false) { inv.is_paid = true; changed = true; }
    // fiat invoice total for display: eurPrice (decimal EUR), NOT inv.price
    // (crypto micro-units, e.g. 121237 = 0.121237 ETH).
    const fiatInvoice = (typeof inv.eurPrice === "number" && inv.eurPrice > 0) ? inv.eurPrice
                      : (typeof inv.usdPrice === "number" && inv.usdPrice > 0) ? inv.usdPrice : 0;
    // paidAmount is a CRYPTO-amount field (rendered with the payment currency,
    // e.g. "0.121695 ETH") — keep it in inv.price micro-units, never fiat.
    if (typeof inv.price === "number") { inv.paidAmount = inv.price; changed = true; }

    // Per-product line quantity = how many identical units are on this invoice
    // (counts each entry's own `quantity`, so a single order line with
    // quantity=4 and four separate order lines both total 4). Used to convert
    // the fiat TOTAL (eurPrice) into a per-unit display price.
    const lineUnits = {};
    for (const it of sources) {
      if (!it || typeof it !== "object") continue;
      const slug = brProductSlug(it);
      if (slug) lineUnits[slug] = (lineUnits[slug] || 0) + Math.max(1, Number(it.quantity) || 1);
    }

    for (const it of sources) {
      if (!it || typeof it !== "object") continue;
      brNormalizeOrder(it);
      // Capture the REAL payload value (face value / crypto micro-units) BEFORE
      // the fiat per-unit rewrite below. It is what gets compared against cart
      // items to decide "already purchased" (value "30" must stay 30, not
      // become the price 31.75), which is what clears the cart after payment.
      const origValue = it.value;
      if (it.delivered !== true) { it.delivered = true; changed = true; }
      // The paid invoice's orders carry the crypto price in `value` (121695 =
      // 0.121695 ETH), which the checkout renders verbatim as "€121,695.00
      // value" (no /1e6, no /100). Rewrite ONLY those to the per-unit fiat
      // price (invoice total / line quantity) so the delivered screen shows
      // "5 x €201.60 value" instead of "5 x €1,008.00 value". A `value` that
      // is already a sane fiat per-unit figure (e.g. 200 = €200.00) is left
      // untouched. `price` (drives "0.121695 ETH" / the Total) is untouched.
      if (fiatInvoice > 0) {
        const slug = brProductSlug(it);
        const lineQty = Math.max(1, lineUnits[slug] || 1);
        const perUnit = fiatInvoice / lineQty;
        const isCryptoUnits = brLooksLikeCryptoUnits(it.value, inv.price);
        if (isCryptoUnits || typeof it.value !== "number" || it.value <= 0) {
          if (it.value !== perUnit) { it.value = perUnit; changed = true; }
        }
      }
      // Persist ONE My Products entry per real unit: a 4-item purchase must
      // show 4 lots. Dedupe by exact id (per unit, ids are made unique below)
      // against previously persisted purchases. The old slug-based dedupe
      // collapsed identical units into a single lot.
      const perItemUnits = Math.max(1, Number(it.quantity) || 1);
      const slug = brProductSlug(it);
      const lineQty = Math.max(1, lineUnits[slug] || 1);
      const baseId = brItemId(it);
      for (let i = 0; i < perItemUnits; i++) {
        const unitId = perItemUnits > 1 && baseId ? String(baseId) + "-" + i : baseId;
        if (brHasPurchasedId(unitId)) continue;
        const unitCopy = JSON.parse(JSON.stringify(it));
        if (perItemUnits > 1 && baseId) {
          unitCopy.id = unitId;
          unitCopy.order_id = unitId;
          unitCopy.cart_item_id = unitId;
        }
        const copy = brFakeOrderFrom(brNormalizeOrder(unitCopy), inv, now, lineQty, i, origValue);
        brPurchasedOrders.unshift(copy);
        console.log("[LLB-BR] Persisted order:", JSON.stringify({
          id: copy.id, operator: brProductSlug(copy), value: copy.value, quantity: copy.quantity,
          createdTime: copy.createdTime,
        }));
        changed = true;
      }
    }
    if (changed) brSaveState();
    return changed;
  }

  function brContainsPaidAddress(obj) {
    if (!obj || typeof obj !== "object" || !brPaidAddresses.length) return false;
    try {
      const s = JSON.stringify(obj);
      for (const a of brPaidAddresses) {
        if (a && s.indexOf(a) !== -1) return true;
      }
    } catch (e) {}
    return false;
  }

  // ─── API rewrite ─────────────────────────────────────────
  function brRewriteApiPayload(url, method, json) {
    if (!json || typeof json !== "object") return false;
    const urlL = String(url || "").toLowerCase();
    const isGet = (method || "GET").toUpperCase() === "GET";
    let changed = false;

    // track the active cart for one-time server purge after a fake payment
    if (json.cart_id) brCartId = json.cart_id;

    // ── Mark-as-used interception ──
    // A "Mark as used" click sends a write to /orders/{id} (or a body holding
    // the order id). Only act when the id matches one of OUR fake orders, and
    // move it into brUsedOrderIds so it then shows up under Used products
    // (archived=true) and disappears from My Products (archived=false).
    if (!isGet && urlL.indexOf("/orders") !== -1) {
      const m = urlL.match(/\/orders\/([^/?#]+)/);
      let orderId = m ? decodeURIComponent(m[1]) : null;
      if (!orderId && json && (json.order_id || json.id)) orderId = String(json.order_id || json.id);
      if (orderId) {
        const s = String(orderId);
        if (brHasPurchasedId(s) && !brUsedOrderIds.has(s)) {
          brUsedOrderIds.add(s);
          brSaveState();
          changed = true;
          console.log("[LLB-BR] Marked order used:", s);
        }
      }
    }

    // ── any zero balance/credit -> fake (safe everywhere) ──
    if (brInjectZeroBalances(json)) changed = true;

    // ── INVOICE POST response: hide stale purchased items (server cart was not cleared) ──
    // The server cart can still hold previously-paid items (fake payments never
    // reach Bitrefill). Remove them from the freshly-created invoice display.
    if (!isGet && urlL.indexOf("/invoice") !== -1 && Array.isArray(json.cart_items)) {
      const before = json.cart_items.length;
      const kept = json.cart_items.filter(ci => !brIsPurchased(ci));
      if (kept.length && kept.length !== before) {
        json.cart_items = kept;
        changed = true;
        console.log("[LLB-BR] Filtered purchased items from invoice response");
      }
    }

    // ── CART responses ──
    if (urlL.indexOf("/cart") !== -1) {
      if (brDebug && isGet) console.log("[LLB-BR] CART GET: " + JSON.stringify(json).slice(0, 3000));
      // payment methods show per-currency available balances
      const pm = json.payment_methods;
      if (Array.isArray(pm)) {
        for (const m of pm) {
          if (!m || typeof m !== "object") continue;
          const cur = String(m.currency || m.payment_currency || fakeCurrency).toUpperCase();
          if (typeof m.balance === "number") { m.balance = brConvertBalance(cur); changed = true; }
          if (typeof m.amount === "number") { m.amount = brConvertBalance(cur); changed = true; }
        }
      }
      if (json.payment_methods_info && typeof json.payment_methods_info === "object") {
        for (const k of Object.keys(json.payment_methods_info)) {
          const v = json.payment_methods_info[k];
          if (v && typeof v === "object" && typeof v.balance === "number") {
            v.balance = brConvertBalance(String(k).toUpperCase());
            changed = true;
          }
        }
      }

      // hide already-purchased items from the cart (GET only, persists across reload)
      if (isGet && Array.isArray(json.cart_items)) {
        // stale server cart from prior fake-payment sessions still holds paid
        // items; purge the whole cart once per cart so the next checkout is clean
        if (json.cart_items.some(brIsPurchased)) brClearServerCart();
        const before = json.cart_items.length;
        json.cart_items = json.cart_items.filter(ci => !brIsPurchased(ci));
        if (json.cart_items.length !== before) {
          changed = true;
          console.log("[LLB-BR] Filtered purchased items from cart");
        }
      }
    }

    // ── INVOICE GET: confirm payment / show delivered state ──
    if (isGet && urlL.indexOf("/invoice") !== -1) {
      if (brContainsPaidAddress(json)) {
        if (brDeliverInvoiceJson(json)) {
          changed = true;
          console.log("[LLB-BR] Invoice confirmed paid: " + url);
          console.log("[LLB-BR] INVOICE FULL: " + JSON.stringify(json));
        }
      } else {
        console.log("[LLB-BR] Invoice poll (unpaid): " + url);
        console.log("[LLB-BR] INVOICE FULL: " + JSON.stringify(json));
      }
    }

    // ── ORDERS (My Products / Used products): prepend purchased ──
    // Both lists read /api/accounts/orders and filter client-side. My Products
    // requests archived=false, Used products requests archived=true. A fake
    // order that is never marked used must only be prepended to the active
    // (archived=false) response — otherwise every purchase also shows up in
    // Used products.
    if (urlL.indexOf("/orders") !== -1 && Array.isArray(json.items)) {
      const usedList = urlL.indexOf("archived=true") !== -1 || urlL.indexOf("used") !== -1;
      const known = new Set(json.items.map(brItemId).filter(Boolean).map(String));
      const mine = brPurchasedOrders.filter(o => {
        if (known.has(String(brItemId(o)))) return false;
        const isUsed = brUsedOrderIds.has(String(brItemId(o)));
        return isUsed === usedList;
      });
      if (mine.length) {
        json.items = [...mine.map(o => brNormalizeOrder(JSON.parse(JSON.stringify(o)))), ...json.items];
        json.count = json.items.length;
        changed = true;
      }
    }

    return changed;
  }

  // ─── Kill-switch ─────────────────────────────────────────
  // localStorage "llb-br-disable" = "1" -> pure passthrough, zero interference.
  let brDisabled = false;
  try { brDisabled = localStorage.getItem("llb-br-disable") === "1"; } catch (e) {}
  let brDebug = false;
  try { brDebug = localStorage.getItem("llb-br-debug") === "1"; } catch (e) {}

  // Only endpoints we actually rewrite need body parsing. Everything else
  // (omni, account, cart, wishlists, track, pusher_auth, search, images, ...)
  // passes straight through with zero overhead.
  function brShouldRewrite(url) {
    const u = String(url || "").toLowerCase();
    if (u.indexOf("/api/") === -1) return false;
    return u.indexOf("/cart") !== -1 ||
           u.indexOf("/invoice") !== -1 ||
           u.indexOf("/orders") !== -1 ||
           u.indexOf("/fx_rates") !== -1;
  }

  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [resource, config] = args;
    const url = typeof resource === "string" ? resource : (resource && resource.url) || "";
    if (!brIsBitrefillUrl(url)) return originalFetch.apply(this, args);
    if (brDisabled) return originalFetch.apply(this, args);
    if (!brShouldRewrite(url)) return originalFetch.apply(this, args);
    const method = (config && config.method) || "GET";
    if (brDebug) console.log("[LLB-BR] API " + method + " " + url);
    return originalFetch.apply(this, args).then(async resp => {
      try {
        if (!resp || !resp.ok) return resp;
        const clone = resp.clone();
        const text = await clone.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { return resp; }
        if (url.indexOf("/fx_rates") !== -1) brFxRates = json;
        if (brRewriteApiPayload(url, method, json)) {
          if (brDebug) console.log("[LLB-BR] Rewrote: " + method + " " + url);
          return new Response(JSON.stringify(json), { status: resp.status, statusText: resp.statusText, headers: brCopyHeaders(resp.headers) });
        }
      } catch (e) {}
      return resp;
    });
  };

  // ─── Clear the server cart once per new payment ─────────
  // Fake payments never reach Bitrefill, so the server cart keeps holding the
  // paid items forever and they get re-added to the next checkout. Delete it
  // right after delivery (once per cart_id) so the next cart starts clean.
  function brClearServerCart() {
    if (!brCartId || brCartClearedFor === brCartId) return;
    brCartClearedFor = brCartId;
    try {
      originalFetch("/api/accounts/cart/" + encodeURIComponent(brCartId), { method: "DELETE" })
        .then(r => {
          if (brDebug) console.log("[LLB-BR] Server cart cleared:", r.status);
        })
        .catch(() => {});
    } catch (e) {}
  }

  // ─── Payment polling ────────────────────────────────────
  // Orders are persisted ONLY by the invoice-GET path (brDeliverInvoiceJson),
  // which sees the real order shape (value, price, invoiceTime, operatorObject)
  // after a fake payment. The cart path was the duplicate/€0/Invalid Date
  // source (cart items are cart-shaped and use a different id), so it is gone.
  function brWatchPayments() {
    fetch(API_BASE + "/api/bitrefill/payments")
      .then(r => r.json())
      .then(data => {
        const payments = Array.isArray(data && data.payments) ? data.payments : [];
        for (const p of payments) {
          const addr0 = p && p.address;
          const ts = Number(p && p.timestamp) || 0;
          if (!addr0) continue;
          if ((brSeenPayments[addr0] || 0) >= ts) continue;
          brSeenPayments[addr0] = ts;
          if (brPaidAddresses.indexOf(addr0) === -1) {
            brPaidAddresses.push(addr0);
            brSaveState();
          }
          console.log("[LLB-BR] Payment detected:", addr0);
          brClearServerCart();
        }
      })
      .catch(() => {});
  }

  function init() {
    if (brPollTimer) clearInterval(brPollTimer);
    brPollTimer = setInterval(brWatchPayments, 2000);
    brWatchPayments();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  console.log("[LLB-BR] Bitrefill content script loaded");
})();
