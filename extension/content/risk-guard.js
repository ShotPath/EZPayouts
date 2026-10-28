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
  var settings = Object.assign({}, DEFAULTS), state = { accounts: {} };
  var REASONS = { dailyLoss: "daily loss limit", weeklyLoss: "weekly loss limit", dailyProfit: "daily profit target", weeklyProfit: "weekly profit target" };
  var KEY_OF = {}; Object.keys(REASONS).forEach(function (k) { KEY_OF[REASONS[k]] = k; });

  function storage() { try { return chrome.storage && chrome.storage.local; } catch (e) { return null; } }
  var st = storage();
  if (!st) return;
  st.get([SETTINGS_KEY, STATE_KEY], function (r) {
    settings = Object.assign({}, DEFAULTS, r[SETTINGS_KEY] || {});
    state = Object.assign({ accounts: {} }, r[STATE_KEY] || {});
    start();
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch[SETTINGS_KEY]) settings = Object.assign({}, DEFAULTS, ch[SETTINGS_KEY].newValue || {});
    if (ch[STATE_KEY]) state = Object.assign({ accounts: {} }, ch[STATE_KEY].newValue || {});
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
  // What the trading panel says about the account, by label: the fields
  // along its top, and the Account Summary, Positions and Orders tables
  // (TradingView labels every cell with its column's title). A table only
  // exists while its tab is open, so the last one seen is kept.
  var seen = { summary: {}, positions: null, orders: null };
  function headerFields() {
    var out = {};
    document.querySelectorAll('[class*="accountSummaryField-"]').forEach(function (box) {
      var t = box.querySelector('[class*="title-"]'), v = box.querySelector('[class*="value-"]');
      var n = v && num(v.textContent);
      if (t && n != null) out[t.textContent.trim().toLowerCase()] = n;
    });
    return out;
  }
  function tableRows(table) {
    if (!table) return null;
    var rows = [];
    table.querySelectorAll("tbody tr").forEach(function (tr) {
      var row = {}, cells = tr.querySelectorAll("td[data-label]");
      if (!cells.length) return;          // "No open positions" and the like
      cells.forEach(function (td) { row[td.getAttribute("data-label").trim().toLowerCase()] = td.textContent.trim(); });
      rows.push(row);
    });
    return rows;
  }
  function readPanel() {
    var sumRows = tableRows(shownFirst('[data-name*="accountsummary-table"], [data-name*="accountSummary-table"]'));
    if (sumRows && sumRows.length) {
      var name = accountName().toLowerCase(), row = sumRows.filter(function (r) { return (r.title || "").toLowerCase() === name; })[0] || sumRows[0], nums = {};
      Object.keys(row).forEach(function (k) { var n = num(row[k]); if (n != null) nums[k] = n; });
      seen.summary = nums;
    }
    var pos = tableRows(positionsTable());
    if (pos) seen.positions = pos.map(function (r) {
      return { symbol: r.symbol || "", side: r.side || "", qty: num(r.qty) || 0, pl: num(r.profit != null ? r.profit : (r["p&l"] || r.pl || r["unrealized p&l"])) };
    });
    var ord = tableRows(ordersTable());
    if (ord) seen.orders = ord;
    return Object.assign({}, seen.summary, headerFields());
  }
  var PL = "(p\\s*[\\/&]?\\s*l|pnl|profit)";
  function pick(m, res) {
    var keys = Object.keys(m);
    for (var i = 0; i < res.length; i++) for (var j = 0; j < keys.length; j++) if (res[i].test(keys[j])) return { label: keys[j], value: m[keys[j]] };
    return null;
  }
  // Today's P/L from what the broker reports: a day P/L if there is one,
  // else realized plus open, else total P/L. Null if it reports none.
  function brokerFigures(m) {
    var open = pick(m, [new RegExp("^(open|unrealized|unrealised|floating)\\s*" + PL)]);
    var openPl = open ? open.value : (seen.positions ? seen.positions.reduce(function (s, p) { return s + (p.pl || 0); }, 0) : 0);
    var dayRe = [new RegExp("^(today'?s?|day|daily|session|intraday)\\s*(total\\s*|net\\s*)?" + PL), new RegExp("^" + PL + "\\s*\\(?(today|day|daily)")];
    var dayF = pick(m, dayRe), real = pick(m, [new RegExp("^(realized|realised|closed)\\s*" + PL)]), total = pick(m, [new RegExp("^(total|net)\\s*" + PL)]);
    var weekF = pick(m, [new RegExp("^week(ly)?\\s*(realized\\s*|realised\\s*)?" + PL), /^week.*realized/]);
    var balance = pick(m, [/^(account\s*)?balance$/, /^cash\s*balance$/, /^balance\b/, /^(account|cash|current|total)\s*(balance|value)/, /balance/]);
    var eq = pick(m, [/^equity$/, /^net\s*liq/, /^total\s*equity$/, /^account\s*value$/]);
    var equityNow = eq ? eq.value : (balance ? balance.value + openPl : null);
    var day = null, source = "count";
    if (dayF) { day = dayF.value; source = dayF.label; }
    else if (real) { day = real.value + openPl; source = real.label + (openPl ? " + open" : ""); }
    else if (total) { day = total.value; source = total.label; }
    return { equity: equityNow, balance: balance ? balance.value : null, open: openPl, day: day, source: source,
      week: weekF ? weekF.value + openPl : null };
  }
  // TradingView can keep a hidden copy of a table: the one on screen wins.
  function shownFirst(sel) {
    var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) if (visible(all[i])) return all[i];
    return all[0] || null;
  }
  function positionsTable() { return shownFirst('[data-name="Broker.positions-table"]'); }
  // The account TradingView's trading panel is on: the name in its header
  // (where you switch accounts), most specific first. Outside that header,
  // only what's on screen counts: TradingView keeps hidden copies.
  var ACCOUNT_SELECTORS = [
    '.js-account-manager-header [class*="accountName-"]',
    '.js-account-manager-header [class*="ccountButton-"]',
    '.js-account-manager-header [class*="ccountsButton-"]',
    '[class*="singleAccountButton-"], [class*="multipleAccountsButton-"], [class*="accountsButton-"], [class*="accountButton-"]',
    '[class*="accountName-"]',
    '[class*="dropdownButton-"]'
  ];
  var nameFrom = "";
  function accountName() {
    for (var i = 0; i < ACCOUNT_SELECTORS.length; i++) {
      var els = document.querySelectorAll(ACCOUNT_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        if (i > 2 && !visible(els[j])) continue;   // the header's own name counts even with the panel collapsed
        var t = els[j].textContent.replace(/\s+/g, " ").trim();
        if (t && t.length < 60) { nameFrom = String(i); return t; }
      }
    }
    nameFrom = "none";
    return "account";
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
  // Locks are per account: switching to another account lets you trade it.
  var curLock = null;
  function lockFor(name) {
    var a = state.accounts[name];
    return a && a.lockedUntil > Date.now() ? a : null;
  }
  function tick() {
    if (!settings.enabled) { overlay(false); return; }
    var name = accountName();
    curLock = lockFor(name);
    try { if (curLock) { overlay(true); enforce(); } else { overlay(false); trimOverMax(); } } catch (e) {}
    var fields = readPanel(), f = brokerFigures(fields);
    var eq = f.equity;
    var now = Date.now(), k = keys(now);
    if (eq == null) {
      // A trading panel whose balance it can't find: say what it does see,
      // for the popup.
      var labels = Object.keys(fields);
      if (labels.length && now - liveAt > 5000) { liveAt = now; lastLive = ""; st.set({ [LIVE_KEY]: { account: name, missing: true, labels: labels.slice(0, 14), at: now } }); }
      return;
    }
    var a = state.accounts[name] || {};
    var changed = false;
    if (a.dayKey !== k.day) { a.dayKey = k.day; a.dayStart = eq; a.fired = {}; changed = true; }
    // The broker's own day P/L: today started at equity minus it.
    if (f.day != null) {
      var start = Math.round((eq - f.day) * 100) / 100;
      if (a.dayStart !== start) { a.dayStart = start; changed = true; }
    }
    if (a.weekKey !== k.week) { a.weekKey = k.week; a.weekStart = a.dayStart; changed = true; }
    if (!a.fired) a.fired = {};
    // A limit's lock ends when that limit is raised (or turned off), unless
    // changes are prevented while locked. Still past the new limit: it
    // locks again right away, at the new limit.
    var limitKey = a.lockedUntil > now && KEY_OF[a.lockReason];
    if (limitKey && a.lockLimit === undefined) { a.lockLimit = settings[limitKey]; changed = true; }
    if (limitKey && !settings.preventChanges && a.lockLimit != null && !(settings[limitKey] > 0 && settings[limitKey] <= a.lockLimit)) {
      a.lockedUntil = 0; a.lockReason = ""; a.lockLimit = null; delete a.fired[limitKey];
      curLock = null; changed = true; overlay(false);
    }
    var day = f.day != null ? f.day : eq - a.dayStart;
    var week = f.week != null ? f.week : eq - a.weekStart;

    var hit = null;
    if (settings.dailyLoss > 0 && day <= -settings.dailyLoss && a.fired.dailyLoss !== a.dayKey) hit = "dailyLoss";
    else if (settings.weeklyLoss > 0 && week <= -settings.weeklyLoss && a.fired.weeklyLoss !== a.weekKey) hit = "weeklyLoss";
    else if (settings.dailyProfit > 0 && day >= settings.dailyProfit && a.fired.dailyProfit !== a.dayKey) hit = "dailyProfit";
    else if (settings.weeklyProfit > 0 && week >= settings.weeklyProfit && a.fired.weeklyProfit !== a.weekKey) hit = "weeklyProfit";
    if (hit) {
      a.fired[hit] = /^daily/.test(hit) ? a.dayKey : a.weekKey;
      var hours = Math.max(0.25, Number(settings.lockHours) || 4);
      a.lockedUntil = Math.max(a.lockedUntil || 0, now + hours * 3600e3);
      a.lockReason = REASONS[hit];
      a.lockLimit = settings[hit];
      curLock = a;
      changed = true;
      overlay(true); enforce();
    }
    state.accounts[name] = a;
    if (changed) saveState();

    var fills = seen.orders ? seen.orders.filter(function (o) { return /fill/i.test(o.status || ""); }).length : null;
    var live = { account: name, equity: eq, balance: f.balance, open: Math.round(f.open * 100) / 100,
      day: Math.round(day * 100) / 100, week: Math.round(week * 100) / 100, source: f.source,
      dayKey: a.dayKey, weekKey: a.weekKey, dayStart: a.dayStart, weekStart: a.weekStart,
      positions: (seen.positions || []).filter(function (p) { return p.qty; }), fills: fills, from: nameFrom, note: curLock ? enforceNote : "", at: now };
    var sig = JSON.stringify([live.note, live.account, live.equity, live.day, live.week, live.dayStart, live.weekStart, live.positions, live.fills, live.source]);
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
    var dlg = [].filter.call(document.querySelectorAll('[data-name*="dialog"], [role="dialog"]'), function (d) {
      return visible(d) && /clos|cancel|flatten|exit/i.test((d.getAttribute("data-name") || "") + " " + d.textContent);
    }).pop();
    if (!dlg) return false;
    var btn = dlg.querySelector('[data-name="submit-button"]') || [].filter.call(dlg.querySelectorAll("button"), function (b) {
      return visible(b) && /^(close( position)?|cancel order|flatten|exit|yes|confirm|ok)\b/i.test(b.textContent.trim());
    })[0];
    if (btn) { btn.click(); return true; }
    return false;
  }
  // The dialog can take a moment to show (or not show at all, with
  // confirmations off).
  async function confirmSoon() {
    for (var i = 0; i < 12; i++) { await sleep(150); if (confirmDialog()) return true; }
    return false;
  }
  // A row's close button, shown or not: TradingView can keep it hidden
  // until the row is hovered.
  function closeButtons(table) {
    return table && visible(table) ? [].slice.call(table.querySelectorAll('tbody tr [data-name="close-settings-cell-button"]')) : [];
  }
  function hover(el) {
    ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"].forEach(function (t) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: t.indexOf("enter") < 0, view: window }));
    });
  }
  var enforceNote = "";
  // Closes what's open and cancels what's working. It works in the tab
  // you have open; it only switches tabs when there's something to close
  // or cancel in the other one (or once, when a lock starts), and goes
  // back to the tab you were on.
  var swept = 0;
  function ordersTable() { return shownFirst('[data-name="Broker.orders-table"], [data-name*="orders-table"]'); }
  function working(o) { return !/fill|cancel|reject|expire|done/i.test(o.status || ""); }
  function currentTab() {
    return [].filter.call(document.querySelectorAll('[class*="roundTabButton-"], [role="tab"]'), function (b) {
      return visible(b) && (/(^|\s)selected-|(^|\s)active-/.test(b.className) || b.getAttribute("aria-selected") === "true");
    })[0] || null;
  }
  // The rows still to close or cancel: ones with a close button, and open
  // positions even without one.
  function rowsToClear(table, isPositions) {
    if (!table || !visible(table)) return [];
    return [].filter.call(table.querySelectorAll("tbody tr"), function (tr) {
      if (!tr.querySelector("td[data-label]")) return false;
      if (tr.querySelector('[data-name="close-settings-cell-button"]')) return true;
      if (!isPositions) return false;
      var q = tr.querySelector('td[data-label="Qty"], td[data-label="Quantity"], td[data-label="Qty."]');
      return !!(q && num(q.textContent));
    });
  }
  // The backup: the row's right-click menu, "Close Position" / "Cancel Order".
  async function closeByMenu(row, isPositions) {
    var cell = row.querySelector("td[data-label]") || row, r = cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, view: window,
      clientX: r.left + Math.min(30, r.width / 2), clientY: r.top + r.height / 2 }));
    await sleep(350);
    var want = isPositions ? /^close position$/i : /^cancel order$/i;
    var item = [].filter.call(document.querySelectorAll('[role="menuitem"], [class*="item-"]'), function (e) {
      return visible(e) && want.test(e.textContent.trim());
    })[0];
    if (!item) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
    item.click();
    await confirmSoon();
    return true;
  }
  function rowKey(tr) { return tr.textContent.replace(/\s+/g, " ").trim().slice(0, 120); }
  async function clearTable(get) {
    var isPositions = get === positionsTable, fails = {};
    for (var i = 0; i < 30; i++) {
      var row = rowsToClear(get(), isPositions)[0];
      if (!row) return true;
      var key = rowKey(row), n = fails[key] || 0;
      var b = row.querySelector('[data-name="close-settings-cell-button"]');
      // Its close button first; the right-click menu if that didn't do it.
      if (b && n < 2) {
        hover(row); await sleep(120);
        b.click();
        await confirmSoon();
      } else {
        await closeByMenu(row, isPositions);
      }
      await sleep(500);
      var again = rowsToClear(get(), isPositions)[0];
      if (again && rowKey(again) === key) {
        fails[key] = n + 1;
        if (fails[key] >= 4) {
          var names = [].map.call(row.querySelectorAll("[data-name]"), function (e) { return e.getAttribute("data-name"); }).join(", ");
          enforceNote = "Couldn't close your trade (it sees: " + (names || "no buttons") + ").";
          return false;
        }
      }
    }
    return true;
  }
  function enforce() {
    if (busy || Date.now() - lastEnforce < 2500) return;
    var pt = tab(/^positions/i), ot = tab(/^orders/i);
    if (!positionsTable() && !ordersTable() && !pt && !ot) {
      if (curLock) enforceNote = "Open TradingView's Positions panel so it can close your trade.";
      return;
    }
    if (!curLock) return;
    var firstLook = swept !== curLock.lockedUntil;
    var openThere = seen.positions && seen.positions.some(function (p) { return p.qty; });
    var workingThere = seen.orders && seen.orders.some(working);
    var visibleWork = rowsToClear(positionsTable(), true).length || (ordersTable() && seen.orders && seen.orders.some(working));
    // Keeps at it for as long as it sees something open or working.
    if (!firstLook && !visibleWork && !openThere && !workingThere) return;
    busy = true; lastEnforce = Date.now();
    (async function () {
      var back = currentTab();
      try {
        var ok = true;
        enforceNote = "";
        if (positionsTable()) ok = await clearTable(positionsTable);
        else if (pt && (firstLook || openThere)) { pt.click(); await sleep(400); readPanel(); ok = await clearTable(positionsTable); }
        readPanel();
        if (ordersTable()) ok = (await clearTable(ordersTable)) && ok;
        else if (ot && (firstLook || workingThere)) { ot.click(); await sleep(450); readPanel(); ok = (await clearTable(ordersTable)) && ok; readPanel(); }
        swept = curLock ? curLock.lockedUntil : 0;
        // Didn't work: tries again in a bit, and says why.
        if (!ok) { lastEnforce = Date.now() + 10000; toast(enforceNote); }
      } catch (e) {}
      if (back && back !== currentTab() && visible(back)) back.click();
      busy = false;
    })();
  }

  // ---------- Blocking orders (locked, or bigger than the max) ----------
  var ORDER_BUTTONS = '[data-name="place-and-modify-button"], [data-name="buy-order-button"], [data-name="sell-order-button"]';
  // The quantity box: the one labelled as such, else the first number box.
  var QTY_RE = /^(units?|quantity|qty|contracts?|lots?|shares?|size|amount)\b/i;
  function qtyInput(root) {
    if (!root) return null;
    var inputs = [].filter.call(root.querySelectorAll("input"), function (i) { return visible(i) && num(i.value) != null; });
    var named = inputs.filter(function (i) {
      if (QTY_RE.test(i.getAttribute("aria-label") || i.getAttribute("name") || i.getAttribute("placeholder") || "")) return true;
      // A label just before it: "Quantity", "Units", "Contracts".
      for (var a = i.parentElement, k = 0; a && k < 4; a = a.parentElement, k++) {
        var lab = a.previousElementSibling;
        if (lab && QTY_RE.test(lab.textContent.trim())) return true;
      }
      return false;
    })[0];
    return named || inputs[0] || null;
  }
  function qtyFor(el) {
    var chartBtn = el.closest('[data-name="buy-order-button"], [data-name="sell-order-button"]');
    if (chartBtn) {
      var q = document.querySelector('[data-name="qtyEl"]');
      return q ? num(q.textContent) : null;
    }
    // "Buy 12 MNQ1! @ 29,920.25 Limit" and the like.
    var item = el.closest('[role="menuitem"], [class*="item-"]');
    var m = item && item.textContent.trim().match(/^(buy|sell)\s+([\d,.]+)/i);
    if (m) return num(m[2]);
    var box = el.closest('[data-name*="dialog"]') || el.closest('[data-name="order-panel"]') || document.querySelector('[data-name="order-panel"]');
    var input = qtyInput(box);
    return input ? num(input.value) : null;
  }
  // Buy or sell, where it can tell.
  function sideFor(el) {
    var chartBtn = el.closest('[data-name="buy-order-button"], [data-name="sell-order-button"]');
    if (chartBtn) return /buy/.test(chartBtn.getAttribute("data-name")) ? "buy" : "sell";
    var item = el.closest('[role="menuitem"], [class*="item-"]');
    var m = item && item.textContent.trim().match(/^(buy|sell)\s+[\d,.]+/i);
    if (m) return m[1].toLowerCase();
    var box = el.closest('[data-name*="dialog"]') || el.closest('[data-name="order-panel"]') || document.querySelector('[data-name="order-panel"]');
    var on = box && box.querySelector('[data-name="side-control-buy"][class*="active-"], [data-name="side-control-sell"][class*="active-"]');
    return on ? (/buy/.test(on.getAttribute("data-name")) ? "buy" : "sell") : null;
  }
  // Contracts already held on that side.
  function heldOn(side) {
    var rows = tableRows(positionsTable()) || [];
    return rows.reduce(function (s, r) {
      var sd = /buy|long/i.test(r.side || "") ? "buy" : /sell|short/i.test(r.side || "") ? "sell" : null;
      return s + (sd === side ? Math.abs(num(r.qty) || 0) : 0);
    }, 0);
  }
  function isOrderAction(el, e) {
    if (el.closest(ORDER_BUTTONS)) return true;
    // Enter in the order panel's boxes places the order.
    if (e && e.type === "keydown" && e.key === "Enter" && el.closest('[data-name="order-panel"]') && el.tagName === "INPUT") return true;
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
    if (!el || !isOrderAction(el, e)) return;
    var lk = lockFor(accountName());
    var locked = !!lk;
    var msg = null;
    if (locked) msg = "This account is locked until " + until(lk) + " (" + (lk.lockReason || "risk limit") + ").";
    else if (settings.maxQty > 0) {
      var q = qtyFor(el);
      if (q != null && Math.abs(q) > settings.maxQty) msg = "That's " + Math.abs(q) + " contracts. Your max is " + settings.maxQty + ".";
      else if (q != null) {
        // Adding to a position: what you'd hold counts.
        var side = sideFor(el), held = side ? heldOn(side) : 0;
        if (held && held + Math.abs(q) > settings.maxQty)
          msg = "You'd hold " + (held + Math.abs(q)) + " contracts (" + held + " + " + Math.abs(q) + "). Your max is " + settings.maxQty + ".";
      }
    }
    if (!msg) return;
    // A Buy/Sell menu item only opens a new order to adjust (the order
    // panel's Place is what sends it, and that's checked): so not locked,
    // it just warns.
    if (!locked && !el.closest(ORDER_BUTTONS) && !el.closest('[data-name="submit-button"]') && !(e.type === "keydown")) {
      if (e.type === "click") toast(msg + " Lower it before you place it.");
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    if (e.type === "click" || e.type === "keydown") toast(msg);
  }
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { window.addEventListener(t, guard, true); });
  window.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") guard(e); }, true);

  // ---------- Over the max anyway (a hotkey, the DOM, another device) ----------
  // A position bigger than the max: the extra is closed (or the whole
  // position, if TradingView's close dialog has no quantity box). A working
  // order bigger than the max: cancelled.
  var trimming = false, lastTrim = 0;
  function setInput(input, value) {
    var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function overMax(table, qtyOf) {
    if (!table || !visible(table)) return null;
    var rows = [].filter.call(table.querySelectorAll("tbody tr"), function (tr) { return tr.querySelector("td[data-label]"); });
    for (var i = 0; i < rows.length; i++) {
      var cells = {};
      rows[i].querySelectorAll("td[data-label]").forEach(function (td) { cells[td.getAttribute("data-label").trim().toLowerCase()] = td.textContent.trim(); });
      var q = Math.abs(qtyOf(cells) || 0), btn = rows[i].querySelector('[data-name="close-settings-cell-button"]');
      if (q > settings.maxQty && btn) return { qty: q, btn: btn, row: rows[i] };
    }
    return null;
  }
  function trimOverMax() {
    if (!(settings.maxQty > 0) || trimming || curLock || Date.now() - lastTrim < 4000) return;
    var pos = overMax(positionsTable(), function (c) { return num(c.qty); });
    var ord = !pos && overMax(ordersTable(), function (c) {
      return working({ status: c.status }) ? num(c.qty != null ? c.qty : c.quantity) : 0;
    });
    var hit = pos || ord;
    if (!hit) return;
    trimming = true; lastTrim = Date.now();
    (async function () {
      try {
        hover(hit.row); await sleep(120);
        hit.btn.click(); await sleep(500);
        if (pos) {
          var dlg = [].filter.call(document.querySelectorAll('[data-name*="closing-dialog"], [data-name*="dialog"]'), function (d) {
            return visible(d) && /clos/i.test(d.getAttribute("data-name") + " " + d.textContent);
          })[0];
          var input = dlg && qtyInput(dlg);
          var extra = hit.qty - settings.maxQty;
          if (input) { setInput(input, extra); await sleep(250); }
          await confirmSoon();
          toast(input ? "Closed " + extra + " of " + hit.qty + " contracts. Your max is " + settings.maxQty + "."
                      : "Closed a " + hit.qty + "-contract position. Your max is " + settings.maxQty + ".");
        } else {
          await confirmSoon();
          toast("Cancelled a " + hit.qty + "-contract order. Your max is " + settings.maxQty + ".");
        }
      } catch (e) {}
      await sleep(800); trimming = false;
    })();
  }

  // ---------- What it shows ----------
  function until(lk) {
    lk = lk || curLock;
    return lk ? new Date(lk.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
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
    bar.textContent = "🔒 EZPayouts: " + accountName() + " locked until " + until() + " · " + ((curLock && curLock.lockReason) || "risk limit");
    while (shields.length < targets.length) {
      var s = document.createElement("div");
      s.setAttribute("style", "position:fixed;z-index:2147483645;background:rgba(10,12,18,0.72);backdrop-filter:blur(2px);border-radius:8px;" +
        "display:flex;align-items:center;justify-content:center;color:#ffb3b3;font:600 12px 'Segoe UI',system-ui,sans-serif;cursor:not-allowed");
      s.textContent = "Locked";
      s.addEventListener("click", function (e) { e.stopPropagation(); toast("This account is locked until " + until() + "."); }, true);
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

  // Something broke: say so in the popup instead of going quiet.
  var errAt = 0;
  function safeTick() {
    try { tick(); }
    catch (e) {
      if (Date.now() - errAt > 5000) {
        errAt = Date.now();
        try { st.set({ [LIVE_KEY]: { account: accountName(), error: String(e && e.message || e).slice(0, 140), at: Date.now() } }); } catch (e2) {}
      }
    }
  }
  function start() {
    safeTick();
    setInterval(safeTick, 1000);
  }
})();
