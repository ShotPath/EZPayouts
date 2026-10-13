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
        { id: "ez-site-hook", matches: matches, js: ["content/page-hook.js"], runAt: "document_start", world: "MAIN", allFrames: true },
        { id: "ez-site-host", matches: matches, js: ["shared/skins.js", "content/skin-host.js"], runAt: "document_idle", allFrames: true }
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

chrome.runtime.onInstalled.addListener(function () {
  EZSkins.load().then(EZSkins.save).then(syncSiteScripts);
});
chrome.runtime.onStartup.addListener(syncSiteScripts);
chrome.permissions.onRemoved.addListener(syncSiteScripts);

// A site granted from the popup's "Turn on here". Handled here too, since
// Chrome's permission prompt can close the popup before it finishes:
// save the site, register its scripts and skin any tab already open on it.
chrome.permissions.onAdded.addListener(function (perms) {
  var origins = (perms.origins || [])
    .map(function (p) { return p.replace(/\/\*$/, ""); })
    .filter(function (o) { return /^https?:\/\/[^*]+$/.test(o) && !/(^|\.)tradingview\.com$/.test(new URL(o).hostname); });
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
