// The popup's two sides, and Risk Management: reads and changes a
// Tradovate account's risk settings through an open trader.tradovate.com
// tab (content/tv-bridge.js and tv-hook.js), using the sign-in already
// there. Daily/weekly loss limits and profit triggers are Tradovate's
// auto-liquidation settings (userAccountAutoLiq); max quantity is a
// position limit across everything (userAccountPositionLimit, Overall).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var VIEW_KEY = "ezView", EZ_MARK = "Set by EZPayouts";
  var TRADOVATE = "https://trader.tradovate.com/";
  var FIELDS = { rDailyLoss: "dailyLossAutoLiq", rWeeklyLoss: "weeklyLossAutoLiq", rDailyProfit: "dailyProfitAutoLiq", rWeeklyProfit: "weeklyProfitAutoLiq" };
  var tabId = null, env = null, accounts = [], current = { autoLiq: null, limit: null }, started = false;

  // ---------- The two sides ----------
  function showView(v) {
    [].forEach.call($("views").children, function (b) { b.setAttribute("aria-checked", b.getAttribute("data-view") === v ? "true" : "false"); });
    $("skinsView").hidden = v !== "skins";
    $("riskView").hidden = v !== "risk";
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    if (v === "risk" && !started) { started = true; connect(); }
  }
  $("views").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) showView(b.getAttribute("data-view")); });
  var saved = null; try { saved = localStorage.getItem(VIEW_KEY); } catch (e) {}
  showView(saved === "risk" ? "risk" : "skins");

  // ---------- Talking to the Tradovate tab ----------
  function ask(msg) {
    return new Promise(function (resolve, reject) {
      if (tabId == null) return reject(new Error("no-tab"));
      msg.type = "ez-risk";
      chrome.tabs.sendMessage(tabId, msg, function (res) {
        if (chrome.runtime.lastError || !res) return reject(new Error("no-bridge"));
        if (!res.ok) { var err = new Error(res.error || "failed"); err.status = res.status; return reject(err); }
        resolve(res.data);
      });
    });
  }
  function get(path) { return ask({ op: "api", method: "GET", path: path }); }
  function post(path, body) { return ask({ op: "api", method: "POST", path: path, body: body }); }

  function words(err) {
    var m = err && err.message;
    if (m === "no-bridge") return "Reload your Tradovate tab once, then open this again.";
    if (m === "not-signed-in") return "Sign in on your Tradovate tab, then click Reload.";
    if (m === "timeout") return "Tradovate didn't answer. Try again.";
    if (err && (err.status === 401 || err.status === 403) || /access is denied/i.test(m || "")) return "Tradovate didn't allow that. Your prop firm may control these settings.";
    if (/^http-/.test(m || "")) return "Tradovate couldn't do that right now. Try again in a moment.";
    return m || "Something went wrong.";
  }

  // ---------- Status ----------
  function status(text, kind, button) {
    $("riskText").innerHTML = text;
    $("riskDot").className = "site-dot" + (kind === "on" ? " on" : "");
    var b = $("riskBtn");
    b.hidden = !button;
    if (button) { b.textContent = button.label; b.className = "site-btn" + (button.quiet ? " quiet" : ""); b.onclick = button.run; }
  }
  function msg(text, kind) {
    var el = $("riskMsg");
    el.textContent = text || ""; el.className = "note" + (kind ? " " + kind : ""); el.hidden = !text;
  }

  function connect() {
    $("riskBody").hidden = true;
    status("Looking for Tradovate…");
    chrome.tabs.query({ url: TRADOVATE + "*" }, function (tabs) {
      if (!tabs || !tabs.length) {
        tabId = null;
        return status("Open <b>Tradovate</b> and sign in.", null, { label: "Open Tradovate", run: function () { chrome.tabs.create({ url: TRADOVATE }); } });
      }
      var tab = tabs.filter(function (t) { return t.active; })[0] || tabs[0];
      tabId = tab.id;
      ask({ op: "status" }).then(function (s) {
        if (!s.signedIn) {
          return status("Sign in on your <b>Tradovate</b> tab.", null, { label: "Check again", quiet: true, run: connect });
        }
        env = s.env;
        status("Connected to <b>Tradovate " + (env === "demo" ? "Demo" : "Live") + "</b>", "on", { label: "Reload", quiet: true, run: connect });
        return loadAccounts();
      }).catch(function (err) {
        status(words(err), null, { label: "Reload Tradovate", run: function () { chrome.tabs.reload(tabId); setTimeout(connect, 4000); } });
      });
    });
  }

  // ---------- Accounts and limits ----------
  function loadAccounts() {
    return get("account/list").then(function (list) {
      accounts = (list || []).filter(function (a) { return a.active !== false; });
      var sel = $("riskAcct");
      sel.innerHTML = "";
      accounts.forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.id; o.textContent = a.name || ("Account " + a.id);
        sel.appendChild(o);
      });
      $("riskBody").hidden = false;
      if (!accounts.length) { msg("No active accounts on this Tradovate login.", "bad"); return; }
      return loadLimits();
    }).catch(function (err) { $("riskBody").hidden = true; status(words(err), null, { label: "Try again", quiet: true, run: connect }); });
  }
  function acctId() { return Number($("riskAcct").value); }

  function loadLimits() {
    var id = acctId();
    disarm();
    msg("Loading this account's limits…");
    return Promise.all([get("userAccountAutoLiq/deps?masterid=" + id), get("userAccountPositionLimit/deps?masterid=" + id)]).then(function (res) {
      current.autoLiq = (res[0] || [])[0] || null;
      current.limit = (res[1] || []).filter(function (l) { return l.totalBy === "Overall" && l.active; })[0] || null;
      Object.keys(FIELDS).forEach(function (f) {
        var v = current.autoLiq && current.autoLiq[FIELDS[f]];
        $(f).value = v != null ? v : "";
      });
      var lim = current.limit;
      $("rMaxQty").value = lim ? (lim.exposedLimit != null ? lim.exposedLimit : (lim.longLimit != null ? lim.longLimit : "")) : "";
      var locked = !!(current.autoLiq && current.autoLiq.changesLocked);
      ["rDailyLoss", "rWeeklyLoss", "rDailyProfit", "rWeeklyProfit", "rMaxQty"].forEach(function (f) { $(f).disabled = locked; });
      $("riskSave").disabled = locked;
      msg(locked ? "These settings are locked on Tradovate's side right now." : "", locked ? "bad" : "");
    }).catch(function (err) { msg(words(err), "bad"); });
  }
  $("riskAcct").addEventListener("change", loadLimits);
  $("riskReload").addEventListener("click", loadLimits);

  // ---------- Save (two clicks: Save, then Confirm) ----------
  var armed = false;
  function disarm() { armed = false; $("riskSave").classList.remove("confirm"); $("riskSave").textContent = "Save to Tradovate"; }
  ["rDailyLoss", "rWeeklyLoss", "rDailyProfit", "rWeeklyProfit", "rMaxQty"].forEach(function (f) { $(f).addEventListener("input", disarm); });

  function readMoney(id) {
    var raw = $(id).value.trim();
    if (raw === "") return null;
    var n = Number(raw);
    if (!(n > 0)) throw new Error("Amounts need to be more than $0, or empty to turn a limit off.");
    return Math.round(n * 100) / 100;
  }
  function money(n) { return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

  $("riskSave").addEventListener("click", function () {
    var id = acctId(), vals = {}, qty;
    try {
      Object.keys(FIELDS).forEach(function (f) { vals[FIELDS[f]] = readMoney(f); });
      var raw = $("rMaxQty").value.trim();
      qty = raw === "" ? null : Number(raw);
      if (qty !== null && !(qty >= 1 && Math.floor(qty) === qty)) throw new Error("Max quantity needs to be a whole number, 1 or more.");
    } catch (err) { msg(err.message, "bad"); return; }

    if (!armed) {
      armed = true;
      var acct = accounts.filter(function (a) { return a.id === id; })[0];
      $("riskSave").classList.add("confirm");
      $("riskSave").textContent = "Confirm: save to " + (acct ? acct.name : "this account");
      msg("Daily loss " + (vals.dailyLossAutoLiq ? money(vals.dailyLossAutoLiq) : "off") +
        " · Weekly loss " + (vals.weeklyLossAutoLiq ? money(vals.weeklyLossAutoLiq) : "off") +
        " · Daily profit " + (vals.dailyProfitAutoLiq ? money(vals.dailyProfitAutoLiq) : "off") +
        " · Weekly profit " + (vals.weeklyProfitAutoLiq ? money(vals.weeklyProfitAutoLiq) : "off") +
        " · Max " + (qty ? qty + " contracts" : "no limit"));
      return;
    }
    disarm();
    var btn = $("riskSave");
    btn.disabled = true; msg("Saving…");
    var al = current.autoLiq;
    post(al ? "userAccountAutoLiq/update" : "userAccountAutoLiq/create", Object.assign({}, al || { id: id }, vals)).then(function () {
      var lim = current.limit;
      if (qty) {
        return post(lim ? "userAccountPositionLimit/update" : "userAccountPositionLimit/create",
          Object.assign({}, lim || { accountId: id, totalBy: "Overall", description: EZ_MARK }, { active: true, exposedLimit: qty, longLimit: qty, shortLimit: qty }));
      }
      // Cleared: only a limit made here is switched off; others stay.
      if (lim && lim.description === EZ_MARK) return post("userAccountPositionLimit/update", Object.assign({}, lim, { active: false }));
    }).then(function () {
      return loadLimits().then(function () {
        var kept = !qty && current.limit && current.limit.description !== EZ_MARK;
        msg("Saved to Tradovate." + (kept ? " The size limit already on this account was left as it is." : ""), "good");
      });
    }).catch(function (err) { msg(words(err), "bad"); }).then(function () { btn.disabled = false; });
  });
})();
