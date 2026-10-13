// The skin catalog and the saved settings, shared by the popup, the skin
// itself (skin/skin.js), the chart pages' host script and the background
// worker. Settings live in chrome.storage.local under one key; every part
// of the extension listens for changes, so a change in the popup (or the
// Alt+Shift+B shortcut) shows up on every open chart right away.
var EZSkins = (function () {
  var KEY = "ezSkin";

  // Video skins are the same clips as the EZPayouts share-card templates,
  // streamed from the site, so the extension itself stays small.
  var MEDIA = "https://ezpayouts.xyz/journal/share-presets/";
  // The Chrome Web Store build leaves these out (they're clips from films
  // and shows): tools/build-extension-zip.py --store empties this list.
  // store-build: videos start
  var VIDEOS = [
    ["japanese", "Japanese"], ["jjk-1", "JJK I"], ["jjk-2", "JJK II"],
    ["porsche", "Porsche"], ["bruce-wayne", "Bruce Wayne"], ["one-piece", "One Piece"],
    ["pain", "Pain"], ["porsche-2", "Porsche II"], ["wall-street", "Wall Street"],
    ["creed", "Creed"]
  ];
  // store-build: videos end
  // Animated skins drawn live (shared/chrome-gl.js and shared/scenes.js).
  var LIVE = [
    { id: "liquid-chrome", label: "Liquid Chrome", type: "liquid" },
    { id: "sakura", label: "Sakura", type: "scene" },
    { id: "twinkle", label: "Twinkle", type: "scene" },
    { id: "matrix", label: "Matrix", type: "scene" },
    { id: "black-hole", label: "Black Hole", type: "scene" },
    { id: "embers", label: "Embers", type: "scene" }
  ];
  var LIST = LIVE
    .concat(VIDEOS.map(function (v) {
      return { id: v[0], label: v[1], type: "video", src: MEDIA + v[0] + ".webm", thumb: MEDIA + v[0] + "-thumb.jpg" };
    }))
    .concat([{ id: "custom", label: "Your own", type: "custom" }]);

  // strength: how much skin vs. the chart's own background color (0-100).
  // dim: darkening over the skin (0-90). blur: px. speed: motion rate.
  // sites: other sites (origins) the user turned it on for.
  // customVersion: bumped when a new custom file is saved, so open skins
  // reload it.
  var DEFAULTS = {
    enabled: true, skin: "liquid-chrome",
    strength: 100, dim: 25, blur: 0, speed: 1, fps: 30,
    sites: [], customVersion: 0
  };

  function clamp(v, lo, hi, d) {
    v = Number(v);
    return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  }
  function normalize(s) {
    s = s || {};
    var d = DEFAULTS;
    return {
      enabled: s.enabled === undefined ? d.enabled : !!s.enabled,
      skin: byId(s.skin) ? s.skin : d.skin,
      strength: clamp(s.strength, 0, 100, d.strength),
      dim: clamp(s.dim, 0, 90, d.dim),
      blur: clamp(s.blur, 0, 20, d.blur),
      speed: clamp(s.speed, 0.25, 3, d.speed),
      fps: s.fps === 60 ? 60 : 30,
      sites: Array.isArray(s.sites) ? s.sites.filter(function (o) { return typeof o === "string"; }) : [],
      customVersion: Number(s.customVersion) || 0
    };
  }
  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }
  function load() {
    return chrome.storage.local.get(KEY).then(function (r) { return normalize(r[KEY]); });
  }
  function save(s) {
    var o = {};
    o[KEY] = normalize(s);
    return chrome.storage.local.set(o);
  }
  function onChange(cb) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[KEY]) cb(normalize(changes[KEY].newValue));
    });
  }

  return {
    list: LIST, byId: byId, defaults: function () { return normalize({}); },
    load: load, save: save, onChange: onChange
  };
})();
