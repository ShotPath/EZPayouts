// The toolbar popup. Every change is saved straight away; open charts pick
// it up live (see shared/skins.js). Also opened as a full tab for
// "Upload your own", because a file picker closes the popup.
(function () {
  var IN_TAB = /[?&]tab=/.test(location.search) ||
    (chrome.extension && chrome.extension.getViews && chrome.extension.getViews({ type: "popup" }).indexOf(window) === -1);
  if (IN_TAB) document.body.classList.add("in-tab");

  var $ = function (id) { return document.getElementById(id); };
  var enabledEl = $("enabled");
  var tagsEnabledEl = $("tagsEnabled");
  var grid = $("grid");
  var fileEl = $("file");
  var uploadNote = $("uploadNote");
  var settings = EZSkins.defaults();
  var custom = null; // { thumb, name } of the user's own file, if any
  var liveThumbs = {};   // liquid chrome and scene stills, made here
  var skinTab = "live";  // which skins the grid shows: "live" or "video"

  var SLIDERS = {
    strength: function (v) { return Math.round(v) + "%"; },
    dim: function (v) { return Math.round(v) + "%"; },
    blur: function (v) { return Math.round(v) + "px"; },
    speed: function (v) { return Number(v).toFixed(2) + "×"; }
  };

  function save() { return EZSkins.save(settings); }

  // ---------- Wallpaper / Order tags cards ----------
  var MODE_KEY = "ezPopupMode";
  var mode = "wallpaper";
  try { var savedMode = localStorage.getItem(MODE_KEY); if (savedMode === "tags" || savedMode === "pos") mode = savedMode; } catch (err) {}
  function showMode() {
    [].forEach.call(document.querySelectorAll(".mode"), function (m) {
      m.setAttribute("aria-selected", m.getAttribute("data-mode") === mode ? "true" : "false");
    });
    $("wallPanel").hidden = mode !== "wallpaper";
    $("tagsPanel").hidden = mode !== "tags";
    $("posPanel").hidden = mode !== "pos";
  }
  [].forEach.call(document.querySelectorAll(".mode"), function (m) {
    function pick() {
      mode = m.getAttribute("data-mode");
      try { localStorage.setItem(MODE_KEY, mode); } catch (err) {}
      showMode();
    }
    m.addEventListener("click", pick);
    m.addEventListener("keydown", function (e) {
      if (e.target === m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(); }
    });
  });
  function renderModeSubs() {
    var skin = EZSkins.byId(settings.skin);
    $("wallSub").textContent = settings.enabled ? (skin ? skin.label : "") : "Off";
    var pal = EZSkins.tagColors.filter(function (c) { return c.id === settings.tagColors; })[0];
    var style = EZSkins.tagStyles.filter(function (t) { return t.id === settings.tagStyle; })[0];
    $("tagsSub").textContent = settings.tagsEnabled ? (pal ? pal.label : "") + " · " + (style ? style.label : "") : "Off";
    $("posSub").textContent = settings.posEnabled ? EZSkins.posPalette(settings.posTheme, settings.skin).label : "Off";
  }

  // ---------- Position tool ----------
  function renderPos() {
    $("posEnabled").checked = settings.posEnabled;
    var grid = $("posThemeGrid");
    grid.textContent = "";
    EZSkins.posThemes.forEach(function (t) {
      var p = EZSkins.posPalette(t.id, settings.skin);
      var b = el("button", "swatch");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-id", t.id);
      b.setAttribute("aria-checked", t.id === settings.posTheme ? "true" : "false");
      b.tabIndex = t.id === settings.posTheme ? 0 : -1;
      var dots = el("span", "swatch-dots");
      dots.append(el("i", null, null, { background: p.c }), el("i", null, null, { background: p.c2 }));
      b.append(dots, el("span", "swatch-name", t.label));
      b.title = t.id === "match" ? "Match wallpaper (" + p.label + " for this one)" : t.label;
      grid.appendChild(b);
    });
    var P = EZSkins.posTheme(settings), box = $("posPreview"), a = P.a || 0.3;
    [["pc", P.c, 1], ["pc85", P.c, 0.85], ["pc75", P.c, 0.75], ["pc60", P.c, 0.6], ["pc35", P.c, 0.35], ["pc2", P.c2, 1], ["pc2_90", P.c2, 0.9],
      ["pta1", P.c, a * 1.15], ["pta2", P.c, a * 0.8], ["pstop", hexMix(P.c, "#05070c", 0.82), 0.62],
      ["pcl", hexMix(P.c, "#ffffff", 0.4), 1], ["pcd", hexMix(P.c, "#000000", 0.22), 1]]
      .forEach(function (v) { box.style.setProperty("--" + v[0], rgba(v[1], v[2])); });
    var n = parseInt(P.c.slice(1), 16);
    box.style.setProperty("--ptink", (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.62 ? "#14171f" : "#ffffff");
    box.classList.toggle("glint", !!P.glint);
    var skin = EZSkins.byId(settings.skin);
    var thumb = !settings.enabled || !skin ? null
      : skin.type === "liquid" || skin.type === "scene" ? liveThumbs[skin.id] : skin.type === "custom" ? (custom && custom.thumb) : skin.thumb;
    box.style.backgroundImage = thumb ? "linear-gradient(rgba(10,12,16,0.35), rgba(10,12,16,0.35)), url(\"" + thumb + "\")" : "";
    renderModeSubs();
  }
  $("posThemeGrid").addEventListener("click", function (e) {
    var b = e.target.closest(".swatch");
    if (!b) return;
    settings.posTheme = b.getAttribute("data-id");
    renderPos();
    save();
  });
  $("posThemeGrid").addEventListener("keydown", function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var tiles = [].slice.call($("posThemeGrid").children);
    var next = tiles[Math.max(0, Math.min(tiles.length - 1, tiles.indexOf(document.activeElement) + keys[e.key]))];
    if (next) { next.click(); $("posThemeGrid").querySelector('[data-id="' + next.getAttribute("data-id") + '"]').focus(); }
  });
  $("posEnabled").addEventListener("change", function () {
    settings.posEnabled = $("posEnabled").checked;
    renderModeSubs();
    save().then(refreshSite);
  });

  // ---------- Order tags ----------
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function el(tag, cls, text, css) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (css) Object.keys(css).forEach(function (k) { if (css[k] != null) e.style[k] = css[k]; });
    return e;
  }
  // The same colors content/page-hook.js gives each part of a tag.
  function look(T, cls) {
    var c = T[cls], st = T.style;
    return {
      color: c,
      border: st === "minimal" ? rgba(c, 0.22) : c,
      bg: st === "filled" ? T.tint[cls] : st === "minimal" ? T.bgSoft : T.bg,
      text: st === "filled" ? T.ink : c,
      div: rgba(c, st === "filled" ? 0.45 : 0.3),
      glow: st === "glow" ? c : null
    };
  }
  function glowText(L) { return L.glow ? "0 0 6px " + L.glow : null; }
  function tagEl(T, cls, qty, label, labelColor, qtyFilled) {
    var L = look(T, cls);
    var t = el("span", "tp-tag", null, { borderColor: L.border, background: L.bg, boxShadow: L.glow ? "0 0 7px " + L.glow : null });
    t.style.setProperty("--div", L.div);
    t.appendChild(qtyFilled
      ? el("span", null, qty, { background: T.style === "minimal" ? rgba(L.color, 0.22) : L.color, color: T.on[cls] })
      : el("span", null, qty, { color: L.text, textShadow: glowText(L) }));
    t.appendChild(el("span", null, label, { color: labelColor || L.text, textShadow: glowText({ glow: L.glow && (labelColor || L.text) }) }));
    t.appendChild(el("span", null, "×", { color: L.color, textShadow: glowText(L) }));
    return t;
  }
  function buttonEl(T, cls, text) {
    var L = look(T, cls);
    return el("span", "tp-btn", text, { borderColor: L.color, color: L.color, background: T.style === "minimal" ? T.bgSoft : T.bg, textShadow: glowText(L) });
  }
  function lineEl(T, cls, solid) {
    var L = look(T, cls);
    return el("span", "tp-line" + (solid ? " solid" : ""), null, { borderTopColor: L.color, boxShadow: L.glow ? "0 0 6px " + L.glow : null });
  }
  // Modern and Frosted Glass, as content/page-hook.js draws them on the
  // chart (tags and price-scale boxes), in HTML.
  function hexMix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var ch = function (sh) { return Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t); };
    return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  function vars(e, T, cls, under) {
    var c = T[cls];
    e.style.setProperty("--c", c);
    e.style.setProperty("--c1", hexMix(c, "#ffffff", 0.22));
    e.style.setProperty("--c2", hexMix(c, "#000000", 0.25));
    e.style.setProperty("--lt", hexMix(c, "#ffffff", 0.62));
    e.style.setProperty("--ink", T.on[cls]);
    e.style.setProperty("--g", rgba(c, 0.32));
    e.style.setProperty("--tint", rgba(c, 0.24));
    e.style.setProperty("--u", "linear-gradient(90deg, " + c + ", " + (under || c) + ")");
    return e;
  }
  function arrowEl(up) { return el("span", "pv-arrow" + (up ? "" : " down")); }
  function redrawnTag(T, cls, o) {
    var frosted = T.style === "frosted", up = cls === "buy";
    var side = [arrowEl(up), el("span", null, o.position ? "LONG " + o.qty : up ? "BUY" : "SELL")];
    var body = o.position
      ? [el("span", "pv-pnl", o.pnl, { color: T.profit, textShadow: "0 0 8px " + rgba(T.profit, 0.5) }), el("span", "pv-q", "USD")]
      : o.short ? [el("span", null, o.type), el("span", "pv-q", o.qty)]
      : [el("span", null, o.type), el("span", "pv-q", "QTY"), el("span", "pv-q2", o.qty)];
    var x = el("span", "pv-x", "×");
    if (!frosted) {
      var t = vars(el("span", "m-tag"), T, cls);
      var sd = el("span", "m-side"); sd.append.apply(sd, side);
      var bd = el("span", "m-body"); bd.append.apply(bd, body);
      t.append(sd, bd, x);
      return [t];
    }
    if (o.position) {
      var p = vars(el("span", "f-pill f-pos"), T, cls, hexMix(T[cls], "#22d3ee", 0.6));
      var ps = el("span", "f-side"); ps.append.apply(ps, side);
      var pb = el("span", "f-body"); pb.append.apply(pb, body.concat([x]));
      p.append(ps, pb);
      return [p];
    }
    var a = vars(el("span", "f-pill f-tint"), T, cls);
    var as = el("span", "f-side"); as.append.apply(as, side); a.append(as);
    var b = vars(el("span", "f-pill"), T, cls, hexMix(T[cls], "#8b5cf6", 0.55));
    var bb = el("span", "f-body"); bb.append.apply(bb, body.concat([x])); b.append(bb);
    return [a, b];
  }
  function redrawnButtons(T) {
    if (T.style === "frosted") {
      var pair = el("span", "f-pill f-pair");
      pair.style.setProperty("--a", T.profit); pair.style.setProperty("--b", T.warn);
      pair.style.setProperty("--ta", rgba(T.profit, 0.24)); pair.style.setProperty("--tb", rgba(T.warn, 0.24));
      pair.append(el("span", null, "TP", { color: hexMix(T.profit, "#ffffff", 0.3) }), el("span", null, "SL", { color: hexMix(T.warn, "#ffffff", 0.3) }));
      return [pair];
    }
    return [["TP", "profit"], ["SL", "warn"]].map(function (b) {
      var e = vars(el("span", "m-btn"), T, b[1]);
      e.append(el("i"), el("span", null, b[0]));
      return e;
    });
  }
  function priceBox(T, cls, price) {
    var e = vars(el("span", T.style === "frosted" ? "f-ax" : "m-ax"), T, cls);
    if (T.style !== "frosted") e.appendChild(el("i"));
    e.appendChild(el("span", null, price));
    return e;
  }
  function renderTagPreview() {
    var T = EZSkins.tagTheme(settings);
    var box = $("tagPreview");
    box.textContent = "";
    box.classList.toggle("redrawn", T.style === "modern" || T.style === "frosted");
    if (T.style === "modern" || T.style === "frosted") {
      var r1 = el("div", "tp-row");
      r1.append.apply(r1, [lineEl(T, "sell")].concat(redrawnTag(T, "sell", { type: "Limit", qty: "1" }), [priceBox(T, "sell", "345.00")]));
      var r2 = el("div", "tp-row");
      var rv = vars(el("span", T.style === "frosted" ? "f-pill f-icon" : "m-btn m-icon", "⇅"), T, "buy");
      r2.append.apply(r2, [lineEl(T, "buy", true), rv].concat(redrawnTag(T, "buy", { position: true, qty: "2", pnl: "+156.00" }), [priceBox(T, "buy", "339.80")]));
      var r3 = el("div", "tp-row");
      r3.append.apply(r3, [lineEl(T, "buy")].concat(redrawnButtons(T), redrawnTag(T, "buy", { type: "Limit", qty: "1", short: true }), [priceBox(T, "buy", "337.00")]));
      box.append(r1, r2, r3);
    } else {
      var sell = el("div", "tp-row");
      sell.append(lineEl(T, "sell"), tagEl(T, "sell", "1", "Sell limit"));
      var pos = el("div", "tp-row");
      var rev = el("span", "tp-rev", "⇅", { borderColor: look(T, "buy").border, color: T.buy, background: T.style === "minimal" ? T.bgSoft : T.bg });
      pos.append(lineEl(T, "buy", true), rev, tagEl(T, "buy", "2", "+156.00 USD", T.profit, true));
      var buy = el("div", "tp-row");
      buy.append(lineEl(T, "buy"), buttonEl(T, "profit", "TP"), buttonEl(T, "warn", "SL"), tagEl(T, "buy", "1", "Buy limit"));
      box.append(sell, pos, buy);
    }
    // Over the wallpaper, when it's on, the way it'll look on the chart.
    var skin = EZSkins.byId(settings.skin);
    var thumb = !settings.enabled || !skin ? null
      : skin.type === "liquid" || skin.type === "scene" ? liveThumbs[skin.id] : skin.type === "custom" ? (custom && custom.thumb) : skin.thumb;
    box.style.backgroundImage = thumb ? "linear-gradient(rgba(10,12,16,0.45), rgba(10,12,16,0.45)), url(\"" + thumb + "\")" : "";
    box.style.backgroundSize = "cover";
    box.style.backgroundPosition = "center";
  }
  function renderTagColors() {
    var grid = $("tagColorGrid");
    grid.textContent = "";
    EZSkins.tagColors.forEach(function (c) {
      var p = EZSkins.tagPalette(c.id, settings.skin);
      var b = el("button", "swatch");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-id", c.id);
      b.setAttribute("aria-checked", c.id === settings.tagColors ? "true" : "false");
      b.tabIndex = c.id === settings.tagColors ? 0 : -1;
      var dots = el("span", "swatch-dots");
      ["buy", "sell", "profit", "warn"].forEach(function (k) { dots.appendChild(el("i", null, null, { background: p[k] })); });
      b.append(dots, el("span", "swatch-name", c.label));
      b.title = c.id === "match" ? "Match wallpaper (" + p.label + " for this one)" : c.label;
      grid.appendChild(b);
    });
  }
  function renderTagStyle() {
    var seg = $("tagStyle");
    seg.textContent = "";
    EZSkins.tagStyles.forEach(function (t) {
      var b = el("button", null, t.label);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-id", t.id);
      b.setAttribute("aria-checked", t.id === settings.tagStyle ? "true" : "false");
      seg.appendChild(b);
    });
  }
  function renderTags() {
    tagsEnabledEl.checked = settings.tagsEnabled;
    renderTagColors();
    renderTagStyle();
    renderTagPreview();
    renderModeSubs();
  }
  $("tagColorGrid").addEventListener("click", function (e) {
    var b = e.target.closest(".swatch");
    if (!b) return;
    settings.tagColors = b.getAttribute("data-id");
    renderTags();
    save();
  });
  $("tagColorGrid").addEventListener("keydown", function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var tiles = [].slice.call($("tagColorGrid").children);
    var next = tiles[Math.max(0, Math.min(tiles.length - 1, tiles.indexOf(document.activeElement) + keys[e.key]))];
    if (next) { next.click(); $("tagColorGrid").querySelector('[data-id="' + next.getAttribute("data-id") + '"]').focus(); }
  });
  $("tagStyle").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings.tagStyle = b.getAttribute("data-id");
    renderTags();
    save();
  });
  tagsEnabledEl.addEventListener("change", function () {
    settings.tagsEnabled = tagsEnabledEl.checked;
    renderModeSubs();
    save().then(refreshSite);
  });

  // ---------- Skins ----------
  function tileFor(skin) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.setAttribute("role", "radio");
    b.setAttribute("data-id", skin.id);
    var thumb = skin.type === "liquid" || skin.type === "scene" ? liveThumbs[skin.id]
      : skin.type === "custom" ? (custom && custom.thumb) : skin.thumb;
    if (skin.type === "custom" && !custom) {
      b.classList.add("empty");
      b.innerHTML = '<span class="plus" aria-hidden="true">+</span>';
    } else if (thumb) {
      var img = document.createElement("img");
      img.src = thumb;
      img.alt = "";
      img.loading = "lazy";
      b.appendChild(img);
    }
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = skin.label;
    b.appendChild(label);
    b.title = skin.type === "custom" && custom ? "Your own: " + custom.name : skin.label;
    return b;
  }
  // Animated skins and videos each get a tab; your own file shows in both.
  function inTab(skin) {
    if (skin.type === "custom") return true;
    return skinTab === "video" ? skin.type === "video" : skin.type !== "video";
  }
  function renderGrid() {
    grid.textContent = "";
    EZSkins.list.filter(inTab).forEach(function (skin) { grid.appendChild(tileFor(skin)); });
    [].forEach.call($("skinTabs").children, function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === skinTab ? "true" : "false");
    });
    markSelected();
  }
  // No video skins (the Chrome Web Store build): one list, no Videos tab.
  if (!EZSkins.list.some(function (s) { return s.type === "video"; })) {
    $("skinTabs").querySelector('[data-tab="video"]').hidden = true;
  }
  $("skinTabs").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.getAttribute("data-tab") === skinTab) return;
    skinTab = b.getAttribute("data-tab");
    renderGrid();
  });
  function markSelected() {
    [].forEach.call(grid.children, function (t) {
      var on = t.getAttribute("data-id") === settings.skin;
      t.setAttribute("aria-checked", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
  }
  grid.addEventListener("click", function (e) {
    var t = e.target.closest(".tile");
    if (!t) return;
    var id = t.getAttribute("data-id");
    if (id === "custom" && !custom) { startUpload(); return; }
    settings.skin = id;
    markSelected();
    renderModeSubs();
    renderTagPreview();
    save();
  });
  // Arrow keys move through the skins, like any radio group.
  grid.addEventListener("keydown", function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var tiles = [].slice.call(grid.children);
    var i = tiles.indexOf(document.activeElement);
    var next = tiles[Math.max(0, Math.min(tiles.length - 1, i + keys[e.key]))];
    if (next) { next.focus(); next.click(); }
  });

  // ---------- Your own file ----------
  function startUpload() {
    if (!IN_TAB) {
      // The file picker would close this popup; finish in a tab instead.
      chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html?tab=upload") });
      window.close();
      return;
    }
    fileEl.click();
  }
  $("uploadBtn").addEventListener("click", startUpload);

  function note(text, bad) {
    uploadNote.textContent = text;
    uploadNote.hidden = !text;
    uploadNote.classList.toggle("bad", !!bad);
  }

  // A small still for the tile: the video's frame half a second in, or the image.
  function makeThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var done = function (el, w, h) {
        try {
          var c = document.createElement("canvas");
          var scale = Math.max(240 / w, 150 / h);
          c.width = 240; c.height = 150;
          var ctx = c.getContext("2d");
          ctx.drawImage(el, (240 - w * scale) / 2, (150 - h * scale) / 2, w * scale, h * scale);
          resolve(c.toDataURL("image/jpeg", 0.85));
        } catch (err) {
          resolve("");
        }
        URL.revokeObjectURL(url);
      };
      if (/^video\//.test(file.type)) {
        var v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.onloadeddata = function () { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
        v.onseeked = function () { done(v, v.videoWidth, v.videoHeight); };
        v.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        v.src = url;
      } else {
        var img = new Image();
        img.onload = function () { done(img, img.naturalWidth, img.naturalHeight); };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      }
    });
  }

  fileEl.addEventListener("change", function () {
    var f = fileEl.files && fileEl.files[0];
    fileEl.value = "";
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) { note("That file is over 500 MB. Try a shorter clip.", true); return; }
    note("Saving " + f.name + "…");
    makeThumb(f).then(function (thumb) {
      if (thumb === null) throw new Error("unreadable");
      return EZMedia.setCustom({ blob: f, type: f.type, name: f.name, thumb: thumb }).then(function () {
        custom = { thumb: thumb, name: f.name };
        settings.skin = "custom";
        settings.customVersion = Date.now();
        renderGrid();
        return save();
      });
    }).then(function () {
      note("Saved. It stays on this computer and is now your skin.");
    }, function (err) {
      note(err && err.message === "unreadable"
        ? "Chrome can't play that file. Try an MP4, WebM, GIF, PNG or JPG."
        : "Couldn't save that file. Try a smaller one.", true);
    });
  });

  // ---------- Adjust ----------
  function renderControls() {
    enabledEl.checked = settings.enabled;
    Object.keys(SLIDERS).forEach(function (k) {
      $(k).value = settings[k];
      $(k + "Out").textContent = SLIDERS[k](settings[k]);
    });
    [].forEach.call($("fps").children, function (b) {
      b.setAttribute("aria-checked", Number(b.getAttribute("data-fps")) === settings.fps ? "true" : "false");
    });
  }
  Object.keys(SLIDERS).forEach(function (k) {
    $(k).addEventListener("input", function () {
      settings[k] = Number($(k).value);
      $(k + "Out").textContent = SLIDERS[k](settings[k]);
      save();
    });
  });
  $("fps").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings.fps = Number(b.getAttribute("data-fps"));
    renderControls();
    save();
  });
  enabledEl.addEventListener("change", function () {
    settings.enabled = enabledEl.checked;
    renderModeSubs();
    renderTagPreview();
    save().then(refreshSite);
  });
  $("resetBtn").addEventListener("click", function () {
    var d = EZSkins.defaults();
    ["strength", "dim", "blur", "speed", "fps"].forEach(function (k) { settings[k] = d[k]; });
    renderControls();
    save();
  });

  // ---------- This site ----------
  var tab = null;
  var siteEl = $("site"), siteText = $("siteText"), siteBtn = $("siteBtn"), siteDot = $("siteDot"), tipEl = $("tip");

  function isTradingView(u) { return /(^|\.)tradingview(-widget)?\.com$/.test(u.hostname); }
  function setSite(html, on, button, quiet) {
    siteEl.hidden = false;
    siteText.innerHTML = html;
    siteDot.classList.toggle("on", !!on);
    siteBtn.hidden = !button;
    siteBtn.textContent = button || "";
    siteBtn.classList.toggle("quiet", !!quiet);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function isLight(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return false;
    var n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6;
  }
  function askTab() {
    return chrome.tabs.sendMessage(tab.id, { type: "ez-skin-status" }).catch(function () { return null; });
  }

  function refreshSite() {
    tipEl.hidden = true;
    if (IN_TAB || !tab || !tab.url || !/^https?:/.test(tab.url)) {
      if (!IN_TAB) setSite("Open a <b>TradingView</b> chart to see your skin.", false);
      return;
    }
    var u = new URL(tab.url);
    var listed = settings.sites.indexOf(u.origin) !== -1;
    var anyOn = settings.enabled || settings.tagsEnabled || settings.posEnabled;
    askTab().then(function (st) {
      var host = esc(u.hostname.replace(/^www\./, ""));
      if (isTradingView(u)) {
        if (!st) setSite("Open a chart on <b>TradingView</b> to see your skin.", false);
        else if (!anyOn) setSite("Off on <b>TradingView</b>. Flip a switch below.", false);
        else setSite("Skinning your <b>TradingView</b> chart.", true);
      } else if (listed || st) {
        if (!anyOn) setSite("Off. Flip a switch below to skin <b>" + host + "</b>.", false, "Turn off here", true);
        else if (st && st.charts) setSite("Skinning the chart on <b>" + host + "</b>.", true, "Turn off here", true);
        else setSite("On for <b>" + host + "</b>, waiting for a chart.", false, "Turn off here", true);
      } else {
        setSite("Not on <b>" + host + "</b>.", false, "Turn on here");
      }
      if (st && st.on && isLight(st.base)) {
        tipEl.textContent = "Tip: switch the chart to its dark theme so labels stay readable over the skin.";
        tipEl.hidden = false;
      }
    });
  }

  siteBtn.addEventListener("click", function () {
    if (!tab) return;
    var origin = new URL(tab.url).origin;
    var pattern = origin + "/*";
    if (settings.sites.indexOf(origin) !== -1 || siteBtn.classList.contains("quiet")) {
      settings.sites = settings.sites.filter(function (o) { return o !== origin; });
      save()
        .then(function () { return chrome.permissions.remove({ origins: [pattern] }).catch(function () {}); })
        .then(function () { return chrome.runtime.sendMessage({ type: "ez-skin-site", tabId: tab.id, on: false }); })
        .then(refreshSite);
      return;
    }
    // Saved for next time if Chrome grants the site; otherwise just this visit.
    chrome.permissions.request({ origins: [pattern] }).catch(function () { return false; }).then(function (granted) {
      if (granted && settings.sites.indexOf(origin) === -1) settings.sites.push(origin);
      return save().then(function () {
        return chrome.runtime.sendMessage({ type: "ez-skin-site", tabId: tab.id, on: true, persist: !!granted });
      });
    }).then(function () { setTimeout(refreshSite, 600); });
  });

  // ---------- Start ----------
  EZSkins.list.forEach(function (skin) {
    if (skin.type === "liquid") liveThumbs[skin.id] = EZChrome.still(240, 150);
    else if (skin.type === "scene") liveThumbs[skin.id] = EZScenes.still(skin.id, 240, 150, 0.6);
  });
  Promise.all([
    EZSkins.load(),
    EZMedia.getCustom().catch(function () { return null; }),
    IN_TAB ? Promise.resolve([]) : chrome.tabs.query({ active: true, currentWindow: true })
  ]).then(function (r) {
    settings = r[0];
    if (r[1] && r[1].blob) custom = { thumb: r[1].thumb, name: r[1].name };
    tab = r[2][0] || null;
    var current = EZSkins.byId(settings.skin);
    skinTab = current && current.type === "video" ? "video" : "live";
    renderGrid();
    renderControls();
    renderTags();
    renderPos();
    showMode();
    refreshSite();
    if (IN_TAB && /tab=upload/.test(location.search)) note("Pick a video (MP4, WebM, MOV), a GIF or an image. It stays on this computer.");
  });
  // The shortcut, or another window, changed something.
  EZSkins.onChange(function (s) {
    var skinChanged = s.skin !== settings.skin;
    var enabledChanged = s.enabled !== settings.enabled || s.tagsEnabled !== settings.tagsEnabled || s.posEnabled !== settings.posEnabled;
    settings = s;
    renderControls();
    renderTags();
    renderPos();
    if (skinChanged) markSelected();
    if (enabledChanged) refreshSite();
  });
})();
