// Background worker: the on/off shortcut, and the content scripts for
// other sites the user turned the skin on for (TradingView's are in the
// manifest).
importScripts("shared/skins.js");

var SITE_SCRIPTS = ["ez-site-hook", "ez-site-host"];

// Registers the page hook and host script for every saved site this
// extension still has permission for; drops them for the rest.
function syncSiteScripts() {
  return EZSkins.load().then(function (settings) {
    return Promise.all(settings.sites.map(function (o) {
      return chrome.permissions.contains({ origins: [o + "/*"] }).then(function (ok) { return ok ? o : null; }, function () { return null; });
    }));
  }).then(function (checked) {
    var origins = checked.filter(Boolean);
    return chrome.scripting.getRegisteredContentScripts({ ids: SITE_SCRIPTS }).then(function (existing) {
      if (!existing.length) return;
      return chrome.scripting.unregisterContentScripts({ ids: existing.map(function (x) { return x.id; }) });
    }).then(function () {
      if (!origins.length) return;
      var matches = origins.map(function (o) { return o + "/*"; });
      return chrome.scripting.registerContentScripts([
        { id: "ez-site-hook", matches: matches, js: ["content/page-hook.js"], runAt: "document_start", world: "MAIN", allFrames: true, matchOriginAsFallback: true },
        { id: "ez-site-host", matches: matches, js: ["shared/skins.js", "content/skin-host.js"], runAt: "document_idle", allFrames: true, matchOriginAsFallback: true }
      ]);
    });
  });
}

// Puts the skin on an already-open tab without a reload.
function injectInto(tabId, force) {
  var target = { tabId: tabId, allFrames: true };
  return chrome.scripting.executeScript({ target: target, files: ["content/page-hook.js"], world: "MAIN" })
    .then(function () {
      if (!force) return;
      return chrome.scripting.executeScript({ target: target, func: function () { window.__ezSkinForce = true; } });
    })
    .then(function () {
      return chrome.scripting.executeScript({ target: target, files: ["shared/skins.js", "content/skin-host.js"] });
    })
    .then(function () {
      // Already there from before: pick up the new state.
      return chrome.scripting.executeScript({ target: target, func: function () { if (window.__ezSkinRefresh) window.__ezSkinRefresh(); } });
    });
}

// ---------- EZPayouts Pro ----------
// The extension signs in through ezpayouts.xyz/pro: that page hands this
// worker the account's session (only ezpayouts.xyz can, see
// externally_connectable in the manifest). Pro is then checked with the
// account server now and then, and kept in storage for every part to read.
var AUTH_BASE = "https://ezpayouts-auth.ezpayouts.workers.dev";
var PRO_CHECK_MS = 6 * 60 * 60 * 1000;
var PRO_GRACE_S = 3 * 24 * 60 * 60;

function setPro(p) {
  var o = {};
  o[EZSkins.PRO_KEY] = p;
  return chrome.storage.local.set(o);
}
function refreshPro() {
  return chrome.storage.local.get([EZSkins.ACCOUNT_KEY, EZSkins.PRO_KEY]).then(function (r) {
    var acct = r[EZSkins.ACCOUNT_KEY], last = r[EZSkins.PRO_KEY] || {};
    if (!acct || !acct.token) return setPro({ pro: false, checkedAt: Date.now() });
    return fetch(AUTH_BASE + "/billing/status", { headers: { Authorization: "Bearer " + acct.token } }).then(function (res) {
      if (res.status === 401) {
        // Signed out on the site (or the session ran out).
        return chrome.storage.local.remove(EZSkins.ACCOUNT_KEY).then(function () { return setPro({ pro: false, checkedAt: Date.now() }); });
      }
      if (!res.ok) throw new Error("status " + res.status);
      return res.json().then(function (b) {
        return setPro({ pro: !!b.pro, plan: b.plan || null, periodEnd: b.periodEnd || null, checkedAt: Date.now() });
      });
    }).catch(function () {
      // Offline: keep what was known, until the paid period (and a few
      // days' grace) is over.
      var still = !!last.pro && (last.periodEnd || 0) + PRO_GRACE_S > Date.now() / 1000;
      if (still !== !!last.pro) return setPro(Object.assign({}, last, { pro: still }));
    });
  });
}
function refreshProIfStale() {
  return chrome.storage.local.get(EZSkins.PRO_KEY).then(function (r) {
    var p = r[EZSkins.PRO_KEY];
    if (!p || Date.now() - (p.checkedAt || 0) > PRO_CHECK_MS) return refreshPro();
  });
}

