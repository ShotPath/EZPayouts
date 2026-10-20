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
  var axisCanvas = new WeakMap();
  function isAxis(c) {
    var v = axisCanvas.get(c);
    if (v === undefined) {
      v = !!(c.closest && c.closest(".chart-markup-table .price-axis"));
      if (c.isConnected) axisCanvas.set(c, v);
    }
    return v;
  }
  function stateOf(ctx) {
    var s = tagState.get(ctx);
    if (!s) {
      s = { depth: 0, tagDepth: -1, tagCls: null, tinted: false, grp: null, axis: isAxis(ctx.canvas),
        path: { n: 0, arcs: 0, r: 0, x0: 0, y0: 0, x1: 0, y1: 0 } };
      tagState.set(ctx, s);
    }
    return s;
  }
  // Chart panes always; the price scale too for the looks drawn from
  // scratch (Modern, Frosted Glass), which restyle its order prices.
  function tracking(ctx) {
    if (document !== watchedDoc) watch();
    var c = ctx.canvas;
    return tagTheme && c && c.nodeType === 1 && (isPane(c) || (REDRAWN[tagTheme.style] && isAxis(c)));
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
    var done = null;
    if (st) {
      if (st.depth > 0) st.depth--;
      if (st.tagDepth >= 0 && st.depth < st.tagDepth) {
        done = st.grp;
        st.tagDepth = -1; st.tagCls = null; st.tinted = false; st.grp = null;
      }
    }
    var out = origRestore.apply(this, arguments);
    if (done) finishGroup(this, done);
    return out;
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

  // A small rounded box: how every tag (and TP/SL button) starts. On the
  // price scale, a price box (barely rounded, full scale width).
  function startsTag(st) {
    var p = st.path, h = p.y1 - p.y0, w = p.x1 - p.x0;
    if (st.axis) return p.arcs >= 2 && p.r <= 3 && h >= 12 && h <= 30 && w >= 20 && st.depth >= 1;
    return p.arcs >= 2 && p.r <= 6 && h >= 12 && h <= 36 && w >= 12 && st.depth >= 1;
  }
  function beginTag(ctx, st) {
    st.tagDepth = st.depth - 1; st.tagCls = null; st.tinted = false;
    st.grp = REDRAWN[tagTheme.style] ? newGroup(ctx, st) : null;
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
    if (st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) beginTag(this, st);
    if (st.tagDepth < 0) return origFill.apply(this, arguments);
    if (st.grp) return groupOp(this, st, "fill", origFill, arguments);
    if (st.axis) return origFill.apply(this, arguments);
    return drawThemed(this, st, "fill", "fillStyle", origFill, arguments);
  };
  var origStroke = proto.stroke;
  proto.stroke = function () {
    if (!tracking(this)) return origStroke.apply(this, arguments);
    var st = stateOf(this);
    if (st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) beginTag(this, st);
    if (st.tagDepth >= 0 && st.grp) return groupOp(this, st, "stroke", origStroke, arguments);
    if (st.axis) return origStroke.apply(this, arguments);
    if (st.tagDepth >= 0) return drawThemed(this, st, "stroke", "strokeStyle", origStroke, arguments);
    if (arguments.length === 0) {
      if (isTagLine(this, st)) return drawThemed(this, { tagCls: null }, "stroke", "strokeStyle", origStroke, arguments);
      notePriceLine(this, st);
    }
    return origStroke.apply(this, arguments);
  };
  var origFillText = proto.fillText;
  proto.fillText = function () {
    var st = tracking(this) && tagState.get(this);
    if (!st || st.tagDepth < 0) return origFillText.apply(this, arguments);
    if (st.grp) return groupOp(this, st, "text", origFillText, arguments);
    if (st.axis) return origFillText.apply(this, arguments);
    return drawThemed(this, st, "text", "fillStyle", origFillText, arguments);
  };

  // ---------- Redrawn looks: Modern, Frosted Glass ----------
  // These change a tag's shape, not just its colors. So inside a tag's
  // group TradingView's own drawing is skipped and noted down instead: its
  // box, its words (side and type, the size, the P&L, the price) and any
  // icon. When the group closes, the tag is drawn again in the chosen
  // look, in the same spot, its × where TradingView's is, so clicking and
  // dragging still work. TP/SL and icon buttons wait for the tag on their
  // row, to be drawn with it (Frosted Glass joins TP and SL into one
  // pill). On the price scale the boxes for orders (outlined in an order's
  // color) and the position (filled in its color) are redrawn the same
  // way; the live price and indicator boxes stay as they are. A rounded
  // box that turns out not to be a tag (a drawing tool's label, say) is
  // put back and drawn as it was.
  var REDRAWN = { modern: 1, frosted: 1 };
  var positionColors = new Set();   // what positions' size boxes are filled with
  var priceLineColors = new Set();  // the current-price line's colors
  var FONT_SIDE = "'EZ Chakra', 'Segoe UI', Roboto, sans-serif";
  var FONT_SANS = "'EZ Plex Sans', -apple-system, 'Segoe UI', Roboto, sans-serif";
  var FONT_MONO = "'EZ Plex Mono', ui-monospace, Menlo, Consolas, monospace";

  function devRect(ctx, p) {
    var m = ctx.getTransform();
    var xa = p.x0 * m.a + m.e, xb = p.x1 * m.a + m.e, ya = p.y0 * m.d + m.f, yb = p.y1 * m.d + m.f;
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
  }
  function newGroup(ctx, st) {
    return { mode: st.axis ? "axis?" : "pane?", s: Math.abs(ctx.getTransform().a) || 1,
      outer: null, outerCls: null, cls: null, texts: [], icons: [], held: [], filled: null, strokeCls: null };
  }
  // A held-back box or outline, drawn as TradingView would have.
  function replayHeld(ctx, g) {
    g.held.forEach(function (h) {
      origSave.call(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var r = h.rect, p = new Path2D();
      p.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, h.radii);
      if (h.stroke) {
        ctx.strokeStyle = h.style; ctx.lineWidth = h.lw; ctx.setLineDash(h.dash);
        origStroke.call(ctx, p);
      } else {
        ctx.fillStyle = h.style;
        origFill.call(ctx, p);
      }
      origRestore.call(ctx);
    });
    g.held = [];
  }
  function hold(ctx, st, stroke) {
    var s = Math.abs(ctx.getTransform().a) || 1, R = st.path.r * s;
    return { rect: devRect(ctx, st.path), radii: st.axis ? [0, R, R, 0] : R, stroke: stroke,
      style: stroke ? ctx.strokeStyle : ctx.fillStyle, lw: ctx.lineWidth * s, dash: ctx.getLineDash().map(function (d) { return d * s; }) };
  }
  function goNative(ctx, g, orig, args) {
    replayHeld(ctx, g);
    g.mode = "native";
    return orig.apply(ctx, args);
  }

  // One drawing call inside a tag's group, in a redrawn look.
  function groupOp(ctx, st, kind, orig, args) {
    var g = st.grp;
    if (g.mode === "native") return orig.apply(ctx, args);
    var style = kind === "stroke" ? ctx.strokeStyle : ctx.fillStyle;
    var c = typeof style === "string" ? classify(style) : null;
    var accent = !!(c && GLOWS[c.cls]);

    if (g.mode === "axis?") {
      // A price box. Filled in a position's color: the position's price.
      // Dark, then outlined in an order's color: an order's price.
      if (kind === "fill" && args.length === 0 && !g.held.length) {
        if (accent) {
          if (positionColors.has(style) && !priceLineColors.has(style)) { g.mode = "axis"; g.cls = c.cls; g.outer = devRect(ctx, st.path); return; }
          return goNative(ctx, g, orig, args);
        }
        g.held.push(hold(ctx, st, false));
        return;
      }
      if (kind === "stroke" && args.length === 0 && g.held.length && accent && tagColors.has(style)) {
        g.mode = "axis"; g.cls = c.cls; g.outer = g.held[0].rect; g.held = [];
        return;
      }
      return goNative(ctx, g, orig, args);
    }

    if (g.mode === "pane?") {
      // Filled in a color first: an order or position tag (its border).
      // A dark box first: a TP/SL or icon button if an outline or icon in
      // a color follows; anything else is put back.
      if (kind === "fill" && args.length === 0 && !g.held.length) {
        if (accent) {
          g.mode = "pane"; g.outer = devRect(ctx, st.path); g.outerCls = c.cls; tagColors.add(style);
          return;
        }
        g.held.push(hold(ctx, st, false));
        return;
      }
      if (kind === "stroke" && g.held.length && accent) {
        g.mode = "button"; g.outer = g.held[0].rect; g.strokeCls = c.cls;
        if (args.length === 0) g.held.push(hold(ctx, st, true));
        else return groupOp(ctx, st, kind, orig, args);
        return;
      }
      return goNative(ctx, g, orig, args);
    }

    if (kind === "text") {
      var t = String(args[0]);
      // A button holds two or three letters (TP, SL); longer is something else.
      if (g.mode === "button" && t.trim().length > 4) return goNative(ctx, g, orig, args);
      var m = ctx.getTransform(), x = +args[1] || 0, y = +args[2] || 0;
      g.texts.push({ t: t, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, cls: c ? c.cls : null });
      return;
    }
    if (g.mode === "axis") return;
    if (kind === "stroke" && args[0] && typeof args[0] === "object") {
      g.icons.push({ path: args[0], m: ctx.getTransform(), lw: ctx.lineWidth, cap: ctx.lineCap, join: ctx.lineJoin, cls: c && c.cls });
      return;
    }
    if (g.mode === "pane" && kind === "fill" && args.length === 0 && !st.path.arcs && accent) {
      // The size box filled in the tag's color: a position.
      g.filled = c.cls;
      positionColors.add(style);
    }
  }

  function notePriceLine(ctx, st) {
    var p = st.path;
    if (!(p.n >= 2 && !p.arcs && p.y1 - p.y0 < 1 && typeof ctx.strokeStyle === "string")) return;
    var full = ctx.canvas.width / Math.max(0.01, Math.abs(ctx.getTransform().a));
    if (p.x0 <= 1 && p.x1 >= full - 2) {
      if (priceLineColors.size > 24) priceLineColors.clear();
      priceLineColors.add(ctx.strokeStyle);
    }
  }

  var pending = [];        // buttons waiting for the tag on their row
  var flushQueued = false;
  function finishGroup(ctx, g) {
    try {
      if (g.mode === "axis") return drawAxisBox(ctx, g);
      if (g.mode === "pane?" || g.mode === "axis?") return replayHeld(ctx, g);
      if (!g.outer || (g.mode !== "pane" && g.mode !== "button")) return;
      g.cy = (g.outer.y0 + g.outer.y1) / 2;
      if (g.mode === "pane") return drawRow(ctx, g, takeRow(ctx.canvas, g));
      if (!g.texts.length && !g.icons.length) return replayHeld(ctx, g);
      g.held = [];
      pending.push({ ctx: ctx, g: g });
      if (!flushQueued) { flushQueued = true; queueMicrotask(flushPending); }
    } catch (err) {}
  }
  function takeRow(canvas, g) {
    var row = [];
    pending = pending.filter(function (it) {
      if (it.ctx.canvas === canvas && Math.abs(it.g.cy - g.cy) <= 3 * g.s) { row.push(it.g); return false; }
      return true;
    });
    return row.sort(function (a, b) { return a.outer.x0 - b.outer.x0; });
  }
  // Buttons whose row had no tag after them: drawn on their own.
  function flushPending() {
    flushQueued = false;
    while (pending.length) {
      var it = pending[0];
      try { drawButtons(it.ctx, takeRow(it.ctx.canvas, it.g)); } catch (err) { pending.shift(); }
    }
  }

  // ---------- Drawing ----------
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgba(h, a) { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(h1, h2, t) {
    var a = rgb(h1), b = rgb(h2), o = [0, 1, 2].map(function (i) { return Math.round(a[i] * (1 - t) + b[i] * t); });
    return "#" + ((1 << 24) | (o[0] << 16) | (o[1] << 8) | o[2]).toString(16).slice(1);
  }
  function rr(x, y, w, h, r) { var p = new Path2D(); p.roundRect(x, y, w, h, r); return p; }
  function seg(x0, y0, x1, y1) { var p = new Path2D(); p.moveTo(x0, y0); p.lineTo(x1, y1); return p; }
  function pen(ctx) {
    origSave.call(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.setLineDash([]); ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.direction = "ltr";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
  function shadow(ctx, color, blur, dy) {
    ctx.shadowColor = color || "transparent"; ctx.shadowBlur = blur || 0; ctx.shadowOffsetY = dy || 0;
  }
  function font(ctx, f, ls) {
    ctx.font = f;
    if ("letterSpacing" in ctx) ctx.letterSpacing = (ls || 0) + "px";
  }
  function tw(ctx, t, f, ls) { font(ctx, f, ls); return t ? ctx.measureText(t).width : 0; }
  function text(ctx, t, x, y, f, color, ls) { font(ctx, f, ls); ctx.fillStyle = color; origFillText.call(ctx, t, x, y); }
  function arrow(ctx, x, cy, w, up, color) {
    var h = w * 0.78, p = new Path2D();
    if (up) { p.moveTo(x + w / 2, cy - h / 2); p.lineTo(x + w, cy + h / 2); p.lineTo(x, cy + h / 2); }
    else { p.moveTo(x + w / 2, cy + h / 2); p.lineTo(x + w, cy - h / 2); p.lineTo(x, cy - h / 2); }
    p.closePath();
    ctx.fillStyle = color; origFill.call(ctx, p);
  }
  function cross(ctx, cx, cy, size, color, lw) {
    var h = size / 2, p = new Path2D();
    p.moveTo(cx - h, cy - h); p.lineTo(cx + h, cy + h); p.moveTo(cx + h, cy - h); p.lineTo(cx - h, cy + h);
    ctx.strokeStyle = color; ctx.lineWidth = lw; origStroke.call(ctx, p);
  }
  function icons(ctx, g, color) {
    g.icons.forEach(function (ic) {
      origSave.call(ctx);
      ctx.setTransform(ic.m);
      ctx.lineWidth = ic.lw; ctx.lineCap = ic.cap; ctx.lineJoin = ic.join; ctx.setLineDash([]);
      ctx.shadowColor = "transparent"; ctx.strokeStyle = color;
      origStroke.call(ctx, ic.path);
      origRestore.call(ctx);
    });
  }
  // A frosted panel: what's behind it on the chart, blurred, under a sheen.
  function frost(ctx, path, x, y, w, h, s, tint) {
    origSave.call(ctx);
    ctx.clip(path);
    var pad = 10 * s, cw = ctx.canvas.width, ch = ctx.canvas.height;
    var sx = Math.max(0, Math.floor(x - pad)), sy = Math.max(0, Math.floor(y - pad));
    var sw = Math.min(cw - sx, Math.ceil(w + pad * 2)), sh = Math.min(ch - sy, Math.ceil(h + pad * 2));
    if (sw > 0 && sh > 0) {
      ctx.filter = "blur(" + (5 * s) + "px)";
      ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.filter = "none";
    }
    ctx.fillStyle = "rgba(16,20,28,0.42)"; origFill.call(ctx, path);
    if (tint) { ctx.fillStyle = rgba(tint, 0.24); origFill.call(ctx, path); }
    var sheen = ctx.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0, "rgba(255,255,255,0.16)"); sheen.addColorStop(0.5, "rgba(255,255,255,0.04)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen; origFill.call(ctx, path);
    origRestore.call(ctx);
    ctx.strokeStyle = "rgba(255,255,255,0.17)"; ctx.lineWidth = s;
    origStroke.call(ctx, path);
  }
  // The glowing line along a frosted pill's bottom edge.
  function underline(ctx, x0, x1, yb, s, c0, c1) {
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, c0); g.addColorStop(1, c1 || c0);
    origSave.call(ctx);
    shadow(ctx, c0, 8 * s, 0);
    ctx.strokeStyle = g; ctx.lineWidth = 2.2 * s; ctx.lineCap = "round";
    origStroke.call(ctx, seg(x0, yb, x1, yb));
    origRestore.call(ctx);
  }
  // Modern's base: a dark glass ticket with a drop shadow and a faint glow.
  function glass(ctx, path, y, h, s, glowColor) {
    origSave.call(ctx);
    if (glowColor) { shadow(ctx, rgba(glowColor, 0.32), 14 * s, 0); ctx.fillStyle = "#0d1016"; origFill.call(ctx, path); }
    shadow(ctx, "rgba(0,0,0,0.55)", 10 * s, 3 * s); ctx.fillStyle = "#0d1016"; origFill.call(ctx, path);
    origRestore.call(ctx);
    var gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "rgba(38,44,58,0.97)"); gr.addColorStop(1, "rgba(13,16,22,0.97)");
    ctx.fillStyle = gr; origFill.call(ctx, path);
  }
  function edge(ctx, path, s) { ctx.strokeStyle = "rgba(255,255,255,0.11)"; ctx.lineWidth = s; origStroke.call(ctx, path); }

  // What a tag says: side and type, or the position's size and P&L.
  function readTag(g) {
    var texts = g.texts.filter(function (t) { return t.t.trim(); }).sort(function (a, b) { return a.x - b.x; });
    var qty = "", words = [];
    texts.forEach(function (t) {
      var v = t.t.replace(/ /g, " ").trim();
      if (!qty && /^[\d.,\s]+$/.test(v)) qty = v; else words.push({ t: v, cls: t.cls });
    });
    var info = { qty: qty, cls: g.filled || g.outerCls || "buy" };
    if (g.filled) {
      info.position = true;
      var p = words[0] ? words[0].t : "";
      var m = /^(.*?)\s*([A-Za-z]{3})$/.exec(p);
      info.pnl = (m ? m[1] : p).replace(/^([+\-−])\s+/, "$1"); info.ccy = m ? m[2] : "";
      info.pnlCls = words[0] && words[0].cls;
      info.side = g.filled === "sell" ? "SHORT" : "LONG";
    } else {
      var label = words.map(function (w) { return w.t; }).join(" ");
      var sm = /^(buy|sell)\b\s*(.*)$/i.exec(label);
      info.side = sm ? sm[1].toUpperCase() : info.cls === "sell" ? "SELL" : "BUY";
      info.type = sm ? sm[2] : label;
      info.type = info.type ? info.type.charAt(0).toUpperCase() + info.type.slice(1).toLowerCase() : "";
    }
    info.up = info.side === "BUY" || info.side === "LONG";
    return info;
  }
  function pnlColor(info) {
    var T = tagTheme;
    return info.pnlCls === "profit" ? T.profit : info.pnlCls === "sell" ? T.sell : "#c9d1e0";
  }

  // A row: its TP/SL and icon buttons, then the tag itself.
  function drawRow(ctx, g, row) {
    drawButtons(ctx, row);
    var left = row.length ? row[row.length - 1].outer.x1 + 3 * g.s : g.outer.x0 - 70 * g.s;
    pen(ctx);
    try {
      if (tagTheme.style === "frosted") drawFrostedTag(ctx, g, readTag(g), left);
      else drawModernTag(ctx, g, readTag(g), left);
    } finally { origRestore.call(ctx); }
  }

  // Lays a tag out right to left from TradingView's right edge, shrinking
  // its words to fit the room it has (TP/SL buttons sit to its left).
  function layout(ctx, g, info, left, frosted) {
    var s = g.s, room = g.outer.x1 - left, out = null;
    // Shrinking steps: drop "QTY", then a position's "LONG" (its arrow and
    // color say it), then smaller type.
    var steps = info.position
      ? [[1, false, false], [0.9, false, false], [1, false, true], [0.9, false, true], [0.8, false, true], [0.72, false, true]]
      : [[1, true, false], [1, false, false], [0.9, false, false], [0.8, false, false], [0.72, false, false]];
    steps.some(function (v) {
      var k = v[0] * s, showQty = v[1], compact = v[2];
      var L = { k: k, showQty: showQty, H: 22 * s,
        fSide: "700 " + 10.5 * k + "px " + FONT_SIDE, lsSide: 1.05 * k,
        fLabel: "600 " + 11 * k + "px " + FONT_SANS, fMono: "600 " + 10 * k + "px " + FONT_MONO,
        fPnl: "600 " + 12.5 * k + "px " + FONT_MONO, arrowW: 7.5 * k };
      L.sideText = info.position ? (compact ? info.qty : info.side + " " + info.qty) : info.side;
      L.sideW = 8 * s + L.arrowW + 5 * s + tw(ctx, L.sideText, L.fSide, L.lsSide) + 9 * s;
      if (info.position) {
        L.bodyW = 9 * s + tw(ctx, info.pnl, L.fPnl) + (info.ccy ? 5 * s + tw(ctx, info.ccy, L.fMono) : 0) + 8 * s;
      } else {
        L.bodyW = 9 * s + (info.type ? tw(ctx, info.type, L.fLabel) + 8 * s : 0) +
          (showQty ? tw(ctx, "QTY", L.fMono) + 4 * s : 0) + tw(ctx, info.qty, L.fMono) + 9 * s;
      }
      L.xW = 22 * s;
      L.gap = frosted && !info.position ? 4 * s : 0;
      L.W = L.sideW + L.gap + L.bodyW + L.xW;
      out = L;
      return L.W <= room;
    });
    out.x1 = g.outer.x1; out.x0 = out.x1 - out.W;
    out.y = g.cy - out.H / 2;
    return out;
  }
  function bodyText(ctx, L, info, x, cy, s, frosted) {
    if (info.position) {
      var pc = pnlColor(info);
      origSave.call(ctx); shadow(ctx, rgba(pc, 0.5), 8 * s, 0);
      text(ctx, info.pnl, x, cy, L.fPnl, pc);
      origRestore.call(ctx);
      x += tw(ctx, info.pnl, L.fPnl) + 5 * s;
      if (info.ccy) text(ctx, info.ccy, x, cy, L.fMono, "#8790a5");
      return;
    }
    if (info.type) { text(ctx, info.type, x, cy, L.fLabel, "#eef2fa"); x += tw(ctx, info.type, L.fLabel) + 8 * s; }
    if (L.showQty) { text(ctx, "QTY", x, cy, L.fMono, "#8790a5"); x += tw(ctx, "QTY", L.fMono) + 4 * s; }
    text(ctx, info.qty, x, cy, L.fMono, L.showQty ? "#c6ccda" : "#8790a5");
  }

  function drawModernTag(ctx, g, info, left) {
    var s = g.s, c = tagTheme[info.cls] || tagTheme.buy, L = layout(ctx, g, info, left, false);
    var x0 = L.x0, y = L.y, H = L.H, R = 6 * s, cy = g.cy;
    var whole = rr(x0, y, L.W, H, R);
    glass(ctx, whole, y, H, s, c);
    var side = rr(x0, y, L.sideW, H, [R, 0, 0, R]);
    var sg = ctx.createLinearGradient(0, y, 0, y + H);
    sg.addColorStop(0, mix(c, "#ffffff", 0.22)); sg.addColorStop(0.55, c); sg.addColorStop(1, mix(c, "#000000", 0.25));
    ctx.fillStyle = sg; origFill.call(ctx, side);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = s;
    origStroke.call(ctx, seg(x0 + R * 0.7, y + 1.1 * s, x0 + L.sideW - 1 * s, y + 1.1 * s));
    edge(ctx, rr(x0 + 0.5 * s, y + 0.5 * s, L.W - s, H - s, R), s);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    origStroke.call(ctx, seg(L.x1 - L.xW, y + 5 * s, L.x1 - L.xW, y + H - 5 * s));
    arrow(ctx, x0 + 8 * s, cy, L.arrowW, info.up, "#ffffff");
    text(ctx, L.sideText, x0 + 8 * s + L.arrowW + 5 * s, cy, L.fSide, "#ffffff", L.lsSide);
    bodyText(ctx, L, info, x0 + L.sideW + 9 * s, cy, s, false);
    cross(ctx, L.x1 - L.xW / 2, cy, 6.5 * s, "#8790a5", 1.5 * s);
  }

  function drawFrostedTag(ctx, g, info, left) {
    var s = g.s, c = tagTheme[info.cls] || tagTheme.buy, L = layout(ctx, g, info, left, true);
    var x0 = L.x0, y = L.y, H = L.H, R = H / 2, cy = g.cy, yb = y + H - 1.3 * s;
    var light = mix(c, "#ffffff", 0.62);
    if (info.position) {
      var all = rr(x0, y, L.W, H, R);
      frost(ctx, all, x0, y, L.W, H, s, null);
      origSave.call(ctx); ctx.clip(all);
      ctx.fillStyle = rgba(c, 0.26); origFill.call(ctx, rr(x0, y, L.sideW, H, [R, 0, 0, R]));
      origRestore.call(ctx);
      ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = s;
      origStroke.call(ctx, seg(x0 + L.sideW, y + 4 * s, x0 + L.sideW, y + H - 4 * s));
      underline(ctx, x0 + R * 0.8, L.x1 - R * 0.8, yb, s, c, mix(c, "#22d3ee", 0.6));
    } else {
      var sideP = rr(x0, y, L.sideW, H, R);
      frost(ctx, sideP, x0, y, L.sideW, H, s, c);
      underline(ctx, x0 + R * 0.8, x0 + L.sideW - R * 0.8, yb, s, c);
      var bx = x0 + L.sideW + L.gap, bw = L.bodyW + L.xW, bodyP = rr(bx, y, bw, H, R);
      frost(ctx, bodyP, bx, y, bw, H, s, null);
      underline(ctx, bx + R * 0.8, bx + bw - R * 0.8, yb, s, c, mix(c, "#8b5cf6", 0.55));
    }
    arrow(ctx, x0 + 9 * s, cy, L.arrowW, info.up, light);
    text(ctx, L.sideText, x0 + 9 * s + L.arrowW + 5 * s, cy, L.fSide, light, L.lsSide);
    bodyText(ctx, L, info, x0 + L.sideW + L.gap + 9 * s, cy, s, true);
    cross(ctx, L.x1 - L.xW / 2 - 2 * s, cy, 6.5 * s, "#aeb5c4", 1.5 * s);
  }

  // TP/SL (and icon) buttons, at TradingView's spots. Frosted Glass joins
  // a TP and SL that sit side by side into one pill.
  function drawButtons(ctx, row) {
    if (!row.length) return;
    pen(ctx);
    try {
      var frosted = tagTheme.style === "frosted";
      for (var i = 0; i < row.length; i++) {
        var a = row[i], b = row[i + 1];
        if (frosted && b && a.texts.length && b.texts.length && b.outer.x0 - a.outer.x1 <= 4 * a.s) {
          drawFrostedPair(ctx, a, b); i++;
        } else if (a.texts.length) {
          drawLabelButton(ctx, a, frosted);
        } else {
          drawIconButton(ctx, a, frosted);
        }
      }
    } finally { origRestore.call(ctx); }
  }
  function btnFont(s) { return "700 " + 10 * s + "px " + FONT_SIDE; }
  function drawLabelButton(ctx, g, frosted) {
    var s = g.s, c = tagTheme[g.strokeCls] || tagTheme.profit, label = g.texts[0].t.trim().toUpperCase();
    var H = 22 * s, f = btnFont(s), dot = frosted ? 0 : 5 * s, pad = 5 * s;
    var W = g.outer.x1 - g.outer.x0, x1 = g.outer.x1, x0 = g.outer.x0, y = g.cy - H / 2;
    var need = 2 * pad + dot + (dot ? 3.5 * s : 0) + tw(ctx, label, f, 0.8 * s);
    if (need > W) { f = "700 " + 9 * s + "px " + FONT_SIDE; need = 2 * pad + dot + (dot ? 3.5 * s : 0) + tw(ctx, label, f, 0.6 * s); }
    var cx = x0 + Math.max(0, (W - need) / 2) + pad;
    if (frosted) {
      var p = rr(x0, y, W, H, H / 2);
      frost(ctx, p, x0, y, W, H, s, c);
      underline(ctx, x0 + H * 0.4, x1 - H * 0.4, y + H - 1.3 * s, s, c);
      text(ctx, label, cx, g.cy, f, mix(c, "#ffffff", 0.3), 0.8 * s);
      return;
    }
    var pm = rr(x0, y, W, H, 6 * s);
    glass(ctx, pm, y, H, s, null); edge(ctx, pm, s);
    origSave.call(ctx); shadow(ctx, c, 6 * s, 0);
    ctx.fillStyle = c; var d = new Path2D(); d.arc(cx + dot / 2, g.cy, dot / 2, 0, Math.PI * 2); origFill.call(ctx, d);
    origRestore.call(ctx);
    text(ctx, label, cx + dot + 3.5 * s, g.cy, f, "#eef2fa", 0.6 * s);
  }
  function drawFrostedPair(ctx, a, b) {
    var s = a.s, H = 22 * s, f = btnFont(s), y = a.cy - H / 2;
    var ca = tagTheme[a.strokeCls] || tagTheme.profit, cb = tagTheme[b.strokeCls] || tagTheme.warn;
    var la = a.texts[0].t.trim().toUpperCase(), lb = b.texts[0].t.trim().toUpperCase();
    var x0 = a.outer.x0, x1 = b.outer.x1, mid = (a.outer.x1 + b.outer.x0) / 2;
    var p = rr(x0, y, x1 - x0, H, H / 2);
    frost(ctx, p, x0, y, x1 - x0, H, s, null);
    origSave.call(ctx); ctx.clip(p);
    ctx.fillStyle = rgba(ca, 0.24); origFill.call(ctx, rr(x0, y, mid - x0, H, 0));
    ctx.fillStyle = rgba(cb, 0.24); origFill.call(ctx, rr(mid, y, x1 - mid, H, 0));
    origRestore.call(ctx);
    ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = s;
    origStroke.call(ctx, seg(mid, y + 4 * s, mid, y + H - 4 * s));
    underline(ctx, x0 + H * 0.4, mid - 1.5 * s, y + H - 1.3 * s, s, ca);
    underline(ctx, mid + 1.5 * s, x1 - H * 0.4, y + H - 1.3 * s, s, cb);
    ctx.textAlign = "center";
    text(ctx, la, (x0 + mid) / 2 + 1 * s, a.cy, f, mix(ca, "#ffffff", 0.3), 0.8 * s);
    text(ctx, lb, (mid + x1) / 2 - 1 * s, a.cy, f, mix(cb, "#ffffff", 0.3), 0.8 * s);
    ctx.textAlign = "left";
  }
  function drawIconButton(ctx, g, frosted) {
    var s = g.s, H = 22 * s, x0 = g.outer.x0, W = g.outer.x1 - x0, y = g.cy - H / 2;
    var c = tagTheme[g.strokeCls] || tagTheme.buy;
    if (frosted) {
      var p = rr(x0, y, W, H, H / 2);
      frost(ctx, p, x0, y, W, H, s, null);
      underline(ctx, x0 + H * 0.4, x0 + W - H * 0.4, y + H - 1.3 * s, s, c);
    } else {
      var pm = rr(x0, y, W, H, 6 * s);
      glass(ctx, pm, y, H, s, null); edge(ctx, pm, s);
    }
    icons(ctx, g, "#e9edf5");
  }

  // A price box on the price scale, for an order or the position.
  function drawAxisBox(ctx, g) {
    var s = g.s, c = tagTheme[g.cls] || tagTheme.buy, r = g.outer;
    var price = (g.texts[0] && g.texts[0].t.replace(/ /g, " ").trim()) || "";
    var H = Math.max(r.y1 - r.y0 + 2 * s, 18 * s), cy = (r.y0 + r.y1) / 2, y = cy - H / 2;
    var x0 = r.x0 + 1 * s, W = r.x1 - x0;
    pen(ctx);
    try {
      var px = 11, f;
      if (tagTheme.style === "frosted") {
        do { f = "600 " + px * s + "px " + FONT_MONO; px -= 0.5; } while (px > 8 && tw(ctx, price, f) > W - 10 * s);
        var p = rr(x0, y, W, H, H / 2);
        origSave.call(ctx); shadow(ctx, rgba(c, 0.6), 12 * s, 0); ctx.fillStyle = c; origFill.call(ctx, p); origRestore.call(ctx);
        var gr = ctx.createLinearGradient(0, y, 0, y + H);
        gr.addColorStop(0, mix(c, "#ffffff", 0.28)); gr.addColorStop(0.55, c); gr.addColorStop(1, mix(c, "#000000", 0.2));
        ctx.fillStyle = gr; origFill.call(ctx, p);
        ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = s;
        origStroke.call(ctx, seg(x0 + H * 0.45, y + 1.2 * s, x0 + W - H * 0.45, y + 1.2 * s));
        ctx.textAlign = "center";
        text(ctx, price, x0 + W / 2, cy + 0.5 * s, f, "#ffffff");
        return;
      }
      var withDot = true;
      do {
        f = "600 " + px * s + "px " + FONT_MONO;
        withDot = tw(ctx, price, f) + 8 * s + 10 * s <= W;
        px -= 0.5;
      } while (px > 8 && tw(ctx, price, f) + (withDot ? 18 : 8) * s > W);
      var pm = rr(x0, y, W, H, 6 * s);
      glass(ctx, pm, y, H, s, null); edge(ctx, pm, s);
      if (withDot) {
        origSave.call(ctx); shadow(ctx, c, 6 * s, 0);
        ctx.fillStyle = c; var d = new Path2D(); d.arc(x0 + 7 * s, cy, 3 * s, 0, Math.PI * 2); origFill.call(ctx, d);
        origRestore.call(ctx);
        text(ctx, price, x0 + 13 * s, cy, f, "#eef2fa");
      } else {
        ctx.fillStyle = c; origFill.call(ctx, rr(x0, y + 4 * s, 2.5 * s, H - 8 * s, 1 * s));
        ctx.textAlign = "center";
        text(ctx, price, x0 + W / 2 + 1.5 * s, cy, f, "#eef2fa");
      }
    } finally { origRestore.call(ctx); }
  }

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
    var tst = tagTheme && tracking(this) && tagState.get(this);
    if (tst && tst.tagDepth >= 0) {
      if (tst.grp) return groupOp(this, tst, "rect", fillRect, arguments);
      // The 1px lines between a tag's parts.
      if (!tst.axis && w <= 2.5 && h >= 8) return drawThemed(this, tst, "divider", "fillStyle", fillRect, arguments);
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
