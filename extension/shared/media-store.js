// The user's own skin file (video, GIF or image), kept in the extension's
// IndexedDB on this computer only. Saved from the popup, read by the skin.
var EZMedia = (function () {
  var db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("ez-skins", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("media"); };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function run(mode, fn) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("media", mode);
        var req = fn(tx.objectStore("media"));
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  // custom = { blob, type, name, thumb (data URL) }
  return {
    getCustom: function () { return run("readonly", function (s) { return s.get("custom"); }); },
    setCustom: function (rec) { return run("readwrite", function (s) { return s.put(rec, "custom"); }); }
  };
})();
