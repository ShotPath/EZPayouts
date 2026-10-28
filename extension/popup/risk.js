// The popup's two sides, and Risk Management's settings. The rules are
// enforced on TradingView by content/risk-guard.js; this only edits them
// ("ezRisk"), shows what the guard sees ("ezRiskLive") and the lock
// ("ezRiskState"), and can lock trading by hand.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var VIEW_KEY = "ezView", SETTINGS_KEY = "ezRisk", STATE_KEY = "ezRiskState", LIVE_KEY = "ezRiskLive";
  var DEFAULTS = { enabled: false, dailyLoss: null, weeklyLoss: null, dailyProfit: null, weeklyProfit: null, maxQty: null, lockHours: 4, preventChanges: true };
  var FIELDS = { rDailyLoss: "dailyLoss", rWeeklyLoss: "weeklyLoss", rDailyProfit: "dailyProfit", rWeeklyProfit: "weeklyProfit", rMaxQty: "maxQty", rLockHours: "lockHours" };
  var settings = Object.assign({}, DEFAULTS), state = { accounts: {} }, live = null;
  var store = chrome.storage.local;

  // ---------- The two sides ----------
  function showView(v) {
    [].forEach.call($("views").children, function (b) { b.setAttribute("aria-checked", b.getAttribute("data-view") === v ? "true" : "false"); });
    $("skinsView").hidden = v !== "skins";
    $("riskView").hidden = v !== "risk";
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
  }
  $("views").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) showView(b.getAttribute("data-view")); });
  var saved = null; try { saved = localStorage.getItem(VIEW_KEY); } catch (e) {}
  showView(saved === "risk" ? "risk" : "skins");

  function money(n) { var s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? "−$" : "+$") + s; }
  function signed(n) { return '<b class="' + (n < 0 ? "neg" : "pos") + '">' + money(n) + "</b>"; }
  // Locks are per account: the one TradingView is showing.
  function acct() { return live && live.account && Date.now() - live.at < 30000 ? live.account : null; }
  function lockOf() { var a = acct() && state.accounts[acct()]; return a && a.lockedUntil > Date.now() ? a : null; }
  function locked() { return !!lockOf(); }
  function until() { var a = lockOf(); return a ? new Date(a.lockedUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""; }
  var msgTimer = 0;
  function msg(text, kind, stay) {
    var el = $("riskMsg"); el.textContent = text || ""; el.className = "note" + (kind ? " " + kind : ""); el.hidden = !text;
    clearTimeout(msgTimer);
    if (text && !stay) msgTimer = setTimeout(function () { el.hidden = true; }, kind === "bad" ? 6000 : 4500);
  }

  // ---------- Showing it ----------
  function render() {
    $("riskOn").checked = !!settings.enabled;
    var fresh = live && Date.now() - live.at < 30000;
    if (!settings.enabled) { $("riskText").innerHTML = "Risk Management is <b>off</b>."; $("riskDot").className = "site-dot"; }
    else if (fresh && live.missing) { $("riskText").innerHTML = "Can't find your <b>balance</b> on TradingView."; $("riskDot").className = "site-dot"; }
    else if (fresh) { $("riskText").innerHTML = "Today " + signed(live.day) + " · Week " + signed(live.week); $("riskDot").className = "site-dot on"; }
    else { $("riskText").innerHTML = "Open TradingView's <b>trading panel</b>."; $("riskDot").className = "site-dot"; }
    stats(settings.enabled && fresh);

    var isLocked = locked();
    $("riskLock").hidden = !isLocked;
    if (isLocked) $("riskLock").innerHTML = "&#128274; <b>" + esc(acct()) + "</b> is locked until <b>" + until() + "</b> (" + (lockOf().lockReason || "risk limit") + ").";
    var frozen = isLocked && settings.preventChanges;
    Object.keys(FIELDS).forEach(function (f) { $(f).disabled = frozen; });
    $("rPrevent").disabled = frozen; $("riskSave").disabled = frozen; $("riskOn").disabled = frozen; $("riskRestart").disabled = frozen;
    $("riskLockNow").disabled = isLocked;
    $("riskLockNowBox").hidden = isLocked;

  }
  // Where today's count starts, the balance now, and the room left before
  // the daily loss limit (or the weekly one, if that's all that's set).
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function plain(n) { return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function room() {
    if (!live) return null;
    if (settings.dailyLoss > 0) return { label: "Room (DLL)", left: settings.dailyLoss + live.day };
    if (settings.weeklyLoss > 0) return { label: "Room (weekly)", left: settings.weeklyLoss + live.week };
    return null;
  }
  function stats(show) {
    // The open position (Positions) and today's fills (Orders).
    var pos = $("riskPos");
    pos.hidden = !show;
    if (show && live.missing) {
      pos.innerHTML = "It sees: " + esc((live.labels || []).join(", ") || "nothing yet");
      $("riskStats").hidden = true;
      return;
    }
    if (show) {
      var open = (live.positions || []).map(function (p) {
        return "<b>" + (/sell|short/i.test(p.side) ? "Short" : "Long") + " " + Math.abs(p.qty) + " " + esc(p.symbol) + "</b>" + (p.pl != null ? " " + money(p.pl) : "");
      });
      pos.innerHTML = (open.length ? open.join(", ") : "No open position") +
        (live.fills != null ? " · " + live.fills + " order" + (live.fills === 1 ? "" : "s") + " filled" : "");
    }
    // Counted from the broker's own P/L: no need to restart the count.
    $("riskRestart").hidden = !!(show && live.source && live.source !== "count");
    $("riskStats").title = show && live.source && live.source !== "count" ? "Today's P/L from your broker's " + live.source : "Counted from your balance when EZPayouts first saw it today";
    $("riskStats").hidden = !show || live.dayStart == null;
    if ($("riskStats").hidden) return;
    $("sStart").textContent = plain(live.dayStart);
    $("sNow").textContent = plain(live.equity);
    var r = room();
    $("sRoomLabel").textContent = r ? r.label : "Room (DLL)";
    $("sRoom").textContent = r ? plain(Math.max(0, r.left)) : "No limit";
    $("sRoom").className = r && r.left <= (settings.dailyLoss || settings.weeklyLoss) * 0.25 ? "neg" : "";
  }
  function fill() {
    Object.keys(FIELDS).forEach(function (f) { var v = settings[FIELDS[f]]; $(f).value = v != null ? v : ""; });
    $("rPrevent").checked = !!settings.preventChanges;
  }

  store.get([SETTINGS_KEY, STATE_KEY, LIVE_KEY], function (r) {
    settings = Object.assign({}, DEFAULTS, r[SETTINGS_KEY] || {});
    state = Object.assign({ accounts: {} }, r[STATE_KEY] || {});
    live = r[LIVE_KEY] || null;
    fill(); render();
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch[STATE_KEY]) state = Object.assign({ accounts: {} }, ch[STATE_KEY].newValue || {});
    if (ch[LIVE_KEY]) live = ch[LIVE_KEY].newValue || null;
    if (ch[SETTINGS_KEY]) settings = Object.assign({}, DEFAULTS, ch[SETTINGS_KEY].newValue || {});
    render();
  });
  setInterval(render, 5000);

  // ---------- Changing it ----------
  $("riskOn").addEventListener("change", function () {
    if (locked() && settings.preventChanges) { this.checked = true; return; }
    settings.enabled = this.checked;
    store.set({ [SETTINGS_KEY]: settings });
    render();
  });

  function readNum(id, whole) {
    var raw = $(id).value.trim();
    if (raw === "") return null;
    var n = Number(raw);
    if (!(n > 0) || (whole && Math.floor(n) !== n)) throw new Error(whole ? "Max quantity needs to be a whole number, 1 or more." : "Amounts need to be more than 0, or empty to turn a limit off.");
    return Math.round(n * 100) / 100;
  }
  $("riskSave").addEventListener("click", function () {
    if (locked() && settings.preventChanges) return;
    var next = Object.assign({}, settings);
    try {
      next.dailyLoss = readNum("rDailyLoss"); next.weeklyLoss = readNum("rWeeklyLoss");
      next.dailyProfit = readNum("rDailyProfit"); next.weeklyProfit = readNum("rWeeklyProfit");
      next.maxQty = readNum("rMaxQty", true);
      var h = readNum("rLockHours"); next.lockHours = h == null ? 4 : Math.min(72, Math.max(0.25, h));
    } catch (err) { msg(err.message, "bad"); return; }
    next.preventChanges = $("rPrevent").checked;
    if (!next.enabled) next.enabled = true;
    var unlocked = unlockIfRaised(next);
    settings = next;
    var put = { [SETTINGS_KEY]: settings };
    if (unlocked) put[STATE_KEY] = state;
    store.set(put, function () {
      fill(); render();
      if (unlocked) { msg("Limit raised past where you are, so trading is unlocked.", "good"); return; }
      msg("Saved. Hit a limit and EZPayouts closes your trades and locks trading for " + settings.lockHours + " hour" + (settings.lockHours === 1 ? "" : "s") + ".", "good");
    });
  });

  // A lock set off by a limit ends when that limit is raised (or turned
  // off) past where you are now, unless changes are prevented. A lock you
  // set yourself doesn't.
  var LIMIT_OF = { "daily loss limit": "dailyLoss", "weekly loss limit": "weeklyLoss", "daily profit target": "dailyProfit", "weekly profit target": "weeklyProfit" };
  function unlockIfRaised(next) {
    if (!locked() || settings.preventChanges) return false;
    var lk = lockOf();
    var key = lk && LIMIT_OF[lk.lockReason];
    if (!key || !live || live.missing) return false;
    var v = next[key], day = live.day, week = live.week;
    var clear = key === "dailyLoss" ? !(v > 0 && day <= -v)
      : key === "weeklyLoss" ? !(v > 0 && week <= -v)
      : key === "dailyProfit" ? !(v > 0 && day >= v)
      : !(v > 0 && week >= v);
    var raised = v == null || settings[key] == null || v > settings[key];
    if (!clear || !raised) return false;
    lk.lockedUntil = 0; lk.lockReason = "";
    if (lk.fired) delete lk.fired[key];      // so the new limit can still lock you later today
    return true;
  }

  // Count today and this week from the balance right now.
  $("riskRestart").addEventListener("click", function () {
    if (locked() && settings.preventChanges) return;
    var fresh = live && Date.now() - live.at < 30000;
    if (!fresh) {
      // Start over, but keep any locks.
      Object.keys(state.accounts).forEach(function (n) { var a = state.accounts[n]; delete a.dayKey; delete a.weekKey; });
      store.set({ [STATE_KEY]: state }, function () { msg("Done. Open TradingView's trading panel to see your numbers.", "good"); });
      return;
    }
    // Start today and this week from the balance right now.
    var a = state.accounts[live.account] || {};
    a.dayKey = live.dayKey; a.weekKey = live.weekKey; a.dayStart = live.equity; a.weekStart = live.equity; a.fired = {};
    state.accounts[live.account] = a;
    live = Object.assign({}, live, { day: 0, week: 0, dayStart: live.equity, weekStart: live.equity });
    store.set({ [STATE_KEY]: state, [LIVE_KEY]: live }, function () {
      render();
      var r = room();
      msg("Counting from " + plain(live.equity) + "." + (r ? " You have " + plain(r.left) + " of room before your " + (r.label === "Room (DLL)" ? "daily" : "weekly") + " loss limit." : ""), "good");
      var box = $("riskStats"); box.classList.add("flash"); setTimeout(function () { box.classList.remove("flash"); }, 1200);
    });
  });

  // ---------- Lock now (two clicks) ----------
  var armed = false;
  $("riskLockNow").addEventListener("click", function () {
    var hours = Number($("rLockNowHours").value);
    if (!(hours >= 0.25 && hours <= 72)) { msg("Pick between 0.25 and 72 hours.", "bad"); return; }
    var btn = this;
    if (!armed) {
      armed = true; btn.classList.add("confirm"); btn.textContent = "Confirm lock";
      msg("Locks trading for " + hours + " hour" + (hours === 1 ? "" : "s") + ", closes your open trades and cancels orders." + (settings.preventChanges ? " Settings can't be changed until it ends." : ""), "", true);
      setTimeout(function () { if (armed) { armed = false; btn.classList.remove("confirm"); btn.textContent = "Lock trading"; } }, 6000);
      return;
    }
    armed = false; btn.classList.remove("confirm"); btn.textContent = "Lock trading";
    var name = acct();
    if (!name || live.missing) { msg("Open TradingView's trading panel first, so EZPayouts knows which account to lock.", "bad"); return; }
    if (!settings.enabled) { settings.enabled = true; store.set({ [SETTINGS_KEY]: settings }); }
    var a = state.accounts[name] || (state.accounts[name] = {});
    a.lockedUntil = Math.max(a.lockedUntil || 0, Date.now() + hours * 3600e3);
    a.lockReason = "locked by you";
    store.set({ [STATE_KEY]: state }, function () { msg(name + " is locked. Its open trades are being closed on TradingView.", "good"); render(); });
  });
})();
