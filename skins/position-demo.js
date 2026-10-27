// The Long Position showcase on the Chart Skins page (#pro): a real chart
// (candles traced from a TradingView screenshot, in its pixel space: x, high,
// low, open, close; smaller y is a higher price) with a long position drawn the
// way the extension themes it (content/page-hook.js: drawZones, finishTool,
// drawToolLabel), over the wallpaper each theme pairs with.
(function () {
  "use strict";
  var stage = document.getElementById("posStage");
  if (!stage) return;
  var bgCanvas = document.getElementById("posBg");
  var chartCanvas = document.getElementById("posChart");
  var chipsEl = document.getElementById("posChips");

  var CANDLES = [
    [1.5,392,413,401,401],[7,394,424,402,402],[13,392,443,401,441],[19,421,449,440,437],[25,433,461,435,447],[31,447,472,447,457],[37,451,472,457,453],[43,450,485,453,476],
    [49,476,508,476,501],[55,499,540,499,529],[61,526,558,526,549],[67,541,566,549,563],[73,551,575,563,573],[79,544,585,576,559],[85,553,583,558,582],[91,553,585,582,573],
    [97,556,588,573,561],[103,554,572,560,560],[111.5,523,563,562,547],[120,538,560,550,559],[126,544,563,557,557],[132,547,566,558,549],[138,503,551,550,531],[144,502,549,533,504],
    [150,467,505,505,492],[156,491,537,492,527],[162,527,566,528,551],[168,543,586,551,582],[174,555,596,586,560],[180,525,554,554,536],[186,521,549,539,525],[192,524,557,524,542],
    [198,515,558,546,516],[204,513,544,515,544],[210,521,545,544,526],[216,526,538,528,526],[224.5,525,548,526,547],[233,539,568,547,567],[239,548,569,569,551],[245,550,576,550,566],
    [251,558,569,565,558],[257,557,589,559,589],[263,576,602,587,590],[269,589,617,591,597],[275,575,601,596,576],[281,570,602,575,602],[287,580,611,604,583],[293,583,615,584,604],
    [299,588,610,606,592],[305,588,608,590,602],[311,589,619,601,589],[317,587,640,591,630],[323,617,642,630,637],[329,615,650,638,615],[335,578,621,616,596],[343.5,589,627,595,625],
    [352,623,650,625,636],[358,635,692,637,692],[364,665,693,691,685],[370,618,688,685,620],[376,615,649,622,649],[382,631,656,649,641],[388,596,647,642,609],[394,609,660,612,660],
    [400,625,660,660,633],[406,620,653,635,622],[412,602,621,621,608],[418,606,625,607,625],[424,619,631,625,630],[430,631,651,631,640],[436,618,644,640,618],[442,603,625,618,612],
    [448,594,614,612,609],[454,606,618,608,609],[462.5,574,613,609,591],[471,567,608,596,572],[477,567,585,571,580],[483,560,580,580,576],[489,571,594,576,590],[495,589,611,589,600],
    [501,587,607,597,597],[507,584,608,596,602],[513,589,608,605,597],[519,596,627,599,616],[525,605,631,614,631],[531,586,634,631,610],[537,582,619,613,597],[543,578,601,596,599],
    [549,593,620,597,597],[555,593,613,600,607],[561,603,625,604,615],[567,591,612,612,598],[575.5,592,610,595,608],[584,595,609,607,607],[590,606,615,608,612],[596,564,615,612,581],
    [602,571,587,580,578],[608,569,593,579,570],[614,547,571,568,551],[620,551,580,552,573],[626,561,598,572,597],[632,579,599,599,590],[638,586,603,589,587],[644,586,607,590,602],
    [650,600,627,600,625],[656,623,640,627,628],[662,612,636,628,618],[668,615,628,619,619],[674,583,679,617,587],[680,551,590,582,580],[686,547,591,578,559],[694.5,440,561,560,440],
    [703,403,456,442,418],[709,419,485,419,469],[715,448,505,470,481],[721,463,493,483,477],[727,473,513,478,482],[733,438,498,479,448],[739,398,447,447,399],[745,366,417,401,401],
    [751,372,412,400,398],[757,387,421,397,421],[763,399,433,421,409],[769,401,443,411,434],[775,405,439,433,414],[781,388,420,415,390],[787,369,390,389,373],[793,340,391,377,346],
    [799,346,381,346,368],[805,309,367,367,324],[813.5,301,331,326,315],[822,298,327,317,317],[828,314,379,324,376],[834,375,457,376,441],[840,406,451,444,426],[846,406,430,427,409],
    [852,379,412,410,411],[858,413,465,414,458],[864,443,465,458,452],[870,421,453,453,433],[876,422,489,434,459],[882,460,481,462,466],[888,436,478,470,478],[894,440,485,473,447],
    [900,417,449,445,422],[906,390,422,422,414],[912,399,462,413,456],[918,453,503,455,500],[926.5,459,509,498,474],[935,466,496,479,486],[941,478,500,484,499],[947,460,504,499,463],
    [953,434,463,463,437],[959,421,446,442,435],[965,387,433,433,404],[971,395,437,404,425],[977,406,442,426,424],[983,395,430,425,410],[989,392,415,408,401],[995,388,402,401,393],
    [1001,368,398,394,380],[1007,352,382,382,361],[1013,307,362,362,324],[1019,290,317,317,296],[1025,252,300,296,255],[1031,224,271,254,231],[1037,231,281,233,250],[1045.5,217,276,260,233],
    [1054,217,244,233,235],[1060,216,237,234,231],[1066,179,235,233,215],[1072,187,219,213,203],[1078,135,204,203,149],[1084,138,162,145,162],[1090,136,169,162,162],[1096,145,177,160,149],
    [1102,149,199,151,194],[1108,192,224,194,207],[1114,203,262,210,260],[1120,232,274,259,241],[1126,217,247,240,238],[1132,226,249,236,226],[1138,197,227,226,221],[1144,191,225,222,200],
    [1150,148,206,201,155],[1158.5,136,172,159,144],[1167,111,154,145,120],[1173,121,151,121,151],[1179,145,180,150,179],[1185,178,204,178,197],[1191,192,217,198,203],[1197,201,216,206,210],
    [1203,178,214,211,191],[1209,165,191,191,176],[1215,162,186,178,180],[1221,165,186,179,181],[1227,171,190,178,184],[1233,184,199,185,191],[1239,186,226,192,226],[1245,220,246,226,245],
    [1251,234,258,243,243],[1257,233,251,244,243],[1263,207,248,242,213],[1269,204,225,212,205],[1277.5,180,215,205,191],[1286,190,207,195,204],[1292,171,207,207,178],[1298,149,180,177,177],
    [1304,175,199,181,181],[1310,167,187,183,181],[1316,145,180,180,154],[1322,147,186,152,182],[1328,158,181,181,165],[1334,158,186,165,179],[1340,166,187,180,169],[1346,144,174,171,145],
    [1352,131,153,145,149],[1358,129,152,152,135],[1364,115,137,136,126],[1370,116,138,126,138],[1376,135,161,138,138],[1382,112,140,139,116],[1388,114,135,115,126],[1396.5,126,178,131,171],
    [1405,166,182,172,175],[1411,176,199,176,195],[1417,194,245,194,243],[1423,236,256,243,255],[1429,252,268,254,261],[1435,243,261,259,259],[1441,247,265,258,265],[1447,259,326,265,324],
    [1453,291,324,317,317],[1459,282,317,317,288],[1465,279,302,288,301],[1471,298,373,301,359],[1477,334,360,360,340],[1483,327,355,339,343],[1489,324,346,345,337],[1495,301,341,336,315],
    [1501,313,329,316,317]
  ];
  // The chart's own space: what's shown, and the long position.
  var VIEW = { x0: 0, x1: 1515, y0: 84, y1: 734 };
  var TOOL = { x0: 680, x1: 1067, top: 221, entry: 585, bottom: 684, hit: 1048 };
  var LAST = 321;
  var LABELS = { target: "119.00", entry: "3.66", stop: "32.50" };

  // Same palettes as extension/shared/skins.js (POS_THEMES), each with the
  // wallpaper its "Match wallpaper" pairs it with.
  var THEMES = [
    { id: "silk", label: "Silk & Satin", skin: "liquid-chrome", c: "#d4d9e2", c2: "#ffffff", a: 0.1 },
    { id: "starry", label: "Starry Space", skin: "twinkle", c: "#4d8dff", c2: "#b8d2ff", a: 0.3, glint: true },
    { id: "ember", label: "Ember & Ash", skin: "embers", c: "#ff7a2f", c2: "#ffc27a", a: 0.32 },
    { id: "blackhole", label: "Black Hole", skin: "black-hole", c: "#e3a83f", c2: "#ffe2a0", a: 0.3 },
    { id: "matrix", label: "Matrix", skin: "matrix", c: "#22d96b", c2: "#9dffc6", a: 0.3 },
    { id: "sakura", label: "Sakura", skin: "sakura", c: "#ff9cc4", c2: "#ffd6e7", a: 0.32 }
  ];
  var theme = THEMES[0];

  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(h, a) { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return "#" + [0, 1, 2].map(function (i) { return ("0" + Math.round(x[i] + (y[i] - x[i]) * t).toString(16)).slice(-2); }).join("");
  }
  function light(h) { var c = rgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.62; }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- The wallpaper behind ----------
  var bg = null, bgMs = 0, chromeCanvas = null;
  function setWallpaper(skin) {
    // Liquid chrome is WebGL; the scenes are 2D. Each gets its own canvas.
    if (chromeCanvas) { chromeCanvas.remove(); chromeCanvas = null; }
    bgCanvas.style.display = "";
    bg = null;
    if (skin === "liquid-chrome" && window.EZChrome) {
      chromeCanvas = document.createElement("canvas");
      chromeCanvas.className = "pos-layer";
      stage.insertBefore(chromeCanvas, chartCanvas);
      var gl = EZChrome.create(chromeCanvas, false);
      if (gl) { bgCanvas.style.display = "none"; bg = function (dt, w, h) { bgMs += dt; gl.draw(bgMs, w, h); }; return; }
      chromeCanvas.remove(); chromeCanvas = null;
    }
    var scene = window.EZScenes && EZScenes.create(skin, bgCanvas);
    bg = scene ? function (dt, w, h, u) { scene.frame(dt, w, h, u); } : null;
  }

  // ---------- The chart and the position ----------
  function drawChart() {
    var r = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (chartCanvas.width !== W || chartCanvas.height !== H) { chartCanvas.width = W; chartCanvas.height = H; }
    var ctx = chartCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // One scale for both axes; narrow screens keep the right-hand part
    // (the position and what came after).
    var k = H / (VIEW.y1 - VIEW.y0);
    var x0 = Math.max(VIEW.x0, VIEW.x1 - W / k);
    var X = function (x) { return (x - x0) * k; }, Y = function (y) { return (y - VIEW.y0) * k; };
    var u = Math.max(0.75, Math.min(1.4, k * 1.25)) * dpr;
    var T = theme, a = T.a;
    var f = { x0: X(TOOL.x0), x1: X(TOOL.x1), y0: Y(TOOL.top), y1: Y(TOOL.bottom) }, entry = Y(TOOL.entry);
    var rad = 8 * u;

    // Darken the wallpaper a touch so the candles read, like a chart would.
    ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(0, 0, W, H);

    // Last price: dotted.
    ctx.strokeStyle = "rgba(220,224,232,0.32)"; ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.setLineDash([1.5 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(0, Math.round(Y(LAST)) + 0.5); ctx.lineTo(W, Math.round(Y(LAST)) + 0.5); ctx.stroke();
    ctx.setLineDash([]);

    // Zones, clipped to the rounded frame.
    ctx.save();
    rr(ctx, f.x0 + 0.5 * u, f.y0 + 0.5 * u, f.x1 - f.x0 - u, f.y1 - f.y0 - u, rad); ctx.clip();
    var gt = ctx.createLinearGradient(0, f.y0, 0, entry);
    gt.addColorStop(0, rgba(T.c, a * 1.15)); gt.addColorStop(1, rgba(T.c, a * 0.8));
    ctx.fillStyle = gt; ctx.fillRect(f.x0, f.y0, f.x1 - f.x0, entry - f.y0);
    ctx.fillStyle = rgba(mix(T.c, "#05070c", 0.82), 0.62); ctx.fillRect(f.x0, entry, f.x1 - f.x0, f.y1 - entry);
    ctx.fillStyle = rgba(T.c2, 0.07); ctx.fillRect(f.x0, f.y0, X(TOOL.hit) - f.x0, entry - f.y0);
    ctx.restore();

    // Candles: white up, gray down (TradingView's mono look).
    var bw = Math.max(1, 4.6 * k);
    CANDLES.forEach(function (c) {
      var x = X(c[0]);
      if (x < -bw || x > W + bw) return;
      var up = c[4] <= c[3];
      ctx.fillStyle = ctx.strokeStyle = up ? "#ecedeb" : "#6a6d73";
      ctx.lineWidth = Math.max(1, k);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c[1])); ctx.lineTo(Math.round(x) + 0.5, Y(c[2])); ctx.stroke();
      var t = Y(Math.min(c[3], c[4])), b = Y(Math.max(c[3], c[4]));
      ctx.fillRect(x - bw / 2, t, bw, Math.max(1, b - t));
    });

    // Entry to where the target was hit: a faint dashed diagonal.
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.strokeStyle = rgba(T.c2, 0.45); ctx.lineWidth = u;
    ctx.beginPath(); ctx.moveTo(f.x0, entry); ctx.lineTo(X(TOOL.hit), f.y0 + 4 * u); ctx.stroke();

    // Frame with a glow, then the dashed entry line.
    ctx.setLineDash([]);
    ctx.save();
    ctx.shadowColor = rgba(T.c, 0.85); ctx.shadowBlur = 12 * u;
    ctx.strokeStyle = T.c; ctx.lineWidth = 1.5 * u;
    rr(ctx, f.x0 + 0.5 * u, f.y0 + 0.5 * u, f.x1 - f.x0 - u, f.y1 - f.y0 - u, rad); ctx.stroke();
    ctx.restore();
    ctx.setLineDash([4 * u, 3 * u]);
    ctx.strokeStyle = rgba(T.c2, 0.9); ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(f.x0 + 1.5 * u, entry); ctx.lineTo(f.x1 - 1.5 * u, entry); ctx.stroke();
    ctx.setLineDash([]);
    if (T.glint) {
      ctx.save(); ctx.shadowColor = T.c2; ctx.shadowBlur = 8 * u; ctx.fillStyle = "#ffffff";
      [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1]].forEach(function (p) {
        var r5 = 5 * u, q = r5 * 0.18, x = p[0], y = p[1];
        ctx.beginPath(); ctx.moveTo(x, y - r5); ctx.lineTo(x + q, y - q); ctx.lineTo(x + r5, y); ctx.lineTo(x + q, y + q);
        ctx.lineTo(x, y + r5); ctx.lineTo(x - q, y + q); ctx.lineTo(x - r5, y); ctx.lineTo(x - q, y - q); ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    }

    // Labels: target filled, entry dark with a glowing edge, stop dim.
    var cx = (f.x0 + f.x1) / 2;
    label(ctx, "target", LABELS.target, cx, f.y0 - 11 * u, u);
    label(ctx, "entry", LABELS.entry, cx, entry, u);
    label(ctx, "stop", LABELS.stop, cx, f.y1 + 11 * u, u);
  }
  function label(ctx, kind, txt, cx, cy, u) {
    var T = theme, Hh = 20 * u, font = "600 " + Math.round(12 * u) + "px Inter, 'Segoe UI', sans-serif";
    ctx.font = font;
    var W = ctx.measureText(txt).width + 22 * u, x0 = cx - W / 2, y = cy - Hh / 2, r = Math.min(Hh / 2, 9 * u), ink = "#ffffff";
    if (kind === "target") {
      ctx.save(); ctx.shadowColor = rgba(T.c, 0.75); ctx.shadowBlur = 12 * u; ctx.fillStyle = T.c; rr(ctx, x0, y, W, Hh, r); ctx.fill(); ctx.restore();
      var gr = ctx.createLinearGradient(0, y, 0, y + Hh);
      gr.addColorStop(0, mix(T.c, "#ffffff", 0.4)); gr.addColorStop(0.5, T.c); gr.addColorStop(1, mix(T.c, "#000000", 0.22));
      ctx.fillStyle = gr; rr(ctx, x0, y, W, Hh, r); ctx.fill();
      ctx.strokeStyle = rgba(mix(T.c2, "#ffffff", 0.3), 0.9); ctx.lineWidth = u; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.moveTo(x0 + r, y + 1.3 * u); ctx.lineTo(x0 + W - r, y + 1.3 * u); ctx.stroke();
      if (light(T.c)) ink = "#14171f";
    } else if (kind === "entry") {
      ctx.save(); ctx.shadowColor = rgba(T.c, 0.6); ctx.shadowBlur = 10 * u; ctx.fillStyle = "rgba(6,8,12,0.94)"; rr(ctx, x0, y, W, Hh, r); ctx.fill(); ctx.restore();
      ctx.strokeStyle = T.c; ctx.lineWidth = 1.4 * u; rr(ctx, x0, y, W, Hh, r); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(14,16,22,0.88)"; rr(ctx, x0, y, W, Hh, r); ctx.fill();
      ctx.strokeStyle = rgba(T.c, 0.35); ctx.lineWidth = u; ctx.stroke();
      ink = "#9aa3b5";
    }
    ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, cy + 0.5 * u);
  }

  // ---------- Theme chips ----------
  THEMES.forEach(function (t) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "pos-chip"; b.setAttribute("role", "radio");
    b.setAttribute("data-id", t.id);
    b.innerHTML = '<span class="pos-dot" style="background:' + t.c + ';box-shadow:0 0 10px ' + rgba(t.c, 0.8) + '"></span>' + t.label;
    chipsEl.appendChild(b);
  });
  function pick(id) {
    theme = THEMES.filter(function (t) { return t.id === id; })[0] || THEMES[0];
    [].forEach.call(chipsEl.children, function (b) {
      var on = b.getAttribute("data-id") === theme.id;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    setWallpaper(theme.skin);
    frame(0);
  }
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".pos-chip");
    if (b) pick(b.getAttribute("data-id"));
  });
  chipsEl.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    var chips = [].slice.call(chipsEl.children), i = chips.indexOf(document.activeElement);
    var next = chips[(i + (e.key === "ArrowRight" ? 1 : -1) + chips.length) % chips.length];
    next.focus(); next.click();
  });

  // ---------- Drawing loop: 30 fps, only while on screen ----------
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var raf = 0, last = 0, lastDraw = 0, pending = 0, visible = false, sized = "";
  function frame(dt) {
    var r = stage.getBoundingClientRect();
    var scale = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
    if (bg) bg(dt, w, h, scale * 0.5);
    var key = w + "x" + h + theme.id;
    if (key !== sized) { sized = key; drawChart(); }
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min(100, now - last) : 0;
    last = now; pending += dt;
    if (lastDraw && now - lastDraw < 31) return;
    lastDraw = now; frame(pending); pending = 0;
  }
  function play() { if (!reduced && !raf && visible && !document.hidden) { last = 0; lastDraw = 0; raf = requestAnimationFrame(loop); } }
  function pause() { cancelAnimationFrame(raf); raf = 0; }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) play(); else pause(); }).observe(stage);
  } else { visible = true; }
  document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); else play(); });
  window.addEventListener("resize", function () { sized = ""; frame(0); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { sized = ""; frame(0); });

  pick("silk");
  play();
})();