chrome.runtime.onMessageExternal.addListener(function (msg, sender, reply) {
  if (!sender.origin || !/^https:\/\/(www\.)?ezpayouts\.xyz$/.test(sender.origin) || !msg) return;
  if (msg.type === "ez-link" && msg.token && msg.username) {
    var o = {};
    o[EZSkins.ACCOUNT_KEY] = { token: String(msg.token), username: String(msg.username) };
    chrome.storage.local.set(o).then(refreshPro).then(function () {
      return chrome.storage.local.get(EZSkins.PRO_KEY);
    }).then(function (r) { reply({ ok: true, pro: !!(r[EZSkins.PRO_KEY] || {}).pro }); });
    return true;
  }
  if (msg.type === "ez-unlink") {
    chrome.storage.local.remove(EZSkins.ACCOUNT_KEY).then(refreshPro).then(function () { reply({ ok: true }); });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(function () {
  EZSkins.load().then(EZSkins.save).then(syncSiteScripts);
  refreshPro();
});
chrome.runtime.onStartup.addListener(function () {
  syncSiteScripts();
  refreshProIfStale();
});
chrome.permissions.onRemoved.addListener(syncSiteScripts);

// A site granted from the popup's "Turn on here". Handled here too, since
// Chrome's permission prompt can close the popup before it finishes:
// save the site, register its scripts and skin any tab already open on it.
chrome.permissions.onAdded.addListener(function (perms) {
  var origins = (perms.origins || [])
    .map(function (p) { return p.replace(/\/\*$/, ""); })
    .filter(function (o) { return /^https?:\/\/[^*]+$/.test(o) && !/(^|\.)tradingview(-widget)?\.com$/.test(new URL(o).hostname); });
  if (!origins.length) return;
  EZSkins.load().then(function (s) {
    origins.forEach(function (o) { if (s.sites.indexOf(o) === -1) s.sites.push(o); });
    return EZSkins.save(s);
  }).then(syncSiteScripts).then(function () {
    return chrome.tabs.query({ url: origins.map(function (o) { return o + "/*"; }) });
  }).then(function (tabs) {
    tabs.forEach(function (t) { injectInto(t.id, false).catch(function () {}); });
  });
});

chrome.commands.onCommand.addListener(function (command) {
  if (command !== "toggle-skin") return;
  EZSkins.load().then(function (s) {
    s.enabled = !s.enabled;
    return EZSkins.save(s);
  });
});

// From the popup: { type: "ez-skin-site", origin, tabId, on, persist }.
// persist = the site was saved (permission granted); otherwise it's on for
// this visit only (activeTab).
// From the popup or a chart page: check Pro (now, or if it's been a while).
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || (msg.type !== "ez-pro-refresh" && msg.type !== "ez-pro-check")) return;
  (msg.type === "ez-pro-refresh" ? refreshPro() : refreshProIfStale()).then(function () { reply({ ok: true }); }, function () { reply({ ok: false }); });
  return true;
});

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || msg.type !== "ez-skin-site") return;
  var done = syncSiteScripts().then(function () {
    if (msg.on) return injectInto(msg.tabId, !msg.persist);
    // Off here: drop a one-visit switch-on and let the page take it down.
    return chrome.scripting.executeScript({
      target: { tabId: msg.tabId, allFrames: true },
      func: function () { window.__ezSkinForce = false; if (window.__ezSkinRefresh) window.__ezSkinRefresh(); }
    }).catch(function () {});
  });
  done.then(function () { reply({ ok: true }); }, function (err) { reply({ ok: false, error: String(err && err.message || err) }); });
  return true;
});
