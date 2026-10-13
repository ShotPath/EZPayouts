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
// It reads nothing else from the page and changes nothing while off.
(function () {
  if (window.__ezSkinHook) return;
  window.__ezSkinHook = true;

  var root = document.documentElement;
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
          if (!lastBg) { lastBg = best; root.setAttribute("data-ez-chart-bg", best); }
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
    var next = root.getAttribute("data-ez-skin") === "on";
    if (next === on) return;
    on = next;
    applyNow();
  }
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-ez-skin"] });

  proto.fillRect = function (x, y, w, h) {
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
              root.setAttribute("data-ez-chart-bg", fs);
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
