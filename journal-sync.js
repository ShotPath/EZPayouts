// Cross-device sync for the trading journal (localStorage
// "ezpayouts.journal.v1"), shared by the Journal, Dashboard and Calendar.
//
// The server stores the journal as one JSON blob. Uploading this device's
// whole copy on every save meant whichever device saved last won: a phone
// left open with an older copy would wipe trades logged on a computer.
// Instead, each sync:
//   1. Works out what changed on this device since its last successful
//      sync (a saved copy of what the server had then, the "base"):
//      changed or new items get a fresh `_u` timestamp, and anything that
//      disappeared gets a tombstone so the deletion travels too.
//   2. Downloads the server copy and merges item by item (accounts, trades,
//      strategies): newest `_u` wins, tombstones remove, and anything only
//      one side has is kept.
//   3. Saves the result here and uploads it if the server is missing
//      anything.
// Because a missing item without a tombstone is always kept, a stale copy
// can't erase other devices' trades, and devices converge as they sync.
(function () {
  "use strict";

  var LOCAL_KEY = "ezpayouts.journal.v1";
  var STATE_KEY = "ezpayouts.journal.sync.v1";
  var TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  var PUSH_DELAY_MS = 800;
  var POLL_MS = 60000;

  var updateListeners = [];
  var statusListeners = [];
  var inFlight = null;
  var rerun = false;
  var pushTimer = null;

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { return false; }
  }

  // Same shape whatever produced it: { accounts, activeAccountId, tombstones }.
  // The oldest saves were a flat { trades } with no accounts.
  function normalize(j) {
    var accounts = [];
    if (j && Array.isArray(j.accounts)) accounts = j.accounts;
    else if (j && Array.isArray(j.trades)) accounts = [{ id: "acc_default", name: "Main", trades: j.trades }];
    return {
      accounts: accounts,
      activeAccountId: (j && j.activeAccountId) || (accounts[0] && accounts[0].id) || null,
      tombstones: (j && j.tombstones && typeof j.tombstones === "object") ? j.tombstones : {}
    };
  }

  // Key-order-independent serialization that ignores the `_u` stamps, used
  // to tell whether an item's actual content changed.
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).filter(function (k) { return k !== "_u" && v[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    }
    return v === undefined ? "null" : JSON.stringify(v);
  }
  function accountMeta(acc) {
    var out = {};
    Object.keys(acc).forEach(function (k) { if (k !== "trades" && k !== "strategies") out[k] = acc[k]; });
    return out;
  }
  function byId(list) {
    var map = {};
    (list || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
    return map;
  }

  // ---------- 1. stamp this device's changes ----------
  function stampItem(item, baseItem, now, view) {
    if (!baseItem) { if (!item._u) item._u = now; return; }
    if (stable(view ? view(item) : item) !== stable(view ? view(baseItem) : baseItem)) item._u = now;
  }
  function stampList(list, baseList, tomb, now) {
    if (!Array.isArray(list)) list = [];
    var baseMap = byId(baseList);
    var seen = {};
    list.forEach(function (it) {
      if (!it || !it.id) return;
      seen[it.id] = true;
      stampItem(it, baseMap[it.id], now);
    });
    (baseList || []).forEach(function (b) {
      if (b && b.id && !seen[b.id]) tomb[b.id] = now;
    });
  }
  // With no base (first sync on this device) nothing is treated as deleted
  // and existing items keep whatever age they have.
  function stampChanges(local, base, tomb, now) {
    if (!base) return;
    var baseAccounts = byId(base.accounts);
    var seen = {};
    local.accounts.forEach(function (acc) {
      if (!acc || !acc.id) return;
      seen[acc.id] = true;
      var b = baseAccounts[acc.id];
      stampItem(acc, b, now, accountMeta);
      stampList(acc.trades, b ? b.trades : null, tomb, now);
      stampList(acc.strategies, b ? b.strategies : null, tomb, now);
    });
    Object.keys(baseAccounts).forEach(function (id) { if (!seen[id]) tomb[id] = now; });
  }

  // ---------- 2. merge ----------
  function alive(item, tomb) {
    var t = tomb[item.id];
    return !t || (item._u || 0) > t;
  }
  // Newest wins; on a tie the server's copy wins.
  function newer(local, remote) { return (local._u || 0) > (remote._u || 0) ? local : remote; }

  function mergeList(localList, remoteList, tomb, mergeBoth, cleanOne) {
    var out = [];
    var remoteMap = byId(remoteList);
    var used = {};
    (localList || []).forEach(function (l) {
      if (!l || !l.id) { if (l) out.push(l); return; }
      used[l.id] = true;
      var r = remoteMap[l.id];
      var m = r ? (mergeBoth ? mergeBoth(l, r) : newer(l, r)) : (cleanOne ? cleanOne(l) : l);
      if (alive(m, tomb)) out.push(m);
    });
    (remoteList || []).forEach(function (r) {
      if (!r || !r.id || used[r.id]) return;
      var m = cleanOne ? cleanOne(r) : r;
      if (alive(m, tomb)) out.push(m);
    });
    return out;
  }
  function mergeAccounts(localAccounts, remoteAccounts, tomb) {
    function withLists(meta, trades, strategies) {
      var out = {};
      Object.keys(meta).forEach(function (k) { out[k] = meta[k]; });
      out.trades = trades;
      if (strategies) out.strategies = strategies;
      return out;
    }
    function cleanOne(acc) {
      return withLists(acc,
        mergeList(acc.trades, [], tomb),
        acc.strategies ? mergeList(acc.strategies, [], tomb) : null);
    }
    function mergeBoth(l, r) {
      var hasStrategies = Array.isArray(l.strategies) || Array.isArray(r.strategies);
      return withLists(newer(l, r),
        mergeList(l.trades, r.trades, tomb),
        hasStrategies ? mergeList(l.strategies, r.strategies, tomb) : null);
    }
    return mergeList(localAccounts, remoteAccounts, tomb, mergeBoth, cleanOne);
  }

  function prune(tomb, now) {
    Object.keys(tomb).forEach(function (id) { if (now - tomb[id] > TOMBSTONE_TTL_MS) delete tomb[id]; });
  }

  // ---------- 3. the sync cycle ----------
  function emit(list, payload) {
    list.slice().forEach(function (fn) { try { fn(payload); } catch (err) {} });
  }
  function setStatus(ok, reason) { emit(statusListeners, { ok: ok, reason: reason || null }); }

  function signedIn() { return !!(window.EZAuth && EZAuth.isLoggedIn()); }

  function runSync() {
    return EZAuth.fetchData().then(function (remote) {
      if (!remote) throw { reason: "offline" };
      var user = EZAuth.getUsername();
      var state = readJSON(STATE_KEY) || {};
      if (state.user !== user) state = { user: user, base: null, tombstones: {} };

      // From here to the local write is synchronous, so nothing the page does
      // can slip in between reading this device's copy and replacing it.
      var local = normalize(readJSON(LOCAL_KEY));
      var tomb = {};
      Object.keys(state.tombstones || {}).forEach(function (id) { tomb[id] = state.tombstones[id]; });
      var now = Date.now();
      stampChanges(local, state.base, tomb, now);

      var rem = normalize(remote.journal);
      Object.keys(rem.tombstones).forEach(function (id) {
        if (!tomb[id] || rem.tombstones[id] > tomb[id]) tomb[id] = rem.tombstones[id];
      });
      prune(tomb, now);

      var accounts = mergeAccounts(local.accounts, rem.accounts, tomb);
      var activeId = accounts.some(function (a) { return a.id === local.activeAccountId; })
        ? local.activeAccountId
        : (accounts[0] ? accounts[0].id : null);
      var contentChanged = stable(accounts) !== stable(local.accounts);

      writeJSON(LOCAL_KEY, { accounts: accounts, activeAccountId: activeId });
      state.tombstones = tomb;
      writeJSON(STATE_KEY, state);
      if (contentChanged) emit(updateListeners, { source: "remote" });

      var merged = { accounts: accounts, activeAccountId: activeId, tombstones: tomb };
      var serverHasIt = JSON.stringify({ accounts: rem.accounts, tombstones: rem.tombstones }) ===
        JSON.stringify({ accounts: accounts, tombstones: tomb });
      var push = serverHasIt ? Promise.resolve() : EZAuth.saveDataStrict({ journal: merged }).catch(function (err) {
        var msg = String((err && err.message) || "");
        throw { reason: /too large/i.test(msg) ? "too-large" : "upload-failed", message: msg };
      });
      return push.then(function () {
        var s = readJSON(STATE_KEY) || state;
        s.user = user;
        s.base = { accounts: accounts };
        s.lastSyncAt = Date.now();
        writeJSON(STATE_KEY, s);
        setStatus(true);
        return { changed: contentChanged };
      });
    });
  }

  function syncNow() {
    if (!signedIn()) return Promise.resolve({ changed: false, skipped: true });
    if (inFlight) { rerun = true; return inFlight; }
    inFlight = runSync().catch(function (err) {
      setStatus(false, (err && err.reason) || "error");
      return { changed: false, error: (err && err.reason) || "error" };
    }).then(function (result) {
      inFlight = null;
      if (rerun) { rerun = false; syncNow(); }
      return result;
    });
    return inFlight;
  }

  // Call after every local save: batches rapid edits into one upload.
  function schedule() {
    if (!signedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
  }

  function reset() {
    clearTimeout(pushTimer);
    try { localStorage.removeItem(STATE_KEY); } catch (err) {}
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") syncNow();
  });
  window.addEventListener("online", function () { syncNow(); });
  setInterval(function () {
    if (document.visibilityState === "visible") syncNow();
  }, POLL_MS);
  if (window.EZAuth) {
    EZAuth.onChange(function (loggedIn) {
      if (loggedIn) syncNow();
      else reset();
    });
  }

  window.EZJournalSync = {
    sync: syncNow,
    schedule: schedule,
    reset: reset,
    onUpdate: function (fn) { updateListeners.push(fn); },
    onStatus: function (fn) { statusListeners.push(fn); }
  };
})();
