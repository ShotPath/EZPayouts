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
  // Order tag colors (content/page-hook.js recolors TradingView's order
  // and position tags with them): buy; sell, also losses; profit, also TP;
  // warn, the SL. "Match wallpaper" picks the set that suits the wallpaper.
  var TAG_COLORS = [
    { id: "match", label: "Match wallpaper" },
    { id: "ez", label: "EZ", buy: "#4c8dff", sell: "#ff5c7a", profit: "#3ee08c", warn: "#f5c25b" },
    { id: "neon", label: "Neon", buy: "#00e5ff", sell: "#ff2bd6", profit: "#39ff88", warn: "#ffd23f" },
    { id: "ocean", label: "Ocean", buy: "#38bdf8", sell: "#f472b6", profit: "#34d399", warn: "#fbbf24" },
    { id: "sakura", label: "Sakura", buy: "#b9a2ff", sell: "#ff8fb7", profit: "#8ff0c8", warn: "#ffd59e" },
    { id: "matrix", label: "Matrix", buy: "#00ff7f", sell: "#ff4d6d", profit: "#7dff9f", warn: "#e6ff4d" },
    { id: "ember", label: "Ember", buy: "#ffb347", sell: "#ff4b2b", profit: "#ffd166", warn: "#ff8c42" },
    { id: "chrome", label: "Chrome", buy: "#d6e4ff", sell: "#ff9fb0", profit: "#c9f7de", warn: "#ffe2a8" },
    { id: "mono", label: "Mono", buy: "#ffffff", sell: "#9aa3b5", profit: "#e5e7eb", warn: "#cbd5e1" }
  ];
  var MATCH = { "liquid-chrome": "chrome", sakura: "sakura", twinkle: "ocean", matrix: "matrix", "black-hole": "ember", embers: "ember" };
  // How tags look. Modern (a glass ticket with a color block) and Frosted
  // Glass (blurred pills with a glowing underline) are drawn from scratch,
  // price-scale boxes too; the rest recolor TradingView's own tags:
  // Outline (its look), Filled (a tinted box), Glow, Minimal (see-through).
  var TAG_STYLES = [
    { id: "modern", label: "Modern" }, { id: "frosted", label: "Frosted Glass" },
    { id: "outline", label: "Outline" }, { id: "filled", label: "Filled" },
    { id: "glow", label: "Glow" }, { id: "minimal", label: "Minimal" }
  ];
  // Long/Short Position tool themes (content/page-hook.js draws the tool's
  // zones, lines and labels in them): c lights the target and the frame,
  // c2 the entry line; a is how strongly the target is lit; glint puts a
  // star on each corner. "Match wallpaper" picks by wallpaper.
  var POS_THEMES = [
    { id: "match", label: "Match wallpaper" },
    { id: "starry", label: "Starry Space", c: "#4d8dff", c2: "#b8d2ff", a: 0.3, glint: true },
    { id: "ember", label: "Ember & Ash", c: "#ff7a2f", c2: "#ffc27a", a: 0.32 },
    { id: "blackhole", label: "Black Hole", c: "#e3a83f", c2: "#ffe2a0", a: 0.3 },
    { id: "silk", label: "Silk & Satin", c: "#d4d9e2", c2: "#ffffff", a: 0.1 },
    { id: "matrix", label: "Matrix", c: "#22d96b", c2: "#9dffc6", a: 0.3 },
    { id: "sakura", label: "Sakura", c: "#ff9cc4", c2: "#ffd6e7", a: 0.32 }
  ];
  var POS_MATCH = { "liquid-chrome": "silk", sakura: "sakura", twinkle: "starry", matrix: "matrix", "black-hole": "blackhole", embers: "ember" };
  function posPalette(id, skinId) {
    var p = findIn(POS_THEMES, id) || findIn(POS_THEMES, "match");
    return p.id === "match" ? findIn(POS_THEMES, POS_MATCH[skinId] || "starry") : p;
  }
  function posTheme(s) {
    var p = posPalette(s.posTheme, s.skin);
    return { id: p.id, c: p.c, c2: p.c2, a: p.a, glint: !!p.glint };
  }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function hexMix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var ch = function (sh) { return Math.round(((x >> sh) & 255) * t + ((y >> sh) & 255) * (1 - t)); };
    return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  function isLightHex(h) {
    var n = parseInt(h.slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.62;
  }
  // The color set a choice resolves to ("match" follows the wallpaper).
  function tagPalette(colorsId, skinId) {
    var p = findIn(TAG_COLORS, colorsId) || findIn(TAG_COLORS, "ez");
    return p.id === "match" ? findIn(TAG_COLORS, MATCH[skinId] || "ez") : p;
  }
  // Everything page-hook.js needs to draw the tags, from saved settings.
  function tagTheme(s) {
    var p = tagPalette(s.tagColors, s.skin);
    // bg is solid: the tag's border is a filled box under it.
    var t = { style: s.tagStyle, bg: "#0b0d12", bgSoft: "rgba(9,11,16,0.55)", ink: "#ffffff", muted: "#9aa3b5", tint: {}, on: {} };
    ["buy", "sell", "profit", "warn"].forEach(function (k) {
      t[k] = p[k];
      t.tint[k] = hexMix(p[k], "#090b10", 0.3);          // Filled boxes
      t.on[k] = isLightHex(p[k]) ? "#0b0d12" : "#ffffff"; // text on a box in this color
    });
    return t;
  }

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
  // enabled is the wallpaper; tagsEnabled the order tags, on their own.
  var DEFAULTS = {
    enabled: true, skin: "liquid-chrome",
    strength: 100, dim: 25, blur: 0, speed: 1, fps: 30,
    tagsEnabled: false, tagColors: "ez", tagStyle: "modern",
    posEnabled: false, posTheme: "match",
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
      tagsEnabled: !!s.tagsEnabled,
      tagColors: findIn(TAG_COLORS, s.tagColors) ? s.tagColors : d.tagColors,
      tagStyle: findIn(TAG_STYLES, s.tagStyle) ? s.tagStyle : d.tagStyle,
      posEnabled: !!s.posEnabled,
      posTheme: findIn(POS_THEMES, s.posTheme) ? s.posTheme : d.posTheme,
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
    tagColors: TAG_COLORS, tagStyles: TAG_STYLES, tagPalette: tagPalette, tagTheme: tagTheme,
    posThemes: POS_THEMES, posPalette: posPalette, posTheme: posTheme,
    load: load, save: save, onChange: onChange
  };
})();
