// Cross-device sync for the trading journal (localStorage
// "ezpayouts.journal.v1", shared by the Journal, Dashboard and Calendar)
// and the Backtest log ("ezpayouts.backtest.v2").
//
// The server stores each as one JSON blob. Uploading this device's whole
// copy on every save meant whichever device saved last won: a phone left
// open with an older copy would wipe trades logged on a computer.
// Instead, each sync, for each of the two:
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
//
// The Backtest log is merged in the journal's shape: each strategy is an
// "account" and its logged trades are that account's trades. Both are
// synced in one round trip: one download, and one upload carrying
// whichever the server is missing something from.
//
// Signing out sets this device's copies aside under the account's name
// (see account.js); signing back in to that account merges them back here,
// so trades that hadn't reached the server yet aren't lost.
(function () {
  "use strict";

  var TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  var PUSH_DELAY_MS = 800;
  var POLL_MS = 60000;
  var SIGNED_OUT_PREFIX = "ezpayouts.signedOut.";

  function copyFields(src, skip) {
    var out = {};
    Object.keys(src).forEach(function (k) { if (!skip || skip.indexOf(k) === -1) out[k] = src[k]; });
    return out;
  }

  var CHANNELS = [
    {
      name: "journal",
      localKey: "ezpayouts.journal.v1",
      stateKey: "ezpayouts.journal.sync.v1",
      // { accounts, activeAccountId }; the oldest saves were a flat
      // { trades } with no accounts.
      toModel: function (j) {
        var accounts = [];
        if (j && Array.isArray(j.accounts)) accounts = j.accounts;
        else if (j && Array.isArray(j.trades)) accounts = [{ id: "acc_default", name: "Main", trades: j.trades }];
        return { accounts: accounts, activeAccountId: (j && j.activeAccountId) || null };
      },
      fromModel: function (m) {
        return { accounts: m.accounts, activeAccountId: m.activeAccountId };
      }
    },
    {
      name: "backtest",
      localKey: "ezpayouts.backtest.v2",
      legacyKey: "ezpayouts.backtest.v1",
      stateKey: "ezpayouts.backtest.sync.v1",
      // { strategies: [{ id, name }], activeId, entriesByStrategy: { id: [] } };
      // the oldest saves were a plain array of trades.
      toModel: function (b) {
        if (Array.isArray(b)) b = { strategies: [{ id: "s1", name: "Strategy 1" }], activeId: "s1", entriesByStrategy: { s1: b } };
        var byId = (b && b.entriesByStrategy && typeof b.entriesByStrategy === "object") ? b.entriesByStrategy : {};
        var accounts = [], seen = {};
        ((b && Array.isArray(b.strategies)) ? b.strategies : []).forEach(function (s) {
          if (!s || !s.id || seen[s.id]) return;
          seen[s.id] = true;
          var acc = copyFields(s);
          acc.trades = Array.isArray(byId[s.id]) ? byId[s.id] : [];
          accounts.push(acc);
        });
        // Trades filed under a strategy missing from the list: keep them.
        Object.keys(byId).forEach(function (id) {
          if (!seen[id] && Array.isArray(byId[id]) && byId[id].length) {
            accounts.push({ id: id, name: "Strategy", trades: byId[id] });
          }
        });
        return { accounts: accounts, activeAccountId: (b && b.activeId) || null };
      },
      fromModel: function (m) {
        var strategies = [], entriesByStrategy = {};
        m.accounts.forEach(function (a) {
          strategies.push(copyFields(a, ["trades", "strategies"]));
          entriesByStrategy[a.id] = a.trades || [];
        });
        return { strategies: strategies, activeId: m.activeAccountId, entriesByStrategy: entriesByStrategy };
      }
    }
  ];

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
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch (err) {}
  }

  // A channel's data in one shape whatever produced it:
  // { accounts, activeAccountId, tombstones }.
  function modelOf(ch, raw) {
    var m = ch.toModel(raw);
    if (!m.activeAccountId && m.accounts[0]) m.activeAccountId = m.accounts[0].id;
    m.tombstones = (raw && !Array.isArray(raw) && raw.tombstones && typeof raw.tombstones === "object") ? raw.tombstones : {};
    return m;
  }
  function readLocal(ch) {
    var raw = readJSON(ch.localKey);
    if (!raw && ch.legacyKey) raw = readJSON(ch.legacyKey);
    return modelOf(ch, raw);
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
  // Same, keeping the stamps: whether the server has exactly this.
  function exact(v) {
    if (Array.isArray(v)) return "[" + v.map(exact).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ":" + exact(v[k]); }).join(",") + "}";
    }
    return v === undefined ? "null" : JSON.stringify(v);
  }
  function accountMeta(acc) {
    return copyFields(acc, ["trades", "strategies"]);
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
      var out = accountMeta(meta);
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

  function setAsideKeys(user, ch) {
    var prefix = SIGNED_OUT_PREFIX + String(user).toLowerCase() + "." + ch.name + ".";
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) keys.push(k);
      }
    } catch (err) {}
    return keys.sort();
  }

  // ---------- 3. the sync cycle ----------
  function emit(list, payload) {
    list.slice().forEach(function (fn) { try { fn(payload); } catch (err) {} });
  }
  function setStatus(ok, reason) { emit(statusListeners, { ok: ok, reason: reason || null }); }

  function signedIn() { return !!(window.EZAuth && EZAuth.isLoggedIn()); }

  // Merges one channel's local copy with the server's. Synchronous from
  // reading this device's copy to writing the result, so nothing the page
  // does can slip in between. Returns what to upload (or null) and what to
  // keep as the next base once the upload lands.
  function mergeChannel(ch, remoteRaw, user, now) {
    var state = readJSON(ch.stateKey) || {};
    if (state.user !== user) state = { user: user, base: null, tombstones: {} };

    var local = readLocal(ch);
    var tomb = {};
    Object.keys(state.tombstones || {}).forEach(function (id) { tomb[id] = state.tombstones[id]; });
    stampChanges(local, state.base, tomb, now);

    // This account's copies from signing out on this device (account.js):
    // added back like a device that's never synced, so nothing in them
    // counts as deleted. Their stamps are as old as their edits, so
    // anything changed since, here or elsewhere, wins.
    var setAside = setAsideKeys(user, ch);
    setAside.forEach(function (key) {
      var copy = readJSON(key);
      if (copy) local.accounts = mergeAccounts(local.accounts, modelOf(ch, copy).accounts, {});
    });

    var rem = modelOf(ch, remoteRaw);
    Object.keys(rem.tombstones).forEach(function (id) {
      if (!tomb[id] || rem.tombstones[id] > tomb[id]) tomb[id] = rem.tombstones[id];
    });
    prune(tomb, now);

    var accounts = mergeAccounts(local.accounts, rem.accounts, tomb);
    var activeId = accounts.some(function (a) { return a.id === local.activeAccountId; })
      ? local.activeAccountId
      : (accounts[0] ? accounts[0].id : null);
    var before = readLocal(ch);
    var changed = stable(accounts) !== stable(before.accounts);

    writeJSON(ch.localKey, ch.fromModel({ accounts: accounts, activeAccountId: activeId }));
    if (ch.legacyKey) removeKey(ch.legacyKey);
    setAside.forEach(removeKey);
    state.tombstones = tomb;
    writeJSON(ch.stateKey, state);

    var serverHasIt = remoteRaw && exact({ a: rem.accounts, t: rem.tombstones }) === exact({ a: accounts, t: tomb });
    var upload = null;
    if (!serverHasIt) {
      upload = ch.fromModel({ accounts: accounts, activeAccountId: activeId });
      upload.tombstones = tomb;
    }
    return { changed: changed, upload: upload, base: { accounts: accounts } };
  }

  function runSync() {
    return EZAuth.fetchData().then(function (remote) {
      if (!remote) throw { reason: "offline" };
      var user = EZAuth.getUsername();
      var now = Date.now();
      var results = {};
      var payload = null;
      var changedNames = [];
      CHANNELS.forEach(function (ch) {
        var r = mergeChannel(ch, remote[ch.name], user, now);
        results[ch.name] = r;
        if (r.changed) changedNames.push(ch.name);
        if (r.upload) { payload = payload || {}; payload[ch.name] = r.upload; }
      });
      if (changedNames.length) emit(updateListeners, { source: "remote", channels: changedNames });

      var push = !payload ? Promise.resolve() : EZAuth.saveDataStrict(payload).catch(function (err) {
        var msg = String((err && err.message) || "");
        throw { reason: /too large/i.test(msg) ? "too-large" : "upload-failed", message: msg };
      });
      return push.then(function () {
        CHANNELS.forEach(function (ch) {
          var s = readJSON(ch.stateKey) || { tombstones: {} };
          s.user = user;
          s.base = results[ch.name].base;
          s.lastSyncAt = Date.now();
          writeJSON(ch.stateKey, s);
        });
        setStatus(true);
        return { changed: changedNames.length > 0, channels: changedNames };
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
    CHANNELS.forEach(function (ch) { removeKey(ch.stateKey); });
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

  window.EZSync = {
    sync: syncNow,
    schedule: schedule,
    reset: reset,
    // fn({ source, channels }): "journal" and/or "backtest" changed here.
    onUpdate: function (fn) { updateListeners.push(fn); },
    onStatus: function (fn) { statusListeners.push(fn); }
  };
})();
