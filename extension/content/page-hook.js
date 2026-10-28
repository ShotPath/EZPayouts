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
      .observe(document, { attributes: true, attributeFilter: ["data-ez-skin", "data-ez-tags", "data-ez-pos"], subtree: true, childList: true });
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
  var posTheme = null;  // the Long/Short Position tool's theme (data-ez-pos)
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
        path: { n: 0, arcs: 0, r: 0, circle: 0, slant: 0, lx: 0, ly: 0, x0: 0, y0: 0, x1: 0, y1: 0 } };
      tagState.set(ctx, s);
    }
    return s;
  }
  // Chart panes always; the price scale too for the looks drawn from
  // scratch (Modern, Frosted Glass), which restyle its order prices.
  function tracking(ctx) {
    if (document !== watchedDoc) watch();
    var c = ctx.canvas;
    return (tagTheme || posTheme) && c && c.nodeType === 1 &&
      (isPane(c) || (tagTheme && REDRAWN[tagTheme.style] && isAxis(c)));
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
      // Minimal's boxes are see-through, so its words take the color.
      // A white icon (a check mark) goes with the words.
      if (kind === "text" || (kind === "stroke" && c.cls === "light")) {
        if (c.cls === "light") return style === "minimal" ? T[st.tagCls || "buy"] : T.on[st.tagCls || "buy"];
        return c.cls === "grey" ? T.muted : null;
      }
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
    if (tracking(this)) { var p = stateOf(this).path; p.n = 0; p.arcs = 0; p.r = 0; p.circle = 0; p.slant = 0; }
    return origBeginPath.apply(this, arguments);
  };
  ["moveTo", "lineTo"].forEach(function (name) {
    var orig = proto[name];
    proto[name] = function (x, y) {
      if (tracking(this)) {
        var p = stateOf(this).path;
        // A segment neither level nor upright (an arrow, not a box's side).
        if (name === "lineTo" && p.n && Math.abs(x - p.lx) > 1 && Math.abs(y - p.ly) > 1) p.slant++;
        addPoint(p, x, y); p.lx = x; p.ly = y;
      }
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
  // A circle (arc) counts by its bounds (the add-order button has one).
  var origArc = proto.arc;
  proto.arc = function (x, y, r) {
    if (tracking(this)) { var p = stateOf(this).path; addPoint(p, x - r, y - r); addPoint(p, x + r, y + r); p.circle++; }
    return origArc.apply(this, arguments);
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
    if (st.axis) return p.arcs >= 2 && p.r <= 3 && h >= 12 && h <= 44 && w >= 20 && st.depth >= 1;
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
    if (tagTheme && st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) beginTag(this, st);
    if (st.tagDepth < 0) return origFill.apply(this, arguments);
    if (st.grp) return groupOp(this, st, "fill", origFill, arguments);
    if (st.axis) return origFill.apply(this, arguments);
    return drawThemed(this, st, "fill", "fillStyle", origFill, arguments);
  };
  var origStroke = proto.stroke;
  proto.stroke = function () {
    if (!tracking(this)) return origStroke.apply(this, arguments);
    var st = stateOf(this);
    if (tagTheme && st.tagDepth < 0 && arguments.length === 0 && startsTag(st)) beginTag(this, st);
    if (st.tagDepth >= 0 && st.grp) return groupOp(this, st, "stroke", origStroke, arguments);
    if (st.axis) return origStroke.apply(this, arguments);
    if (st.tagDepth >= 0) return drawThemed(this, st, "stroke", "strokeStyle", origStroke, arguments);
    if (tagTheme && arguments.length === 0) {
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
  // icon. Once the chart has drawn everything, each row is drawn again in
  // the chosen look, in the same spots: the × on TradingView's, the size,
  // order type and P&L each over TradingView's own, so clicking and
  // dragging do what they look like they do. A row is its tag and the
  // buttons on it: TP and SL (Frosted Glass joins them into one pill), icon
  // buttons, a new order's place button (its side and a check mark; the
  // order's tag then leaves its side out, so it isn't said twice), and a
  // moved order's Confirm and Discard. Buttons stay inside TradingView's
  // own, so a click never lands on a neighbor. A TP or SL line's own tag
  // (its size and P&L) is drawn like a position's.
  // On the price scale every price box is redrawn: an order's (outlined in
  // its color) and the position's (filled in its color) with a dot, the
  // rest (the live price, indicators, drawings, the crosshair) with their
  // own color as an accent. A rounded box that turns out not to be any of
  // these (a drawing tool's label, say) is put back as it was.
  var REDRAWN = { modern: 1, frosted: 1 };
  var positionColors = new Set();   // what positions' size boxes are filled with
  var priceLineColors = new Set();  // the current-price line's colors
  var SIDE_WORD = /^\s*(buy|sell)\s*$/i;
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
      outer: null, outerCls: null, texts: [], icons: [], held: [], filled: null, filledStyle: null,
      strokeCls: null, box: null, edge: null };
  }
  // Held-back boxes, outlines and words, drawn as TradingView would have.
  function replayHeld(ctx, g) {
    g.held.forEach(function (h) {
      origSave.call(ctx);
      if (h.path && h.fill) {
        ctx.setTransform(h.m);
        ctx.fillStyle = h.style; origFill.call(ctx, h.path, h.rule);
      } else if (h.path) {
        ctx.setTransform(h.m);
        ctx.strokeStyle = h.style; ctx.lineWidth = h.lw; ctx.lineCap = h.cap; ctx.lineJoin = h.join; ctx.setLineDash(h.dash);
        origStroke.call(ctx, h.path);
      } else if (h.text !== undefined) {
        ctx.setTransform(h.m);
        ctx.font = h.font; ctx.fillStyle = h.style; ctx.textAlign = h.align; ctx.textBaseline = h.base;
        origFillText.call(ctx, h.text, h.x, h.y);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var r = h.rect, p = new Path2D();
        if (h.circle) p.arc((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.x1 - r.x0) / 2, 0, Math.PI * 2);
        else p.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, h.radii);
        if (h.stroke) {
          ctx.strokeStyle = h.style; ctx.lineWidth = h.lw; ctx.setLineDash(h.dash);
          origStroke.call(ctx, p);
        } else {
          ctx.fillStyle = h.style;
          origFill.call(ctx, p);
        }
      }
      origRestore.call(ctx);
    });
    g.held = [];
  }
  function hold(ctx, st, stroke) {
    var s = Math.abs(ctx.getTransform().a) || 1, R = st.path.r * s;
    return { rect: devRect(ctx, st.path), radii: st.axis ? [0, R, R, 0] : R, stroke: stroke, circle: !!st.path.circle,
      style: stroke ? ctx.strokeStyle : ctx.fillStyle, lw: ctx.lineWidth * s, dash: ctx.getLineDash().map(function (d) { return d * s; }) };
  }
  function holdText(ctx, args) {
    return { text: String(args[0]), x: +args[1] || 0, y: +args[2] || 0, m: ctx.getTransform(),
      font: ctx.font, style: ctx.fillStyle, align: ctx.textAlign, base: ctx.textBaseline };
  }
  function holdPath(ctx, path) {
    return { path: path, m: ctx.getTransform(), style: ctx.strokeStyle, lw: ctx.lineWidth,
      cap: ctx.lineCap, join: ctx.lineJoin, dash: ctx.getLineDash() };
  }
  // A filled icon (Path2D), such as the mark at the front of a replay
  // order's tag.
  function holdFill(ctx, args) {
    return { path: args[0], fill: true, rule: typeof args[1] === "string" ? args[1] : "nonzero", m: ctx.getTransform(), style: ctx.fillStyle };
  }
  function iconOf(ctx, path, c) {
    return { path: path, m: ctx.getTransform(), lw: ctx.lineWidth, cap: ctx.lineCap, join: ctx.lineJoin, cls: c && c.cls };
  }
  function rectOf(ctx, a) { return devRect(ctx, { x0: +a[0], y0: +a[1], x1: +a[0] + +a[2], y1: +a[1] + +a[3] }); }
  function inside(r, o) { return r.x0 >= o.x0 - 1 && r.x1 <= o.x1 + 1 && r.y0 >= o.y0 - 1 && r.y1 <= o.y1 + 1; }
  function overlaps(r, o) { return r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0; }
  // A word as drawn: where (device px; cx its middle), its color class
  // and size.
  function noteText(ctx, g, args, c) {
    var m = ctx.getTransform(), x = +args[1] || 0, y = +args[2] || 0, k = Math.abs(m.a) || 1;
    var t = String(args[0]), px = /([\d.]+)px/.exec(ctx.font), w = ctx.measureText(t).width * k, al = ctx.textAlign;
    var X = m.a * x + m.c * y + m.e;
    g.texts.push({ t: t, x: X, y: m.b * x + m.d * y + m.f, w: w,
      cx: al === "center" ? X : al === "right" || al === "end" ? X - w / 2 : X + w / 2,
      cls: c ? c.cls : null, style: ctx.fillStyle, size: (px ? +px[1] : 12) * k });
  }
  function goNative(ctx, g, orig, args) {
    replayHeld(ctx, g);
    g.mode = "native";
    return orig.apply(ctx, args);
  }

  // One drawing call inside a tag's group, in a redrawn look.
  function groupOp(ctx, st, kind, orig, args) {
    var g = st.grp;
    if (g.tool) return toolOp(ctx, st, kind, orig, args);
    if (g.mode === "native") return orig.apply(ctx, args);
    var style = kind === "stroke" ? ctx.strokeStyle : ctx.fillStyle;
    var c = typeof style === "string" ? classify(style) : null;
    var accent = !!(c && GLOWS[c.cls]);

    if (g.mode === "axis?") {
      // A price box: its fill, maybe an outline (an order's), its words.
      // What it is gets settled when it closes.
      if (kind === "fill" && args.length === 0 && !g.box) {
        g.box = { style: style, cls: c && c.cls, rect: devRect(ctx, st.path) };
        g.held.push(hold(ctx, st, false));
        return;
      }
      if (kind === "stroke" && args.length === 0 && g.box && !g.edge && !g.texts.length) {
        g.edge = { style: style, cls: c && c.cls, accent: accent };
        g.held.push(hold(ctx, st, true));
        return;
      }
      if (kind === "text" && g.box) {
        noteText(ctx, g, args, c);
        g.held.push(holdText(ctx, args));
        return;
      }
      // A mark beside it (the handle of an order being dragged): as it is.
      if (kind === "fill" && args.length === 0 && g.box && !overlaps(devRect(ctx, st.path), g.box.rect)) return orig.apply(ctx, args);
      return goNative(ctx, g, orig, args);
    }

    if (g.mode === "pane?") {
      // Filled in a color first: an order or position tag (its border), or
      // a new order's place button. A dark box first is held back, with
      // what goes in it (its parts, words, icons), until an outline in a
      // color says what it is: a TP/SL button, or with numbers in it, a TP
      // or SL line's own tag. Saying Buy or Sell, it's the place button
      // greyed out. Anything else is put back.
      var first = g.held[0];
      if (kind === "fill" && args.length === 0) {
        if (!first) {
          if (accent) {
            g.mode = "pane"; g.outer = devRect(ctx, st.path); g.outerCls = c.cls; tagColors.add(style);
            g.held.push(hold(ctx, st, false));
            return;
          }
          g.held.push(hold(ctx, st, false));
          return;
        }
        // Its parts: dark, or a see-through tint while hovered.
        if ((!accent || c.a < 0.5) && inside(devRect(ctx, st.path), first.rect)) { g.held.push(hold(ctx, st, false)); return; }
        return goNative(ctx, g, orig, args);
      }
      if (!first) return goNative(ctx, g, orig, args);
      if (kind === "rect") {
        var part = rectOf(ctx, args);
        if (!inside(part, first.rect)) return goNative(ctx, g, orig, args);
        g.held.push({ rect: part, radii: 0, stroke: false, style: ctx.fillStyle });
        return;
      }
      if (kind === "text") {
        if (!g.texts.length && SIDE_WORD.test(String(args[0]))) {
          g.mode = "place"; g.disabled = true; g.outer = first.rect; g.held = [first]; g.icons = [];
          return groupOp(ctx, st, kind, orig, args);
        }
        noteText(ctx, g, args, c);
        g.held.push(holdText(ctx, args));
        return;
      }
      if (kind === "stroke" && args[0] && typeof args[0] === "object") {
        g.icons.push(iconOf(ctx, args[0], c));
        g.held.push(holdPath(ctx, args[0]));
        return;
      }
      if (kind === "fill" && args[0] && typeof args[0] === "object") {
        g.held.push(holdFill(ctx, args));
        return;
      }
      if (kind === "stroke" && args.length === 0 && !accent && !g.edge && inside(devRect(ctx, st.path), first.rect)) {
        g.edge = true; g.held.push(hold(ctx, st, true));
        return;
      }
      if (kind === "stroke" && args.length === 0 && accent) {
        var numbers = g.texts.some(function (t) { return /\d/.test(t.t); });
        if (!numbers && g.texts.some(function (t) { return t.t.trim().length > 4; })) return goNative(ctx, g, orig, args);
        g.mode = numbers ? "bracket" : "button"; g.outer = first.rect; g.strokeCls = c.cls;
        g.held.push(hold(ctx, st, true));
        return;
      }
      return goNative(ctx, g, orig, args);
    }

    if (g.mode === "place") {
      // Greyed out: only its word is redrawn; anything else (a warning
      // icon beside it) is drawn as it is.
      if (kind === "text" && SIDE_WORD.test(String(args[0]))) { noteText(ctx, g, args, c); g.held.push(holdText(ctx, args)); return; }
      return orig.apply(ctx, args);
    }

    // A tag's parts are noted, and held as they'd be drawn, in case it
    // turns out not to be one (a session label, say) and is put back.
    var keep = g.mode === "pane";
    if (kind === "text") {
      var t = String(args[0]);
      if (g.mode === "button") {
        // A button says two or three letters (TP, SL). With numbers, it's a
        // TP or SL line's own tag (its size and P&L); longer, something else.
        if (/\d/.test(t)) g.mode = "bracket";
        else if (t.trim().length > 4) return goNative(ctx, g, orig, args);
        else g.held.push(holdText(ctx, args));
      }
      if (keep) g.held.push(holdText(ctx, args));
      noteText(ctx, g, args, c);
      return;
    }
    if (kind === "stroke" && args[0] && typeof args[0] === "object") {
      g.icons.push(iconOf(ctx, args[0], c));
      if (keep) g.held.push(holdPath(ctx, args[0]));
      return;
    }
    // A filled icon: kept for a fallback; the redrawn tag has its own mark.
    if (kind === "fill" && args[0] && typeof args[0] === "object") {
      if (keep) g.held.push(holdFill(ctx, args));
      return;
    }
    if (keep) {
      if (kind === "rect") g.held.push({ rect: rectOf(ctx, args), radii: 0, stroke: false, style: ctx.fillStyle });
      else if (args.length === 0) g.held.push(hold(ctx, st, kind === "stroke"));
    }
    if (g.mode === "pane" && kind === "fill" && args.length === 0 && !st.path.arcs && accent && c.a >= 0.9 && !g.filled) {
      // The size box filled in the tag's color: a position's. (Hovering a
      // part of a tag shades it in a see-through tint of the same color.)
      g.filled = c.cls; g.filledStyle = style;
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

  var pending = [];        // tags and buttons, drawn by row once the chart is done
  var flushQueued = false;
  function finishGroup(ctx, g) {
    try {
      if (g.tool) return finishTool(ctx, g);
      if (g.mode === "axis?") return finishAxis(ctx, g);
      if (g.mode === "pane?") {
        // A dark box with just an icon in a color: an icon button. With
        // just words (Discard): a plain button, if a tag shares its row.
        var ic = g.held.length && !g.texts.length && g.icons.filter(function (i) { return GLOWS[i.cls]; })[0];
        var words = g.held.length && g.texts.length && !g.icons.length &&
          g.texts.every(function (t) { return !/\d/.test(t.t); }) && g.texts.some(function (t) { return t.t.trim(); });
        if (ic) { g.mode = "button"; g.outer = g.held[0].rect; g.strokeCls = ic.cls; }
        else if (words) { g.mode = "text"; g.outer = g.held[0].rect; }
        else if (isPlus(ctx, g)) { g.mode = "plus"; g.outer = g.held[0].rect; }
        else return replayHeld(ctx, g);
      }
      if (!g.outer || g.mode === "native") return;
      if (g.mode === "button" && !g.texts.length && !g.icons.length) return replayHeld(ctx, g);
      // Kept for the ones that may yet be put back.
      if (g.mode !== "text" && g.mode !== "pane" && g.mode !== "place") g.held = [];
      g.cy = (g.outer.y0 + g.outer.y1) / 2;
      if (g.mode === "pane" && !g.texts.length && isPlus(ctx, g)) g.mode = "plus";
      if (g.mode === "pane" || g.mode === "bracket" || g.mode === "place") {
        g.info = readTag(g);
        // Just Buy or Sell: a new order's place button. Other words and no
        // size (Confirm): an action button. Both stay in TradingView's spot,
        // and are only redrawn beside a tag. A tag has a size or a P&L;
        // anything else is put back.
        if (g.mode === "place" || g.info.place) g.place = true;
        else if (g.info.action) g.action = true;
        else if (g.info.position || g.info.qty) g.isTag = true;
        else return replayHeld(ctx, g);
        if (g.info.position && g.filledStyle) positionColors.add(g.filledStyle);
      }
      pending.push({ ctx: ctx, g: g });
      if (!flushQueued) { flushQueued = true; queueMicrotask(flushPending); }
    } catch (err) {}
  }
  // TradingView's add-order button by the price scale: a small square
  // against the pane's right edge, with a circle and a plus (two thin bars).
  function isPlus(ctx, g) {
    var b = g.held[0] && g.held[0].rect, s = g.s;
    if (!b || g.texts.length) return false;
    var w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < 14 * s || w > 30 * s || Math.abs(w - h) > 4 * s || b.x1 < ctx.canvas.width - 2) return false;
    return g.held.filter(function (it) {
      var r = it.rect;
      return r && !it.stroke && (r.x1 - r.x0 <= 2.5 * s) !== (r.y1 - r.y0 <= 2.5 * s);
    }).length >= 2;
  }
  function flushPending() {
    flushQueued = false;
    var items = pending;
    pending = [];
    while (items.length) {
      var first = items[0], row = [];
      items = items.filter(function (it) {
        if (it.ctx === first.ctx && Math.abs(it.g.cy - first.g.cy) <= 3 * first.g.s) { row.push(it.g); return false; }
        return true;
      });
      try { drawRow(first.ctx, row); } catch (err) {}
    }
  }

  // ---------- Drawing ----------
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgba(h, a) { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(h1, h2, t) {
    var a = rgb(h1), b = rgb(h2), o = [0, 1, 2].map(function (i) { return Math.round(a[i] * (1 - t) + b[i] * t); });
    return "#" + ((1 << 24) | (o[0] << 16) | (o[1] << 8) | o[2]).toString(16).slice(1);
  }
  function hexOf(s) {
    var m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return "#" + m[1].replace(/./g, "$&$&");
    if ((m = /^#([0-9a-f]{6})/i.exec(s))) return "#" + m[1];
    var c = parseColor(s);
    return c ? "#" + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1) : null;
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
  function dot(ctx, cx, cy, r, color) {
    var d = new Path2D(); d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color; origFill.call(ctx, d);
  }
  // A tag's lead mark: its side's arrow, or a TP/SL line's dot.
  function mark(ctx, info, x, cy, w, color) {
    if (info.bracket) dot(ctx, x + w / 2, cy, w * 0.36, color);
    else arrow(ctx, x, cy, w, info.up, color);
  }
  function cross(ctx, cx, cy, size, color, lw) {
    var h = size / 2, p = new Path2D();
    p.moveTo(cx - h, cy - h); p.lineTo(cx + h, cy + h); p.moveTo(cx + h, cy - h); p.lineTo(cx - h, cy + h);
    ctx.strokeStyle = color; ctx.lineWidth = lw; origStroke.call(ctx, p);
  }
  function check(ctx, cx, cy, w, color, lw) {
    var p = new Path2D();
    p.moveTo(cx - w / 2, cy + w * 0.02); p.lineTo(cx - w / 8, cy + w * 0.36); p.lineTo(cx + w / 2, cy - w * 0.34);
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
  // Modern's solid color block, lit from the top. Light colors (Chrome,
  // Mono) take dark words: themeInk().
  function block(ctx, path, x0, x1, y, h, s, c) {
    var gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, mix(c, "#ffffff", 0.22)); gr.addColorStop(0.55, c); gr.addColorStop(1, mix(c, "#000000", 0.25));
    ctx.fillStyle = gr; origFill.call(ctx, path);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = s;
    origStroke.call(ctx, seg(x0, y + 1.1 * s, x1, y + 1.1 * s));
  }
  function themeInk(cls) { return (tagTheme.on && tagTheme.on[cls]) || "#ffffff"; }
  // A tag or button's height: about TradingView's own, so rows close
  // together overlap no more than they do there.
  function tagH(g) { return Math.max(17 * g.s, Math.min(22 * g.s, g.outer.y1 - g.outer.y0 + 2 * g.s)); }

  // What a tag says: side and type, or the size and P&L (a position's, or
  // a TP or SL line's). Just "Buy" or "Sell": a new order's place button.
  function readTag(g) {
    var texts = g.texts.filter(function (t) { return t.t.trim(); }).sort(function (a, b) { return a.x - b.x; });
    var qty = "", qtyX, words = [], wx0 = Infinity, wx1 = -Infinity;
    texts.forEach(function (t) {
      var v = t.t.replace(/[  ]/g, " ").trim();
      // The size comes first; a short's is negative (-3).
      if (!qty && /^[+\-−]?\s*\d[\d.,\s]*$/.test(v)) { qty = v; qtyX = t.cx; return; }
      words.push({ t: v, cls: t.cls, cx: t.cx });
      wx0 = Math.min(wx0, t.cx - t.w / 2); wx1 = Math.max(wx1, t.cx + t.w / 2);
    });
    // A P&L is a number, maybe signed, maybe with its unit (USD, ticks, %).
    var pnl = words.filter(function (w) { return /^[+\-−]?\s*[\d.,\s]*\d[\d.,\s]*\s*[A-Za-z%]{0,6}$/.test(w.t); })[0];
    // Where TradingView put the size and the words: ours go over them, so
    // a click lands on the part it looks like.
    var short = /^[\-−]/.test(qty);
    qty = qty.replace(/^[+\-−]\s*/, "");
    var info = { qty: qty, qtyX: qtyX, wordsX: words.length ? (wx0 + wx1) / 2 : undefined,
      cls: g.filled || g.outerCls || g.strokeCls || "buy" };
    if (pnl || g.mode === "bracket") {
      info.position = true;
      var p = pnl ? pnl.t : "", m = /^(.*?\d)\s*([A-Za-z]+|%)$/.exec(p);
      info.pnl = (m ? m[1] : p).replace(/^([+\-−])\s+/, "$1"); info.ccy = m ? m[2] : "";
      info.pnlCls = pnl && pnl.cls; info.pnlX = pnl && pnl.cx;
      // A TP or SL line's own tag: outlined, or filled in the TP's green
      // or the SL's orange (a position's is in the buy or sell color).
      if (g.mode === "bracket" || info.cls === "profit" || info.cls === "warn") {
        info.bracket = true; info.cls = g.mode === "bracket" ? g.strokeCls || "profit" : info.cls;
        info.side = info.cls === "profit" ? "TP" : "SL";
      } else {
        info.side = info.cls === "sell" || short ? "SHORT" : "LONG";
      }
    } else {
      var label = words.map(function (w) { return w.t; }).join(" ");
      var sm = /^(buy|sell)\b\s*(.*)$/i.exec(label);
      info.side = sm ? sm[1].toUpperCase() : info.cls === "sell" ? "SELL" : "BUY";
      info.type = sm ? sm[2] : label;
      info.type = info.type ? info.type.charAt(0).toUpperCase() + info.type.slice(1).toLowerCase() : "";
      info.place = !!sm && !info.type;
      info.action = !qty && !sm && !!info.type;
      if (g.mode === "place" || (info.place && sm)) info.cls = info.side === "SELL" ? "sell" : "buy";
    }
    info.up = info.side === "BUY" || info.side === "LONG";
    return info;
  }
  // A P&L's color: TradingView's green or red, else its sign's (a TP or
  // SL line's P&L is in the line's color).
  function pnlColor(info) {
    var T = tagTheme;
    if (info.pnlCls === "profit") return T.profit;
    if (info.pnlCls === "sell") return T.sell;
    return /^[\-−]/.test(info.pnl) ? T.sell : /^\+/.test(info.pnl) ? T.profit : "#c9d1e0";
  }

  // A row: its buttons and its tag(s), left to right. A row with a place
  // button is a new order: its tag leaves the side to the button. Tags
  // TradingView stacks (orders at about the same price) stay stacked.
  function drawRow(ctx, row) {
    row.sort(function (a, b) { return a.outer.x0 - b.outer.x0; });
    var frosted = tagTheme.style === "frosted";
    var draft = row.some(function (g) { return g.place; });
    var tagged = row.some(function (g) { return g.isTag || g.place || g.action; });
    pen(ctx);
    try {
      for (var i = 0; i < row.length; i++) {
        var a = row[i], b = row[i + 1];
        if (a.isTag) {
          a.info.draft = draft && !a.info.position;
          // Its room: up to whatever sits wholly to its left on the row.
          var left = a.outer.x0 - 70 * a.s;
          for (var j = 0; j < row.length; j++) {
            var o = row[j];
            if (o !== a && o.outer.x1 <= a.outer.x0 + 2 * a.s) left = Math.max(left, o.outer.x1 + 3 * a.s);
          }
          if (frosted) drawFrostedTag(ctx, a, a.info, left); else drawModernTag(ctx, a, a.info, left);
        } else if (a.mode === "plus") {
          drawPlusButton(ctx, a, frosted);
        } else if (a.place || a.action) {
          if (row.some(function (o) { return o.isTag; })) drawActionButton(ctx, a, frosted); else replayHeld(ctx, a);
        } else if (a.mode === "text") {
          if (tagged) drawTextButton(ctx, a, frosted); else replayHeld(ctx, a);
        } else if (frosted && b && a.mode === "button" && b.mode === "button" && a.texts.length && b.texts.length &&
          b.outer.x0 - a.outer.x1 <= 4 * a.s) {
          drawFrostedPair(ctx, a, b); i++;
        } else if (a.texts.length) {
          drawLabelButton(ctx, a, frosted);
        } else {
          drawIconButton(ctx, a, frosted);
        }
      }
    } finally { origRestore.call(ctx); }
  }

  // A tag's parts measured at one size, and placed. v: [type scale, "QTY"
  // shown, side (2: its words, 1: just the size, 0: just the arrow, -1:
  // none, its color says it), type shown]. The × sits on TradingView's; the body's parts (the size, the
  // order type, the P&L) each sit over TradingView's own, in its order, so
  // a click lands on the part it looks like; the side goes to their left.
  function measure(ctx, g, info, v, frosted, left) {
    var s = g.s, k = v[0] * s;
    var L = { k: k, showQty: !!v[1], H: tagH(g),
      fSide: "700 " + 10.5 * k + "px " + FONT_SIDE, lsSide: 1.05 * k,
      fLabel: "600 " + 11 * k + "px " + FONT_SANS, fMono: "600 " + 10 * k + "px " + FONT_MONO,
      fPnl: "600 " + 12.5 * k + "px " + FONT_MONO, arrowW: 7.5 * k };
    L.type = v[3] ? info.type : "";
    if (info.draft || v[2] < 0) {
      L.sideText = ""; L.sideW = 0; L.stripW = frosted ? 0 : 3 * s;
    } else {
      L.sideText = v[2] === 2 ? (info.position ? info.side + " " + info.qty : info.side) : v[2] === 1 ? info.qty : "";
      L.sideW = 8 * s + L.arrowW + (L.sideText ? 5 * s + tw(ctx, L.sideText, L.fSide, L.lsSide) : 0) + 9 * s;
      L.stripW = 0;
    }
    L.xW = 22 * s;
    L.gap = frosted && !info.position && L.sideW ? 4 * s : 0;
    var items = [];
    if (info.position) {
      items.push({ k: "pnl", cx: info.pnlX,
        w: tw(ctx, info.pnl, L.fPnl) + (info.ccy ? 5 * s + tw(ctx, info.ccy, L.fMono) : 0) });
    } else {
      items.push({ k: "qty", cx: info.qtyX,
        w: (L.showQty ? tw(ctx, "QTY", L.fMono) + 4 * s : 0) + tw(ctx, info.qty, L.fMono) });
      if (L.type) items.push({ k: "type", cx: info.wordsX, w: tw(ctx, L.type, L.fLabel) });
      if (items.every(function (it) { return it.cx !== undefined; })) items.sort(function (a, b) { return a.cx - b.cx; });
    }
    var right = g.outer.x1 - L.xW - 8 * s;
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i], end = it.cx !== undefined ? Math.min(it.cx + it.w / 2, right) : right;
      it.x0 = end - it.w;
      right = it.x0 - 13 * s;
    }
    // Short of room on the left, the first part moves right a little (as
    // far as the next one lets it; it stays over its own part).
    var lead = L.sideW + L.gap + L.stripW + 9 * s, first = items[0];
    var limit = (items[1] ? items[1].x0 - 13 * s : g.outer.x1 - L.xW - 8 * s) - first.w;
    if (first.x0 - lead < left) first.x0 = Math.max(first.x0, Math.min(left + lead, limit));
    L.items = items;
    L.x1 = g.outer.x1;
    L.bodyX = items[0].x0 - 9 * s;
    L.x0 = L.bodyX - L.stripW - L.gap - L.sideW;
    L.W = L.x1 - L.x0;
    return L;
  }
  // Fits a tag in the room it has (buttons sit to its left), giving up
  // words until it fits: first "QTY", then a position's "LONG", then the
  // side's word, then the side, before going smaller, then the type. If
  // nothing fits, the narrowest.
  function layout(ctx, g, info, left, frosted) {
    var best = null;
    var steps = info.position
      ? [[1, 0, 2, 1], [0.9, 0, 2, 1], [1, 0, 1, 1], [0.9, 0, 1, 1], [0.8, 0, 1, 1], [0.72, 0, 1, 1], [0.72, 0, 0, 1]]
      : [[1, 1, 2, 1], [1, 0, 2, 1], [0.9, 0, 2, 1], [1, 0, 0, 1], [0.9, 0, 0, 1],
        [1, 0, -1, 1], [0.9, 0, -1, 1], [0.8, 0, -1, 1], [0.72, 0, -1, 1], [0.72, 0, -1, 0]];
    for (var i = 0; i < steps.length; i++) {
      var L = measure(ctx, g, info, steps[i], frosted, left);
      if (L.x0 >= left) { best = L; break; }
      if (!best || L.x0 > best.x0) best = L;
    }
    best.y = g.cy - best.H / 2;
    return best;
  }
  function bodyText(ctx, L, info, cy, s) {
    var prevEnd = null;
    L.items.forEach(function (it) {
      if (prevEnd !== null) {
        var mid = (prevEnd + it.x0) / 2;
        ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = s;
        origStroke.call(ctx, seg(mid, L.y + 6 * s, mid, L.y + L.H - 6 * s));
      }
      var x = it.x0;
      if (it.k === "pnl") {
        var pc = pnlColor(info);
        origSave.call(ctx); shadow(ctx, rgba(pc, 0.5), 8 * s, 0);
        text(ctx, info.pnl, x, cy, L.fPnl, pc);
        origRestore.call(ctx);
        x += tw(ctx, info.pnl, L.fPnl) + 5 * s;
        if (info.ccy) text(ctx, info.ccy, x, cy, L.fMono, "#8790a5");
      } else if (it.k === "type") {
        text(ctx, L.type, x, cy, L.fLabel, "#eef2fa");
      } else {
        if (L.showQty) { text(ctx, "QTY", x, cy, L.fMono, "#8790a5"); x += tw(ctx, "QTY", L.fMono) + 4 * s; }
        text(ctx, info.qty, x, cy, L.fMono, "#c6ccda");
      }
      prevEnd = it.x0 + it.w;
    });
  }

  function drawModernTag(ctx, g, info, left) {
    var s = g.s, c = tagTheme[info.cls] || tagTheme.buy, ink = themeInk(info.cls);
    var L = layout(ctx, g, info, left, false);
    var x0 = L.x0, y = L.y, H = L.H, R = 6 * s, cy = g.cy;
    var whole = rr(x0, y, L.W, H, R);
    glass(ctx, whole, y, H, s, c);
    if (L.sideW) {
      block(ctx, rr(x0, y, L.sideW, H, [R, 0, 0, R]), x0 + R * 0.7, x0 + L.sideW - 1 * s, y, H, s, c);
    } else if (L.stripW) {
      // No side (a new order's, or no room): a strip of its color instead.
      origSave.call(ctx); ctx.clip(whole); shadow(ctx, c, 6 * s, 0);
      ctx.fillStyle = c; origFill.call(ctx, rr(x0, y, L.stripW, H, 0));
      origRestore.call(ctx);
    }
    edge(ctx, rr(x0 + 0.5 * s, y + 0.5 * s, L.W - s, H - s, R), s);
    ctx.strokeStyle = "rgba(255,255,255,0.09)"; ctx.lineWidth = s;
    origStroke.call(ctx, seg(L.x1 - L.xW, y + 5 * s, L.x1 - L.xW, y + H - 5 * s));
    if (L.sideW) {
      mark(ctx, info, x0 + 8 * s, cy, L.arrowW, ink);
      if (L.sideText) text(ctx, L.sideText, x0 + 8 * s + L.arrowW + 5 * s, cy, L.fSide, ink, L.lsSide);
    }
    bodyText(ctx, L, info, cy, s);
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
    } else if (!L.sideW) {
      var one = rr(x0, y, L.W, H, R);
      frost(ctx, one, x0, y, L.W, H, s, null);
      underline(ctx, x0 + R * 0.8, L.x1 - R * 0.8, yb, s, c, mix(c, "#8b5cf6", 0.55));
    } else {
      var sideP = rr(x0, y, L.sideW, H, R);
      frost(ctx, sideP, x0, y, L.sideW, H, s, c);
      underline(ctx, x0 + R * 0.8, x0 + L.sideW - R * 0.8, yb, s, c);
      var bx = L.bodyX, bw = L.x1 - bx, bodyP = rr(bx, y, bw, H, R);
      frost(ctx, bodyP, bx, y, bw, H, s, null);
      underline(ctx, bx + R * 0.8, bx + bw - R * 0.8, yb, s, c, mix(c, "#8b5cf6", 0.55));
    }
    if (L.sideW) {
      mark(ctx, info, x0 + 9 * s, cy, L.arrowW, light);
      if (L.sideText) text(ctx, L.sideText, x0 + 9 * s + L.arrowW + 5 * s, cy, L.fSide, light, L.lsSide);
    }
    bodyText(ctx, L, info, cy, s);
    cross(ctx, L.x1 - L.xW / 2 - 2 * s, cy, 6.5 * s, "#aeb5c4", 1.5 * s);
  }

  // A button TradingView fills in a color: a new order's place button (its
  // side) or another action (Confirm), with a check mark; greyed out while
  // TradingView has it so. It stays inside TradingView's own button, so a
  // click lands on it and nothing else: it gives up its arrow, then
  // shrinks, then gives up the check mark, to fit.
  function drawActionButton(ctx, g, frosted) {
    var s = g.s, info = g.info, off = !!g.disabled, c = tagTheme[info.cls] || tagTheme.buy;
    var H = tagH(g), y = g.cy - H / 2, x0 = g.outer.x0, x1 = g.outer.x1, W = x1 - x0;
    var word = g.place ? info.side : info.type;
    // [type size, arrow, check ring size, side padding, check shown]
    var steps = [[10.5, 1, 15, 7.5, 1], [10.5, 0, 15, 7.5, 1], [10, 0, 13, 6, 1], [9.5, 0, 0, 5, 1],
      [9, 0, 0, 4, 1], [8.5, 0, 0, 3, 1], [9, 0, 0, 4, 0], [8, 0, 0, 3, 0]], L;
    for (var i = 0; i < steps.length; i++) {
      var v = steps[i];
      L = { f: (g.place ? "700 " : "600 ") + v[0] * s + "px " + (g.place ? FONT_SIDE : FONT_SANS),
        ls: g.place ? v[0] / 10 * s : 0, arrow: g.place && !!v[1], ring: v[2] * s, pad: v[3] * s, check: !!v[4] };
      L.word = tw(ctx, word, L.f, L.ls);
      L.ck = L.check ? L.ring || 9 * s : 0;
      L.gap = L.check ? (L.ring ? 5 : 4.5) * s : 0;
      L.content = (L.arrow ? 12.5 * s : 0) + L.word + L.gap + L.ck;
      if (L.content + 2 * L.pad <= W) break;
    }
    var p = rr(x0, y, W, H, frosted ? H / 2 : 6 * s), ink;
    if (frosted) {
      frost(ctx, p, x0, y, W, H, s, off ? null : c);
      underline(ctx, x0 + H * 0.4, x1 - H * 0.4, y + H - 1.3 * s, s, off ? "#5d6576" : c);
      ink = off ? "#8790a5" : mix(c, "#ffffff", 0.62);
    } else if (off) {
      glass(ctx, p, y, H, s, null); edge(ctx, p, s);
      ink = "#7d8596";
    } else {
      origSave.call(ctx); shadow(ctx, rgba(c, 0.45), 12 * s, 0); ctx.fillStyle = c; origFill.call(ctx, p); origRestore.call(ctx);
      block(ctx, p, x0 + 4 * s, x1 - 4 * s, y, H, s, c);
      ink = themeInk(info.cls);
    }
    origSave.call(ctx); ctx.clip(p);
    var x = x0 + Math.max(0, (W - L.content) / 2);
    if (L.arrow) { arrow(ctx, x, g.cy, 7.5 * s, info.up, ink); x += 12.5 * s; }
    text(ctx, word, x, g.cy, L.f, ink, L.ls);
    if (L.check) {
      x += L.word + L.gap + L.ck / 2;
      if (L.ring) dot(ctx, x, g.cy, L.ring / 2, rgba(hexOf(ink) || "#ffffff", 0.18));
      check(ctx, x, g.cy, (L.ring ? 7.5 : 8.5) * s, ink, 1.7 * s);
    }
    origRestore.call(ctx);
  }
  // A plain button beside a tag (Discard): its words, in TradingView's spot.
  function drawTextButton(ctx, g, frosted) {
    var s = g.s, ins = frosted ? 0 : inset(g), x0 = g.outer.x0 + ins, x1 = g.outer.x1 - ins, W = x1 - x0;
    var H = tagH(g), y = g.cy - H / 2, px = 11, f;
    var word = g.texts.slice().sort(function (a, b) { return a.x - b.x; })
      .map(function (t) { return t.t.trim(); }).filter(Boolean).join(" ");
    do { f = "600 " + px * s + "px " + FONT_SANS; px -= 0.5; } while (px > 8 && tw(ctx, word, f) > W - 8 * s);
    var p = rr(x0, y, W, H, frosted ? H / 2 : 6 * s);
    if (frosted) frost(ctx, p, x0, y, W, H, s, null);
    else { glass(ctx, p, y, H, s, null); edge(ctx, p, s); }
    origSave.call(ctx); ctx.clip(p);
    ctx.textAlign = "center";
    text(ctx, word, (x0 + x1) / 2, g.cy, f, "#c6ccda");
    ctx.textAlign = "left";
    origRestore.call(ctx);
  }
  function btnFont(s) { return "700 " + 10 * s + "px " + FONT_SIDE; }
  // Modern's buttons sit a little in from TradingView's edges, so ones side
  // by side (TP, SL) have room between them.
  function inset(g) { var W = g.outer.x1 - g.outer.x0; return Math.min(1.5 * g.s, Math.max(0, (W - 20 * g.s) / 2)); }
  function drawLabelButton(ctx, g, frosted) {
    var s = g.s, c = tagTheme[g.strokeCls] || tagTheme.profit, label = g.texts[0].t.trim().toUpperCase();
    var H = tagH(g), f = btnFont(s), d = frosted ? 0 : 5 * s, pad = 5 * s, ins = frosted ? 0 : inset(g);
    var x0 = g.outer.x0 + ins, x1 = g.outer.x1 - ins, W = x1 - x0, y = g.cy - H / 2;
    var need = 2 * pad + d + (d ? 3.5 * s : 0) + tw(ctx, label, f, 0.8 * s);
    if (need > W) { f = "700 " + 9 * s + "px " + FONT_SIDE; need = 2 * pad + d + (d ? 3.5 * s : 0) + tw(ctx, label, f, 0.6 * s); }
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
    dot(ctx, cx + d / 2, g.cy, d / 2, c);
    origRestore.call(ctx);
    text(ctx, label, cx + d + 3.5 * s, g.cy, f, "#eef2fa", 0.6 * s);
  }
  function drawFrostedPair(ctx, a, b) {
    var s = a.s, H = tagH(a), f = btnFont(s), y = a.cy - H / 2;
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
    var s = g.s, H = tagH(g), ins = frosted ? 0 : inset(g), x0 = g.outer.x0 + ins, W = g.outer.x1 - ins - x0, y = g.cy - H / 2;
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

  // The add-order button by the price scale, in the tags' look: a glass
  // square (Modern) or a frosted ring (Frosted Glass), its plus glowing in
  // the buy color.
  function drawPlusButton(ctx, g, frosted) {
    var s = g.s, b = g.outer, c = tagTheme.buy, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    var size = Math.min(b.x1 - b.x0, b.y1 - b.y0), arm = size * 0.22, ink;
    if (frosted) {
      var r = size / 2 - 0.5 * s, p = new Path2D();
      p.arc(cx, cy, r, 0, Math.PI * 2);
      frost(ctx, p, cx - r, cy - r, 2 * r, 2 * r, s, c);
      origSave.call(ctx); shadow(ctx, c, 8 * s, 0);
      ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = 1.4 * s; origStroke.call(ctx, p);
      origRestore.call(ctx);
      ink = mix(c, "#ffffff", 0.62);
    } else {
      var pm = rr(b.x0 + 1 * s, b.y0 + 1 * s, b.x1 - b.x0 - 2 * s, b.y1 - b.y0 - 2 * s, 6 * s);
      glass(ctx, pm, b.y0, b.y1 - b.y0, s, c); edge(ctx, pm, s);
      ink = c;
    }
    var plus = new Path2D();
    plus.moveTo(cx - arm, cy); plus.lineTo(cx + arm, cy); plus.moveTo(cx, cy - arm); plus.lineTo(cx, cy + arm);
    origSave.call(ctx); shadow(ctx, rgba(c, 0.8), 6 * s, 0);
    ctx.strokeStyle = ink; ctx.lineWidth = 1.8 * s; ctx.lineCap = "round"; origStroke.call(ctx, plus);
    origRestore.call(ctx);
  }

  // ---------- The price scale ----------
  // An order's box (outlined in its color, TP and SL too), the position's
  // (filled in a position's color, unless the live price line has it), or
  // any other price box (the live price, an indicator's, a drawing's, the
  // crosshair's).
  function finishAxis(ctx, g) {
    if (!g.box || !g.texts.length) return replayHeld(ctx, g);
    var r = g.box.rect, cy = (r.y0 + r.y1) / 2, cls = null;
    if (g.edge && g.edge.accent) cls = g.edge.cls;
    else if (g.box.cls && GLOWS[g.box.cls] && positionColors.has(g.box.style) && !priceLineColors.has(g.box.style)) cls = g.box.cls;
    g.held = [];
    drawAxisBox(ctx, g, cls);
  }
  // A price box's own color, for its accent: its fill unless that's
  // black or white, then its outline, then its words.
  function labelColor(g) {
    var list = [g.box.style, g.edge && g.edge.style, g.texts[0].style];
    for (var i = 0; i < list.length; i++) {
      var c = typeof list[i] === "string" && classify(list[i]);
      if (c && c.cls !== "dark" && c.cls !== "light" && c.a > 0.3) return hexOf(list[i]);
    }
    return null;
  }
  // Its words, top to bottom (a price, and below it the time to the bar's
  // close, say), each shrunk to fit.
  function axisTexts(ctx, texts, xa, xb, cy, s, ink, align) {
    var room = xb - xa - 4 * s;
    ctx.textAlign = align;
    texts.forEach(function (t, i) {
      var v = t.t.replace(/[  ]/g, " ").trim();
      var face = /^[\d\s.,:'+\-−%]+[A-Za-z]{0,2}$/.test(v) ? FONT_MONO : FONT_SANS;
      var px = i ? Math.min(10, t.size / s * 0.92) : 11, f;
      do { f = "600 " + px * s + "px " + face; px -= 0.5; } while (px > 7 && tw(ctx, v, f) > room);
      text(ctx, v, align === "center" ? (xa + xb) / 2 : xa, (texts.length > 1 ? t.y : cy) + 0.5 * s, f, i ? "#aab2c3" : ink);
    });
    ctx.textAlign = "left";
  }
  function drawAxisBox(ctx, g, cls) {
    var s = g.s, r = g.box.rect, order = !!cls;
    var c = order ? tagTheme[cls] || tagTheme.buy : labelColor(g);
    var texts = g.texts.filter(function (t) { return t.t.trim(); }).sort(function (a, b) { return a.y - b.y; });
    var H = Math.max(r.y1 - r.y0 + 2 * s, 18 * s), cy = (r.y0 + r.y1) / 2, y = cy - H / 2;
    var x0 = r.x0 + 1 * s, W = r.x1 - x0;
    pen(ctx);
    try {
      if (tagTheme.style === "frosted") {
        var p = rr(x0, y, W, H, Math.min(H / 2, 10 * s)), ink = "#ffffff";
        if (order) {
          // An order's: a glowing pill in its color.
          origSave.call(ctx); shadow(ctx, rgba(c, 0.6), 12 * s, 0); ctx.fillStyle = c; origFill.call(ctx, p); origRestore.call(ctx);
          var gr = ctx.createLinearGradient(0, y, 0, y + H);
          gr.addColorStop(0, mix(c, "#ffffff", 0.28)); gr.addColorStop(0.55, c); gr.addColorStop(1, mix(c, "#000000", 0.2));
          ctx.fillStyle = gr; origFill.call(ctx, p);
          ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = s;
          origStroke.call(ctx, seg(x0 + H * 0.45, y + 1.2 * s, x0 + W - H * 0.45, y + 1.2 * s));
          ink = themeInk(cls);
        } else {
          // Any other: smoked glass tinted in its own color.
          ctx.fillStyle = "rgba(13,16,23,0.88)"; origFill.call(ctx, p);
          if (c) { ctx.fillStyle = rgba(c, 0.3); origFill.call(ctx, p); }
          var sh = ctx.createLinearGradient(0, y, 0, y + H);
          sh.addColorStop(0, "rgba(255,255,255,0.14)"); sh.addColorStop(0.6, "rgba(255,255,255,0.02)"); sh.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = sh; origFill.call(ctx, p);
          ctx.strokeStyle = c ? rgba(c, 0.65) : "rgba(255,255,255,0.22)"; ctx.lineWidth = s;
          origStroke.call(ctx, rr(x0 + 0.5 * s, y + 0.5 * s, W - s, H - s, Math.min(H / 2, 10 * s)));
        }
        axisTexts(ctx, texts, x0, x0 + W, cy, s, ink, "center");
        return;
      }
      var pm = rr(x0, y, W, H, 6 * s);
      glass(ctx, pm, y, H, s, null); edge(ctx, pm, s);
      var price = texts[0].t.replace(/[  ]/g, " ").trim(), px = 11, f, withDot = false;
      if (order) {
        // An order's: a glowing dot in its color before the price (a bar
        // instead when the price needs the room).
        do {
          f = "600 " + px * s + "px " + FONT_MONO;
          withDot = tw(ctx, price, f) + 18 * s <= W;
          px -= 0.5;
        } while (px > 8.5 && !withDot);
        if (withDot) {
          origSave.call(ctx); shadow(ctx, c, 6 * s, 0); dot(ctx, x0 + 7 * s, cy, 3 * s, c); origRestore.call(ctx);
          text(ctx, price, x0 + 13 * s, cy, f, "#eef2fa");
          return;
        }
      }
      // Any other (or an order short of room): a bar in its own color.
      var lead = 0;
      if (c) {
        origSave.call(ctx); shadow(ctx, rgba(c, 0.8), 5 * s, 0);
        ctx.fillStyle = c; origFill.call(ctx, rr(x0 + 2.5 * s, y + 4 * s, 2.5 * s, H - 8 * s, 1.25 * s));
        origRestore.call(ctx);
        lead = 5 * s;
      }
      axisTexts(ctx, texts, x0 + lead, x0 + W, cy, s, "#eef2fa", "center");
    } finally { origRestore.call(ctx); }
  }

  // ---------- Long/Short Position tool ----------
  // TradingView draws the tool as one group: its stop zone, the part the
  // price has run through so far, its target zone (see-through boxes, the
  // two zones sharing the entry line), then the arrow, the entry, stop and
  // target lines, and (selected, or with its stats shown) its labels and
  // handles. Two boxes like that are only taken for the tool once its
  // arrow or entry line follows (an indicator's stacked boxes have
  // neither), and are otherwise drawn as they were. With a position theme
  // on (data-ez-pos) the tool is drawn in it: a rounded frame glowing in
  // the theme's color, the target lit in it, the stop a dark tint of it, a
  // dashed entry line, and pill labels: the target's filled in the color,
  // the entry's dark with a glowing edge, the stop's dim. The arrow fades;
  // the handles stay TradingView's.
  function posZone(ctx, w, h) {
    if (Math.abs(w) < 3 || Math.abs(h) < 3) return false;
    var c = typeof ctx.fillStyle === "string" ? classify(ctx.fillStyle) : null;
    return !!(c && c.a < 0.75);
  }
  function beginTool(ctx, st) {
    st.tagDepth = Math.max(1, st.depth - 2); st.tagCls = null; st.tinted = false;
    st.grp = { tool: true, mode: "tool?", s: Math.abs(ctx.getTransform().a) || 1, rects: [], labels: [] };
  }
  function sameZoneSide(a, b) {
    return Math.abs(a.x0 - b.x0) <= 1.5 && Math.abs(a.x1 - b.x1) <= 1.5 &&
      (Math.abs(a.y1 - b.y0) <= 1.5 || Math.abs(b.y1 - a.y0) <= 1.5);
  }
  function replayRects(ctx, g) {
    g.rects.forEach(function (h) {
      origSave.call(ctx);
      ctx.setTransform(h.m); ctx.fillStyle = h.style; ctx.globalAlpha = h.alpha;
      fillRect.apply(ctx, h.args);
      origRestore.call(ctx);
    });
    g.rects = [];
  }
  // Not a position tool after all: draw what was held and close the group
  // right away, so it can't swallow a real tool drawn after it.
  function giveUp(ctx, st, g, orig, args) {
    replayRects(ctx, g);
    g.mode = "native";
    endTool(st);
    return orig.apply(ctx, args);
  }
  function endTool(st) {
    if (st.grp && st.grp.tool) { st.tagDepth = -1; st.tagCls = null; st.tinted = false; st.grp = null; }
  }
  function toolOp(ctx, st, kind, orig, args) {
    var g = st.grp, p = st.path, d;
    if (g.mode === "native") return orig.apply(ctx, args);
    if (g.mode === "tool?") {
      // Boxes, until two of them make the zones.
      if (kind !== "rect") return giveUp(ctx, st, g, orig, args);
      var r = rectOf(ctx, args);
      g.rects.push({ rect: r, m: ctx.getTransform(), style: ctx.fillStyle, alpha: ctx.globalAlpha, args: [].slice.call(args) });
      for (var i = 0; i < g.rects.length - 1; i++) {
        if (sameZoneSide(g.rects[i].rect, r)) {
          // The stop zone comes first, the target zone after it.
          var S = g.rects[i].rect;
          g.stop = S; g.target = r;
          g.up = r.y1 <= S.y0 + 1.5;              // target above: a long
          g.entry = g.up ? r.y1 : r.y0;
          g.frame = { x0: Math.min(S.x0, r.x0), x1: Math.max(S.x1, r.x1), y0: Math.min(S.y0, r.y0), y1: Math.max(S.y1, r.y1) };
          g.mode = "tool!";
          return;
        }
      }
      if (g.rects.length > 12) { replayRects(ctx, g); g.mode = "native"; endTool(st); }
      return;
    }
    var box = g.frame;
    if (g.mode === "tool!") {
      // The zones: the tool's, if its arrow or entry line comes next.
      if (kind === "rect") {
        var pr = rectOf(ctx, args);
        if (!inside(pr, box)) return giveUp(ctx, st, g, orig, args);
        g.rects.push({ rect: pr, m: ctx.getTransform(), style: ctx.fillStyle, alpha: ctx.globalAlpha, args: [].slice.call(args) });
        return;
      }
      if (kind !== "stroke" || args.length) return giveUp(ctx, st, g, orig, args);
      // Before the price reaches the entry, the arrow is an empty path.
      if (!p.n) return orig.apply(ctx, args);
      d = devRect(ctx, p);
      var level = d.y1 - d.y0 < 2 && Math.abs((d.y0 + d.y1) / 2 - g.entry) <= 2 * g.s && d.x1 - d.x0 >= (box.x1 - box.x0) * 0.9;
      // The arrow's head is a fixed size, so it can poke out of the box: on
      // a narrow (zoomed out) tool, or with the price at the box's edge.
      var pad = 12 * g.s, near = { x0: box.x0 - pad, x1: box.x1 + pad, y0: box.y0 - pad, y1: box.y1 + pad };
      var arrowLine = (p.slant > 0 || (d.x1 - d.x0 < pad && d.y1 - d.y0 < pad)) && inside(d, near) &&
        d.x1 >= box.x0 - 1 && d.x0 <= box.x1 + 1 && d.y1 >= box.y0 - 1 && d.y0 <= box.y1 + 1;
      if (!level && !arrowLine) return giveUp(ctx, st, g, orig, args);
      // Boxes held from before the zones that aren't the tool's: drawn as they were.
      var others = g.rects.filter(function (h) { return h.rect !== g.stop && h.rect !== g.target; });
      g.rects = others.filter(function (h) { return !inside(h.rect, box); });
      replayRects(ctx, g);
      g.extra = others.filter(function (h) { return inside(h.rect, box); }).map(function (h) { return h.rect; });
      g.mode = "tool";
      drawZones(ctx, g);
    }
    // The tool: its lines and labels are noted for the end; the rest drawn.
    if (kind === "rect") {
      var rr0 = rectOf(ctx, args);
      if (inside(rr0, box)) { drawProgress(ctx, g, rr0); return; }
      return orig.apply(ctx, args);
    }
    if (kind === "stroke" && args.length === 0) {
      d = devRect(ctx, p);
      // A zone's edge or the entry line.
      if (d.y1 - d.y0 < 2 && d.x0 >= box.x0 - 2 && d.x1 <= box.x1 + 2 && d.x1 - d.x0 >= (box.x1 - box.x0) * 0.6) return;
      // A label's outline.
      var last = g.labels[g.labels.length - 1];
      if (last && p.arcs >= 2 && Math.abs(d.x0 - last.rect.x0) < 3 && Math.abs(d.x1 - last.rect.x1) < 3) return;
      // The arrow: faint, in the theme.
      if (p.slant && !p.arcs && !p.circle) {
        origSave.call(ctx); ctx.strokeStyle = rgba(posTheme.c2, 0.3);
        try { return orig.apply(ctx, args); } finally { origRestore.call(ctx); }
      }
      return orig.apply(ctx, args);
    }
    if (kind === "fill" && args.length === 0 && p.arcs >= 2) {
      var lr = devRect(ctx, p);
      if (lr.y1 - lr.y0 >= 10 * g.s && lr.y1 - lr.y0 <= 90 * g.s && lr.x1 - lr.x0 >= 16 * g.s) {
        g.labels.push({ rect: lr, texts: [] });
        return;
      }
    }
    if (kind === "text" && g.labels.length) {
      var lb = g.labels[g.labels.length - 1], m = ctx.getTransform(), tx = +args[1] || 0, ty = +args[2] || 0;
      var X = m.a * tx + m.c * ty + m.e, Y = m.b * tx + m.d * ty + m.f;
      if (X >= lb.rect.x0 - 2 && X <= lb.rect.x1 + 2 && Y >= lb.rect.y0 - 2 && Y <= lb.rect.y1 + 2) {
        var px = /([\d.]+)px/.exec(ctx.font);
        lb.texts.push({ t: String(args[0]), y: Y, size: (px ? +px[1] : 12) * (Math.abs(m.a) || 1) });
        return;
      }
    }
    return orig.apply(ctx, args);
  }
  function toolPath(g) {
    var f = g.frame, s = g.s;
    return rr(f.x0 + 0.5 * s, f.y0 + 0.5 * s, f.x1 - f.x0 - s, f.y1 - f.y0 - s, 8 * s);
  }
  function drawZones(ctx, g) {
    var T = posTheme, P = g.target, S = g.stop, a = T.a || 0.3;
    pen(ctx);
    try {
      ctx.clip(toolPath(g));
      // The target, lit in the theme's color.
      var gt = ctx.createLinearGradient(0, g.up ? P.y0 : P.y1, 0, g.entry);
      gt.addColorStop(0, rgba(T.c, a * 1.15)); gt.addColorStop(1, rgba(T.c, a * 0.8));
      ctx.fillStyle = gt; fillRect.call(ctx, P.x0, P.y0, P.x1 - P.x0, P.y1 - P.y0);
      // The stop, a dark tint of it.
      ctx.fillStyle = rgba(mix(T.c, "#05070c", 0.82), 0.62);
      fillRect.call(ctx, S.x0, S.y0, S.x1 - S.x0, S.y1 - S.y0);
      g.extra.forEach(function (r) { drawProgress(ctx, g, r, true); });
    } finally { origRestore.call(ctx); }
  }
  // The part the price has run through: a faint wash.
  function drawProgress(ctx, g, r, inPen) {
    if (!inPen) { pen(ctx); ctx.clip(toolPath(g)); }
    try {
      ctx.fillStyle = rgba(posTheme.c2, 0.07);
      fillRect.call(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    } finally { if (!inPen) origRestore.call(ctx); }
  }
  // A four-pointed star, for Starry Space's corners.
  function glint(ctx, x, y, r, color) {
    var p = new Path2D(), k = r * 0.18;
    p.moveTo(x, y - r); p.lineTo(x + k, y - k); p.lineTo(x + r, y); p.lineTo(x + k, y + k);
    p.lineTo(x, y + r); p.lineTo(x - k, y + k); p.lineTo(x - r, y); p.lineTo(x - k, y - k); p.closePath();
    ctx.fillStyle = color; origFill.call(ctx, p);
  }
  function finishTool(ctx, g) {
    if (g.mode === "tool?" || g.mode === "tool!") return replayRects(ctx, g);
    if (g.mode !== "tool") return;
    var T = posTheme, s = g.s, f = g.frame;
    pen(ctx);
    try {
      origSave.call(ctx); shadow(ctx, rgba(T.c, 0.85), 12 * s, 0);
      ctx.strokeStyle = T.c; ctx.lineWidth = 1.5 * s; origStroke.call(ctx, toolPath(g));
      origRestore.call(ctx);
      // The entry line: dashed.
      ctx.setLineDash([4 * s, 3 * s]); ctx.lineCap = "butt";
      ctx.strokeStyle = rgba(T.c2, 0.9); ctx.lineWidth = 1.2 * s;
      origStroke.call(ctx, seg(f.x0 + 1.5 * s, g.entry, f.x1 - 1.5 * s, g.entry));
      ctx.setLineDash([]);
      if (T.glint) {
        origSave.call(ctx); shadow(ctx, T.c2, 8 * s, 0);
        [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1]].forEach(function (pt) { glint(ctx, pt[0], pt[1], 5 * s, "#ffffff"); });
        origRestore.call(ctx);
      }
      g.labels.forEach(function (lb) { drawToolLabel(ctx, g, lb); });
    } finally { origRestore.call(ctx); }
  }
  function lightHex(h) { var c = rgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.62; }
  // A label as a pill, by where it sits: on the target's edge, filled in
  // the theme's color; on the entry line, dark with a glowing edge; on the
  // stop's edge, dim.
  function drawToolLabel(ctx, g, lb) {
    var T = posTheme, s = g.s, r = lb.rect, texts = lb.texts.filter(function (t) { return t.t.trim(); });
    if (!texts.length) return;
    var cy = (r.y0 + r.y1) / 2, targetEdge = g.up ? g.target.y0 : g.target.y1, stopEdge = g.up ? g.stop.y1 : g.stop.y0;
    var dT = Math.abs(cy - targetEdge), dE = Math.abs(cy - g.entry), dS = Math.abs(cy - stopEdge);
    var kind = dT <= dE && dT <= dS ? "target" : dE <= dS ? "entry" : "stop";
    var H = Math.max(r.y1 - r.y0, 20 * s), y = cy - H / 2;
    var fonts = texts.map(function (t) { return "600 " + Math.min(12 * s, t.size) + "px " + FONT_SANS; });
    var wMax = 0;
    texts.forEach(function (t, i) { wMax = Math.max(wMax, tw(ctx, t.t.trim(), fonts[i])); });
    var W = Math.max(r.x1 - r.x0, wMax + 22 * s), cx = (r.x0 + r.x1) / 2, x0 = cx - W / 2;
    var p = rr(x0, y, W, H, Math.min(H / 2, 9 * s)), ink = "#ffffff", sub = mix(T.c2, "#ffffff", 0.4);
    if (kind === "target") {
      origSave.call(ctx); shadow(ctx, rgba(T.c, 0.75), 12 * s, 0); ctx.fillStyle = T.c; origFill.call(ctx, p); origRestore.call(ctx);
      var gr = ctx.createLinearGradient(0, y, 0, y + H);
      gr.addColorStop(0, mix(T.c, "#ffffff", 0.4)); gr.addColorStop(0.5, T.c); gr.addColorStop(1, mix(T.c, "#000000", 0.22));
      ctx.fillStyle = gr; origFill.call(ctx, p);
      ctx.strokeStyle = rgba(mix(T.c2, "#ffffff", 0.3), 0.9); ctx.lineWidth = s; origStroke.call(ctx, p);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      origStroke.call(ctx, seg(x0 + Math.min(H / 2, 9 * s), y + 1.3 * s, x0 + W - Math.min(H / 2, 9 * s), y + 1.3 * s));
      if (lightHex(T.c)) { ink = "#14171f"; sub = "#2a2f3a"; }
    } else if (kind === "entry") {
      origSave.call(ctx); shadow(ctx, rgba(T.c, 0.6), 10 * s, 0); ctx.fillStyle = "rgba(6,8,12,0.94)"; origFill.call(ctx, p); origRestore.call(ctx);
      ctx.strokeStyle = T.c; ctx.lineWidth = 1.4 * s; origStroke.call(ctx, p);
    } else {
      ctx.fillStyle = "rgba(14,16,22,0.88)"; origFill.call(ctx, p);
      ctx.strokeStyle = rgba(T.c, 0.35); ctx.lineWidth = s; origStroke.call(ctx, p);
      ink = "#9aa3b5"; sub = "#7d8596";
    }
    ctx.textAlign = "center";
    texts.forEach(function (t, i) {
      text(ctx, t.t.trim(), cx, texts.length > 1 ? t.y : cy + 0.5 * s, fonts[i], i ? sub : ink);
    });
    ctx.textAlign = "left";
  }

  function syncTags() {
    var root = rootEl();
    var raw = root && root.getAttribute("data-ez-tags");
    var next = null;
    if (raw) { try { next = JSON.parse(raw); } catch (err) { next = null; } }
    tagTheme = next && next.buy ? next : null;
    var rawPos = root && root.getAttribute("data-ez-pos"), pos = null;
    if (rawPos) { try { pos = JSON.parse(rawPos); } catch (err) { pos = null; } }
    posTheme = pos && pos.c ? pos : null;
  }
  watch();

  proto.fillRect = function (x, y, w, h) {
    if (document !== watchedDoc) watch();
    var tst = tracking(this) && stateOf(this);
    // A see-through box on a pane: maybe a Long/Short Position tool's zone.
    if (tst && posTheme && tst.tagDepth < 0 && !tst.axis && tst.depth >= 2 && posZone(this, w, h)) beginTool(this, tst);
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
