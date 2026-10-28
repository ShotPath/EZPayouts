// Risk Management, on TradingView (any frame with its trading panel).
// Reads the connected account's equity from the trading panel, keeps
// today's and this week's P&L from it (sessions start 6 PM New York, the
// futures day), and when a limit is hit (daily/weekly loss, daily/weekly
// profit) locks trading for a set time (4 hours unless changed): it
// closes the open positions and cancels working orders through
// TradingView's own buttons, keeps doing so while locked, and blocks the
// order buttons. It also blocks an order bigger than the max quantity.
// Settings come from the popup (chrome.storage "ezRisk"); the lock and
// the day's starting balances live in "ezRiskState"; what it sees is
// written to "ezRiskLive" for the popup.
(function () {
  "use strict";
  if (window.__ezRiskGuard) return;
  window.__ezRiskGuard = true;
  var SETTINGS_KEY = "ezRisk", STATE_KEY = "ezRiskState", LIVE_KEY = "ezRiskLive";
  var DEFAULTS = { enabled: false, dailyLoss: null, weeklyLoss: null, dailyProfit: null, weeklyProfit: null, maxQty: null, lockHours: 4, preventChanges: true };
  var settings = Object.assign({}, DEFAULTS), state = { accounts: {}, lockedUntil: 0, lockReason: "" };
  var REASONS = { dailyLoss: "daily loss limit", weeklyLoss: "weekly loss limit", dailyProfit: "daily profit target", weeklyProfit: "weekly profit target" };

  function storage() { try { return chrome.storage && chrome.storage.local; } catch (e) { return null; } }
  var st = storage();
  if (!st) return;
  st.get([SETTINGS_KEY, STATE_KEY], function (r) {
    settings = Object.assign({}, DEFAULTS, r[SETTINGS_KEY] || {});
    state = Object.assign({ accounts: {}, lockedUntil: 0, lockReason: "" }, r[STATE_KEY] || {});
    start();
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch[SETTINGS_KEY]) settings = Object.assign({}, DEFAULTS, ch[SETTINGS_KEY].newValue || {});
    if (ch[STATE_KEY]) state = Object.assign({ accounts: {}, lockedUntil: 0, lockReason: "" }, ch[STATE_KEY].newValue || {});
  });
  function saveState() { st.set({ [STATE_KEY]: state }); }

  // ---------- Reading the trading panel ----------
  function visible(el) { return !!(el && (el.offsetParent || el.getClientRects().length)); }
  function num(text) {
    if (text == null) return null;
    var t = String(text).replace(/[\s  $€£]/g, "").replace(/[−–]/g, "-").replace(/USD|EUR|GBP/gi, "");
    var neg = /^\(.*\)$/.test(t); if (neg) t = t.slice(1, -1);
    t = t.replace(/,/g, "");
    if (!/^[+\-]?\d+(\.\d+)?$/.test(t)) return null;
    var n = parseFloat(t);
    return neg ? -n : n;
  }
  // A summary field: its title, then its value (TradingView's
  // accountSummaryField: a title span and a value div).
  function field(labels) {
    var titles = document.querySelectorAll('[class*="accountSummaryField-"] [class*="title-"], [class*="accountSummaryField-"] span');
    for (var i = 0; i < titles.length; i++) {
      var t = titles[i].textContent.trim();
      if (!labels.some(function (re) { return re.test(t); })) continue;
      var box = titles[i].closest('[class*="accountSummaryField-"]');
      var v = box && box.querySelector('[class*="value-"]');
      var n = v && num(v.textContent);
      if (n != null) return n;
    }
    return null;
  }
  function positionsTable() { return document.querySelector('[data-name="Broker.positions-table"]'); }
  function openProfit() {
    var tbl = positionsTable(); if (!tbl) return 0;
    var sum = 0;
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      var c = tr.querySelector('[data-label="Profit"], [data-name="pl-column"]');
      var n = c && num(c.textContent); if (n != null) sum += n;
    });
    return sum;
  }
  function equity() {
    var e = field([/^equity$/i, /^net liq/i, /^net liquidat/i, /^total equity$/i, /^account value$/i]);
    if (e != null) return e;
    var b = field([/^account balance$/i, /^balance$/i, /^cash balance$/i]);
    return b != null ? b + openProfit() : null;
  }
  function accountName() {
    var b = document.querySelector('[class*="singleAccountButton-"], [class*="accountButton-"], [class*="dropdownButton-"]');
    var t = b && b.textContent.trim();
    return t && t.length < 60 ? t : "account";
  }

  // ---------- Days and weeks (futures sessions start 6 PM New York) ----------
  var ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  function keys(now) {
    var parts = {}; ET.formatToParts(new Date(now + 6 * 3600e3)).forEach(function (p) { parts[p.type] = p.value; });
    var day = parts.year + "-" + parts.month + "-" + parts.day;
    var dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
    var monday = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day - Math.max(0, dow)));
    return { day: day, week: monday.toISOString().slice(0, 10) };
  }

  // ---------- The loop ----------
  var lastLive = "";
  function tick() {
    if (!settings.enabled) { overlay(false); return; }
    var locked = state.lockedUntil > Date.now();
    if (locked) { overlay(true); enforce(); } else { overlay(false); }
    var eq = equity();
    if (eq == null) return;            // not the frame with the trading panel
    var name = accountName(), now = Date.now(), k = keys(now);
    var a = state.accounts[name] || {};
    var changed = false;
    if (a.dayKey !== k.day) { a.dayKey = k.day; a.dayStart = eq; a.fired = {}; changed = true; }
    if (a.weekKey !== k.week) { a.weekKey = k.week; a.weekStart = eq; changed = true; }
    if (!a.fired) a.fired = {};
    var day = eq - a.dayStart, week = eq - a.weekStart;

    var hit = null;
    if (settings.dailyLoss > 0 && day <= -settings.dailyLoss && a.fired.dailyLoss !== a.dayKey) hit = "dailyLoss";
    else if (settings.weeklyLoss > 0 && week <= -settings.weeklyLoss && a.fired.weeklyLoss !== a.weekKey) hit = "weeklyLoss";
    else if (settings.dailyProfit > 0 && day >= settings.dailyProfit && a.fired.dailyProfit !== a.dayKey) hit = "dailyProfit";
    else if (settings.weeklyProfit > 0 && week >= settings.weeklyProfit && a.fired.weeklyProfit !== a.weekKey) hit = "weeklyProfit";
    if (hit) {
      a.fired[hit] = /^daily/.test(hit) ? a.dayKey : a.weekKey;
      var hours = Math.max(0.25, Number(settings.lockHours) || 4);
      state.lockedUntil = Math.max(state.lockedUntil, now + hours * 3600e3);
      state.lockReason = REASONS[hit];
      changed = true;
      overlay(true); enforce();
    }
    state.accounts[name] = a;
    if (changed) saveState();

    var live = { account: name, equity: eq, day: Math.round(day * 100) / 100, week: Math.round(week * 100) / 100,
      dayKey: a.dayKey, weekKey: a.weekKey, dayStart: a.dayStart, weekStart: a.weekStart, at: now };
    var sig = JSON.stringify([live.account, live.equity, live.day, live.week, live.dayStart, live.weekStart]);
    if (sig !== lastLive || now - (liveAt || 0) > 15000) { lastLive = sig; liveAt = now; st.set({ [LIVE_KEY]: live }); }
  }
  var liveAt = 0;

  // ---------- Closing trades while locked ----------
  var busy = false, lastEnforce = 0;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tab(re) {
    return [].filter.call(document.querySelectorAll('[class*="roundTabButton-"], [role="tab"]'), function (b) { return visible(b) && re.test(b.textContent.trim()); })[0];
  }
  function confirmDialog() {
    // TradingView asks "Close position?" / "Cancel order?": press its main button.
    var dlg = [].filter.call(document.querySelectorAll('[data-name*="dialog"]'), function (d) {
      return visible(d) && /clos|cancel/i.test(d.getAttribute("data-name") + " " + d.textContent);
    })[0];
    var btn = dlg && dlg.querySelector('[data-name="submit-button"]');
    if (btn) { btn.click(); return true; }
    return false;
  }
  function closeButtons(table) {
    return table ? [].filter.call(table.querySelectorAll('[data-name="close-settings-cell-button"]'), visible) : [];
  }
  function enforce() {
    if (busy || Date.now() - lastEnforce < 2500) return;
    if (!positionsTable() && !tab(/^positions/i) && !tab(/^orders/i)) return;
    busy = true; lastEnforce = Date.now();
    (async function () {
      try {
        // Positions: close each one (and confirm).
        var pt = tab(/^positions/i);
        if (pt && !positionsTable()) { pt.click(); await sleep(400); }
        for (var i = 0; i < 20; i++) {
          var b = closeButtons(positionsTable())[0];
          if (!b) break;
          b.click(); await sleep(450);
          confirmDialog(); await sleep(700);
        }
        // Orders: cancel the working ones.
        var ot = tab(/^orders/i);
        if (ot) {
          ot.click(); await sleep(450);
          var table = document.querySelector('[data-name="Broker.orders-table"], [data-name*="orders-table"]');
          for (var j = 0; j < 30; j++) {
            var c = closeButtons(table)[0];
            if (!c) break;
            c.click(); await sleep(450);
            confirmDialog(); await sleep(600);
            table = document.querySelector('[data-name="Broker.orders-table"], [data-name*="orders-table"]');
          }
          if (pt) pt.click();
        }
      } catch (e) {}
      busy = false;
    })();
  }

  // ---------- Blocking orders (locked, or bigger than the max) ----------
  var ORDER_BUTTONS = '[data-name="place-and-modify-button"], [data-name="buy-order-button"], [data-name="sell-order-button"]';
  function qtyFor(el) {
    var chartBtn = el.closest('[data-name="buy-order-button"], [data-name="sell-order-button"]');
    if (chartBtn) {
      var q = document.querySelector('[data-name="qtyEl"]');
      return q ? num(q.textContent) : null;
    }
    var panel = el.closest('[data-name="order-panel"]') || document.querySelector('[data-name="order-panel"]');
    if (!panel) return null;
    var inputs = [].filter.call(panel.querySelectorAll("input"), function (i) { return visible(i) && num(i.value) != null; });
    return inputs.length ? num(inputs[0].value) : null;
  }
  function isOrderAction(el) {
    if (el.closest(ORDER_BUTTONS)) return true;
    var sub = el.closest('[data-name="submit-button"]');
    if (sub) {
      var dlg = sub.closest('[data-name*="dialog"]');
      return !(dlg && /clos|cancel/i.test(dlg.getAttribute("data-name") + " " + dlg.textContent.slice(0, 80)));
    }
    var item = el.closest('[role="menuitem"], [class*="item-"]');
    return !!(item && /^(buy|sell)\b/i.test(item.textContent.trim()) && /\d/.test(item.textContent));
  }
  function guard(e) {
    if (!settings.enabled || !e.isTrusted) return;
    var el = e.target && e.target.closest ? e.target : null;
    if (!el || !isOrderAction(el)) return;
    var locked = state.lockedUntil > Date.now();
    var msg = null;
    if (locked) msg = "Trading is locked until " + until() + " (" + (state.lockReason || "risk limit") + ").";
    else if (settings.maxQty > 0 && el.closest(ORDER_BUTTONS)) {
      var q = qtyFor(el);
      if (q != null && q > settings.maxQty) msg = "That's " + q + " contracts. Your max is " + settings.maxQty + ".";
    }
    if (!msg) return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    if (e.type === "click" || e.type === "keydown") toast(msg);
  }
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { window.addEventListener(t, guard, true); });
  window.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") guard(e); }, true);

  // ---------- What it shows ----------
  function until() {
    return new Date(state.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  var bar = null, shields = [];
  function overlay(on) {
    if (!on) {
      if (bar) { bar.remove(); bar = null; }
      shields.forEach(function (s) { s.remove(); }); shields = [];
      return;
    }
    if (!document.body) return;
    // Only where there's something to trade with.
    var targets = [].filter.call(document.querySelectorAll('[data-name="order-panel"], [data-name="buy-sell-buttons"]'), visible);
    if (!targets.length && !positionsTable()) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.setAttribute("style", "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483646;padding:9px 16px;border-radius:999px;" +
        "background:rgba(20,8,10,0.94);border:1px solid rgba(239,90,90,0.7);color:#ffd9d9;font:600 13px/1.3 'Segoe UI',system-ui,sans-serif;" +
        "box-shadow:0 10px 30px -10px rgba(0,0,0,0.8);pointer-events:none;white-space:nowrap");
      document.body.appendChild(bar);
    }
    bar.textContent = "🔒 EZPayouts: trading locked until " + until() + " · " + (state.lockReason || "risk limit");
    while (shields.length < targets.length) {
      var s = document.createElement("div");
      s.setAttribute("style", "position:fixed;z-index:2147483645;background:rgba(10,12,18,0.72);backdrop-filter:blur(2px);border-radius:8px;" +
        "display:flex;align-items:center;justify-content:center;color:#ffb3b3;font:600 12px 'Segoe UI',system-ui,sans-serif;cursor:not-allowed");
      s.textContent = "Locked";
      s.addEventListener("click", function (e) { e.stopPropagation(); toast("Trading is locked until " + until() + "."); }, true);
      document.body.appendChild(s); shields.push(s);
    }
    while (shields.length > targets.length) shields.pop().remove();
    targets.forEach(function (t, i) {
      var r = t.getBoundingClientRect();
      Object.assign(shields[i].style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    });
  }
  var toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("style", "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:12px;" +
        "background:#141820;border:1px solid rgba(245,184,61,0.7);color:#ffe3a6;font:600 13px/1.35 'Segoe UI',system-ui,sans-serif;" +
        "box-shadow:0 14px 34px -12px rgba(0,0,0,0.85);pointer-events:none;max-width:90vw;text-align:center");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = "EZPayouts: " + text;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) toastEl.style.display = "none"; }, 3500);
  }

  function start() {
    tick();
    setInterval(tick, 1000);
  }
})();
