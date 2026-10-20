// Runs in the page's own JavaScript world (manifest "world": "MAIN"), from
// the very start, so it sees the chart's canvas calls.
//
// TradingView (and its embedded charting library / lightweight charts)
// paints each chart canvas's background with a single full-canvas
// fillRect in "copy" mode. While a skin is on, that one fill becomes a
// clear, so the canvas is see-through wherever nothing else is drawn and
// the skin behind shows. Candles, wicks, lines, drawings and labels are
// drawn as usual, on top. The background color it would have painted is
// passed to the host script (data-ez-chart-bg) as the skin's base color.
//
// With order tags on, the chart's order and position tags take the chosen
// tag theme's colors (see "Order tags" below).
//
// It reads nothing else from the page and changes nothing while off.
(function () {
  if (window.__ezSkinHook) return;
  window.__ezSkinHook = true;

  // The switches are attributes on <html>. Read fresh each time: a frame
  // can have no <html> yet this early, and the charting library's frame
  // swaps in a whole new document (same window, so these hooks stay) once
  // it loads. watch() follows whichever document is current; the chart's
  // own drawing calls it again once there's a new one.
  function rootEl() { return document.documentElement; }
  var watchedDoc = null;
  function watch() {
    watchedDoc = document;
    new MutationObserver(function () { sync(); syncTags(); })
      .observe(document, { attributes: true, attributeFilter: ["data-ez-skin", "data-ez-tags"], subtree: true, childList: true });
    sync();
    syncTags();
  }
  var proto = CanvasRenderingContext2D.prototype;
  var fillRect = proto.fillRect;
  var chartCanvas = new WeakMap(); // canvas -> is it part of a chart
  var bgOf = new WeakMap();        // chart canvas -> its background color
  var seen = [];                   // WeakRefs to chart canvases, for toggling
  var lastBg = "";
  var on = false;

  function isChartCanvas(c) {
    var v = chartCanvas.get(c);
    if (v === undefined) {
      v = !!(c.closest && c.closest(".chart-markup-table, .tv-lightweight-charts"));
      // Not cached until attached: charts can draw before they're placed.
      if (c.isConnected) {
        chartCanvas.set(c, v);
        if (v && typeof WeakRef === "function") seen.push(new WeakRef(c));
      }
    }
    return v;
  }

  function parseColor(s) {
    var m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  // Charts only repaint when something changes, so a switch shows at once:
  // on, the background color already on each canvas is cleared; off, it's
  // painted back in underneath what's there. The chart's next real redraw
  // takes over from either.
  // Injected after the chart already drew (switched on from the popup):
  // find its canvases and read the background off the pixels along the
  // edges, the color most of them share.
  function discover() {
    var list = document.querySelectorAll(".chart-markup-table canvas, .tv-lightweight-charts canvas");
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (bgOf.get(c) || !c.width || !c.height || !isChartCanvas(c)) continue;
      try {
        var ctx = c.getContext("2d"), counts = {}, best = "", bestN = 0;
        for (var k = 0; k < 16; k++) {
          var t = k / 15;
          var pts = [[t * (c.width - 1), 1], [t * (c.width - 1), c.height - 2]];
          for (var j = 0; j < 2; j++) {
            var px = ctx.getImageData(Math.round(pts[j][0]), Math.round(pts[j][1]), 1, 1).data;
            if (px[3] !== 255) continue;
            var key = "#" + ((1 << 24) | (px[0] << 16) | (px[1] << 8) | px[2]).toString(16).slice(1);
            counts[key] = (counts[key] || 0) + 1;
            if (counts[key] > bestN) { bestN = counts[key]; best = key; }
          }
        }
        if (bestN >= 8) {
          bgOf.set(c, best);
          if (!lastBg && rootEl()) { lastBg = best; rootEl().setAttribute("data-ez-chart-bg", best); }
        }
      } catch (err) {}
    }
  }

  function applyNow() {
    if (on) discover();
    seen = seen.filter(function (ref) { return ref.deref(); });
    seen.forEach(function (ref) {
      var c = ref.deref();
      var color = c && c.isConnected && bgOf.get(c);
      if (!color || !c.width || !c.height) return;
      try {
        var ctx = c.getContext("2d");
        if (on) {
          var rgb = parseColor(color);
          if (!rgb) return;
          var img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
          for (var i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 255 && Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) <= 3) d[i + 3] = 0;
          }
          ctx.putImageData(img, 0, 0);
        } else {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = color;
          fillRect.call(ctx, 0, 0, c.width, c.height);
          ctx.restore();
        }
      } catch (err) {}
    });
  }

  function sync() {
    var root = rootEl();
    var next = !!root && root.getAttribute("data-ez-skin") === "on";
    if (next === on) return;
    on = next;
    applyNow();
  }

  // ---------- Order tags ----------
  // TradingView draws each order and position tag ("1 | Buy limit | ×",
  // "2 | -156.00 USD | ×", the TP and SL buttons) on the chart pane as one
  // group: save(), a small rounded box, its parts, restore(). While tags
  // are on (data-ez-tags holds the theme, see shared/skins.js), a small
  // rounded box filled on a pane canvas starts a tag, and everything drawn
  // until its group's restore() takes the theme's colors: a color's hue
  // says what it was (blue a buy, red a sell or a loss, green a profit or
  // TP, orange an SL), its lightness whether it was the box or the text.
  // Candles, indicators and drawings are drawn outside those groups and
  // keep their colors. The order lines in a tag's color are recolored too.
  var tagTheme = null;
  var paneCanvas = new WeakMap();
  var tagState = new WeakMap(); // context -> { depth, tagDepth, tagCls, path }
  var tagColors = new Set();    // the colors tags were drawn in: their lines match

  function isPane(c) {
    var v = paneCanvas.get(c);
    if (v === undefined) {
      v = !!(c.closest && c.closest(".chart-markup-table .chart-gui-wrapper"));
      if (c.isConnected) paneCanvas.set(c, v);
    }
    return v;
  }
  function stateOf(ctx) {
    var s = tagState.get(ctx);
    if (!s) {
      s = { depth: 0, tagDepth: -1, tagCls: null, tinted: false, path: { n: 0, arcs: 0, r: 0, x0: 0, y0: 0, x1: 0, y1: 0 } };
      tagState.set(ctx, s);
    }
    return s;
  }
  function tracking(ctx) {
    if (document !== watchedDoc) watch();
    var c = ctx.canvas;
    return tagTheme && c && c.nodeType === 1 && isPane(c);
  }
  function addPoint(p, x, y) {
    if (!p.n) { p.x0 = p.x1 = x; p.y0 = p.y1 = y; }
    else {
      if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x;
      if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
    }
    p.n++;
  }

  var GLOWS = { buy: 1, sell: 1, profit: 1, warn: 1 }; // the color classes
  var colorCache = new Map();
  // "#rrggbb", "#rgb" or rgb()/rgba() -> { cls, a }: cls is buy, sell,
  // profit or warn for a strong color, light, dark or grey for the rest.
  function classify(s) {
    var hit = colorCache.get(s);
    if (hit !== undefined) return hit;
    var r, g, b, a = 1, m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(s))) {
      r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16);
    } else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
      var n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255;
      if (m[2]) a = parseInt(m[2], 16) / 255;
    } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(s))) {
      r = +m[1]; g = +m[2]; b = +m[3]; if (m[4] !== undefined) a = +m[4];
    } else {
      colorCache.set(s, null);
      return null;
    }
    var mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
    var sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    var cls;
    if (sat < 0.18 || d < 0.12) cls = l > 0.8 ? "light" : l < 0.22 ? "dark" : "grey";
    else {
      var h = mx === r / 255 ? ((g - b) / 255 / d) % 6 : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
      h = (h * 60 + 360) % 360;
      cls = h < 15 || h >= 290 ? "sell" : h < 70 ? "warn" : h < 175 ? "profit" : "buy";
    }
    var out = { cls: cls, a: a };
    if (colorCache.size > 500) colorCache.clear();
    colorCache.set(s, out);
    return out;
  }
  function withAlpha(hex, a) {
    if (a >= 1) return hex;
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + Math.round(a * 1000) / 1000 + ")";
  }

  // The color a tag part takes. kind: "fill" (a box), "stroke" (an
  // outline or the × icon), "text", "divider" (the 1px lines between parts).
  function tagColor(st, kind, src) {
    var c = classify(src);
    if (!c) return null;
    var T = tagTheme, style = T.style;
    var accent = !!GLOWS[c.cls];
    if (accent) {
      // A tag's own color (its border and size box): its line has it too.
      // TP and SL buttons only outline theirs, in the candles' colors.
      if (kind === "fill") tagColors.add(src);
      if (!st.tagCls) st.tagCls = c.cls;
    }
    if (kind === "divider") return withAlpha(T[st.tagCls || "buy"], style === "filled" ? 0.45 : 0.3);
    if (!accent) {
      // White text sits on a filled box (the position's size), grey text
      // is a flat P&L; everything else light, dark or grey is the box.
      if (kind === "text") return c.cls === "light" ? T.on[st.tagCls || "buy"] : c.cls === "grey" ? T.muted : null;
      if (style === "filled" && st.tagCls) { st.tinted = true; return T.tint[st.tagCls]; }
      return style === "minimal" ? T.bgSoft : T.bg;
    }
    var col = T[c.cls];
    // Filled: the label is white on its tinted box. TP and SL buttons
    // aren't tinted (their color comes after their box), so keep theirs.
    if (kind === "text") return st.tinted && c.cls === st.tagCls ? T.ink : withAlpha(col, c.a);
    if (kind === "fill" && style === "minimal") return withAlpha(col, 0.22);
    return withAlpha(col, c.a);
  }

  var origSave = proto.save, origRestore = proto.restore;
  // Draws one tag part with its theme color, glowing in the Glow style. The
  // context's own style is put back after, so the chart never sees it.
  function drawThemed(ctx, st, kind, prop, orig, args) {
    var src = ctx[prop];
    var col = typeof src === "string" ? tagColor(st, kind, src) : null;
    if (!col) return orig.apply(ctx, args);
    origSave.call(ctx);
    ctx[prop] = col;
    var c = classify(src);
    if (tagTheme.style === "glow" && (kind === "stroke" || kind === "text") && c && GLOWS[c.cls]) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 7 * Math.max(1, Math.abs(ctx.getTransform().a));
    }
    try { return orig.apply(ctx, args); } finally { origRestore.call(ctx); }
  }

  proto.save = function () {
    if (tracking(this)) stateOf(this).depth++;
    return origSave.apply(this, arguments);
  };
  proto.restore = function () {
    var st = tagState.get(this);
    if (st) {
      if (st.depth > 0) st.depth--;
      if (st.tagDepth >= 0 && st.depth < st.tagDepth) { st.tagDepth = -1; st.tagCls = null; st.tinted = false; }
    }
    return origRestore.apply(this, arguments);
  };
  var origBeginPath = proto.beginPath;
  proto.beginPath = function () {
    if (tracking(this)) { var p = stateOf(this).path; p.n = 0; p.arcs = 0; p.r = 0; }
    return origBeginPath.apply(this, arguments);
  };
  ["moveTo", "lineTo"].forEach(function (name) {
    var orig = proto[name];
    proto[name] = function (x, y) {
      if (tracking(this)) addPoint(stateOf(this).path, x, y);
      return orig.apply(this, arguments);
    };
  });
  var origArcTo = proto.arcTo;
  proto.arcTo = function (x1, y1, x2, y2, r) {
    if (tracking(this)) {
      var p = stateOf(this).path;
      addPoint(p, x1, y1); addPoint(p, x2, y2);
      p.arcs++;
      if (r > p.r) p.r = r;
    }
    return origArcTo.apply(this, arguments);
  };
  var origRect = proto.rect;
  proto.rect = function (x, y, w, h) {
    if (tracking(this)) { var p = stateOf(this).path; addPoint(p, x, y); addPoint(p, x + w, y + h); }
    return origRect.apply(this, arguments);
  };

  // A small rounded box: how every tag (and TP/SL button) starts.
  function startsTag(st) {
    var p = st.path, h = p.y1 - p.y0, w = p.x1 - p.x0;
    return p.arcs >= 2 && p.r <= 6 && h >= 12 && h <= 36 && w >= 12 && st.depth >= 1;
  }
  // An order or position line: a straight horizontal stroke in a color a
  // tag was drawn in, broken where its tag sits. The current-price line
  // (the candles' green or red, like some tags) runs the full width.
  function isTagLine(ctx, st) {
    var p = st.path;
    if (!(p.n >= 2 && !p.arcs && p.y1 - p.y0 < 1 && p.x1 - p.x0 >= 24 &&
      typeof ctx.strokeStyle === "string" && tagColors.has(ctx.strokeStyle))) return false;
    var full = ctx.canvas.width / Math.max(0.01, Math.abs(ctx.getTransform().a));
    return !(p.x0 <= 1 && p.x1 >= full - 2);
  }

  var origFill = proto.fill;
  proto.fill = function () {
    if (!tracking(this)) return origFill.apply(this, arguments);
    var st = stateOf(this);
    if (st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) { st.tagDepth = st.depth - 1; st.tagCls = null; st.tinted = false; }
    if (st.tagDepth < 0) return origFill.apply(this, arguments);
    return drawThemed(this, st, "fill", "fillStyle", origFill, arguments);
  };
  var origStroke = proto.stroke;
  proto.stroke = function () {
    if (!tracking(this)) return origStroke.apply(this, arguments);
    var st = stateOf(this);
    if (st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) { st.tagDepth = st.depth - 1; st.tagCls = null; st.tinted = false; }
    if (st.tagDepth >= 0) return drawThemed(this, st, "stroke", "strokeStyle", origStroke, arguments);
    if (arguments.length === 0 && isTagLine(this, st)) return drawThemed(this, { tagCls: null }, "stroke", "strokeStyle", origStroke, arguments);
    return origStroke.apply(this, arguments);
  };
  var origFillText = proto.fillText;
  proto.fillText = function () {
    var st = tracking(this) && tagState.get(this);
    if (!st || st.tagDepth < 0) return origFillText.apply(this, arguments);
    return drawThemed(this, st, "text", "fillStyle", origFillText, arguments);
  };

  function syncTags() {
    var root = rootEl();
    var raw = root && root.getAttribute("data-ez-tags");
    var next = null;
    if (raw) { try { next = JSON.parse(raw); } catch (err) { next = null; } }
    tagTheme = next && next.buy ? next : null;
  }
  watch();

  proto.fillRect = function (x, y, w, h) {
    if (document !== watchedDoc) watch();
    // The 1px lines between a tag's parts.
    if (tagTheme && w <= 2.5 && h >= 8) {
      var tst = tracking(this) && tagState.get(this);
      if (tst && tst.tagDepth >= 0) return drawThemed(this, tst, "divider", "fillStyle", fillRect, arguments);
    }
    if (this.globalCompositeOperation === "copy") {
      var c = this.canvas;
      if (c && c.nodeType === 1 && isChartCanvas(c)) {
        var m = this.getTransform();
        var x0 = x * m.a + m.e, y0 = y * m.d + m.f;
        var x1 = (x + w) * m.a + m.e, y1 = (y + h) * m.d + m.f;
        if (x0 <= 0.5 && y0 <= 0.5 && x1 >= c.width - 0.5 && y1 >= c.height - 0.5) {
          var fs = this.fillStyle;
          if (typeof fs === "string") {
            bgOf.set(c, fs);
            if (fs !== lastBg) {
              lastBg = fs;
              if (rootEl()) rootEl().setAttribute("data-ez-chart-bg", fs);
            }
          }
          if (on) {
            this.clearRect(x, y, w, h);
            return;
          }
        }
      }
    }
    return fillRect.apply(this, arguments);
  };
})();
