// Animated skins drawn live on a 2D canvas: Sakura, Twinkle, Matrix,
// Black Hole and Embers. Used by the extension's skin (skin/skin.js) and
// popup thumbnails, and by the download page on ezpayouts.xyz (/skins/)
// for its live previews.
//
// Each scene works in canvas pixels; u is canvas pixels per CSS pixel, so
// sizes and speeds look the same at any resolution. Motion is driven by
// the elapsed time given to update(), so Speed just scales it.
var EZScenes = (function () {
  var TAU = Math.PI * 2;

  // Small seeded random generator (mulberry32): the same scene always
  // starts the same way, so thumbnails don't change between opens.
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }
  function count(w, h, u, per, lo, hi) {
    return Math.round(Math.min(hi, Math.max(lo, (w * h) / (u * u) / per)));
  }

  // ---------- Sakura: petals tumbling down on a dusky plum sky ----------
  function Sakura(rand) {
    var W, H, U, petals = [], bg = null, glow = null;
    var COLORS = [[246, 196, 210], [236, 170, 188], [222, 148, 170], [252, 216, 226], [210, 132, 158]];
    function spawn(p, anywhere) {
      p.z = rand();                                   // depth: 0 far, 1 near
      p.s = (4.5 + p.z * 11 + rand() * 2.5) * U;      // half-length
      p.x = rand() * W;
      p.y = anywhere ? rand() * H : -p.s * 3 - rand() * H * 0.15;
      p.vy = (16 + p.z * 34 + rand() * 12) * U;
      p.sway = (8 + rand() * 22) * U;
      p.sf = 0.5 + rand() * 0.9;
      p.ph = rand() * TAU;
      p.rot = rand() * TAU;
      p.vr = (rand() - 0.5) * 1.8;
      p.flip = rand() * TAU;
      p.vf = 0.9 + rand() * 2.4;
      p.c = COLORS[(rand() * COLORS.length) | 0];
      p.a = 0.3 + p.z * 0.6;
    }
    function petal(ctx, s) {
      // A rounded petal with the little notch at its tip.
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(-s * 0.62, s * 0.55, -s * 0.72, -s * 0.5, -s * 0.16, -s * 0.92);
      ctx.lineTo(0, -s * 0.74);
      ctx.lineTo(s * 0.16, -s * 0.92);
      ctx.bezierCurveTo(s * 0.72, -s * 0.5, s * 0.62, s * 0.55, 0, s);
      ctx.fill();
    }
    return {
      resize: function (w, h, u) {
        W = w; H = h; U = u; bg = glow = null;
        petals = [];
        var n = count(w, h, u, 11000, 30, 170);
        for (var i = 0; i < n; i++) { var p = {}; spawn(p, true); petals.push(p); }
        petals.sort(function (a, b) { return a.z - b.z; });
      },
      update: function (dt, t) {
        var wind = (Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.37 + 1.3) * 0.4) * 20 * U;
        for (var i = 0; i < petals.length; i++) {
          var p = petals[i];
          p.y += p.vy * dt;
          p.x += (wind * (0.35 + p.z) + Math.cos(t * p.sf + p.ph) * p.sway * p.sf) * dt;
          p.rot += p.vr * dt;
          p.flip += p.vf * dt;
          if (p.y - p.s * 2 > H) spawn(p, false);
          if (p.x < -40 * U) p.x += W + 80 * U;
          else if (p.x > W + 40 * U) p.x -= W + 80 * U;
        }
      },
      draw: function (ctx) {
        if (!bg) {
          bg = ctx.createLinearGradient(0, 0, 0, H);
          bg.addColorStop(0, "#2c1622");
          bg.addColorStop(0.55, "#1a0d16");
          bg.addColorStop(1, "#0e080c");
          glow = ctx.createRadialGradient(W * 0.8, H * 0.05, 0, W * 0.8, H * 0.05, Math.max(W, H) * 0.75);
          glow.addColorStop(0, "rgba(170,80,120,0.22)");
          glow.addColorStop(1, "rgba(170,80,120,0)");
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        for (var i = 0; i < petals.length; i++) {
          var p = petals[i];
          var face = Math.abs(Math.cos(p.flip));      // 1 = facing us, 0 = edge-on
          ctx.setTransform(1, 0, 0, 1, p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, 0.25 + 0.75 * face);
          ctx.fillStyle = rgba(p.c, p.a * (0.6 + 0.4 * face));
          petal(ctx, p.s);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    };
  }

  // ---------- Twinkle: a still night sky, stars breathing, a rare shooting star ----------
  function Twinkle(rand) {
    var W, H, U, stars = [], sparks = [], shoot = null, nextShoot = 0, bg = null, nebula = [];
    var TINTS = [[255, 255, 255], [255, 255, 255], [214, 226, 255], [255, 236, 214]];
    function cross(ctx, x, y, len, a) {
      var g = ctx.createLinearGradient(x - len, y, x + len, y);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - len, y - 0.6 * U, len * 2, 1.2 * U);
      g = ctx.createLinearGradient(x, y - len, x, y + len);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.6 * U, y - len, 1.2 * U, len * 2);
    }
    return {
      resize: function (w, h, u) {
        W = w; H = h; U = u; bg = null;
        stars = [];
        var n = count(w, h, u, 1500, 150, 1300);
        for (var i = 0; i < n; i++) {
          var big = Math.pow(rand(), 4);
          stars.push({
            x: rand() * W, y: rand() * H, r: (0.45 + big * 1.4) * U,
            a: 0.35 + rand() * 0.6, f: 0.4 + rand() * 2.2, ph: rand() * TAU,
            c: TINTS[(rand() * TINTS.length) | 0], v: (0.6 + big * 2.5) * U
          });
        }
        sparks = [];
        var m = count(w, h, u, 42000, 6, 40);
        for (var k = 0; k < m; k++) sparks.push({ x: rand() * W, y: rand() * H, len: (9 + rand() * 22) * U, f: 0.2 + rand() * 0.55, ph: rand() * TAU });
        nebula = [
          { x: rand() * W, y: rand() * H * 0.6, r: Math.max(W, H) * (0.35 + rand() * 0.2), c: [70, 80, 170] },
          { x: rand() * W, y: H * (0.4 + rand() * 0.6), r: Math.max(W, H) * (0.3 + rand() * 0.2), c: [120, 60, 150] }
        ];
        nextShoot = 2 + rand() * 6;
      },
      update: function (dt, t) {
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          s.x -= s.v * dt;
          if (s.x < -2 * U) { s.x += W + 4 * U; s.y = rand() * H; }
        }
        nextShoot -= dt;
        if (!shoot && nextShoot <= 0) {
          var ang = Math.PI * (0.8 + rand() * 0.15);
          var sp = (520 + rand() * 380) * U;
          shoot = { x: W * (0.3 + rand() * 0.7), y: H * rand() * 0.35, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 0.7 + rand() * 0.5 };
          nextShoot = 7 + rand() * 9;
        }
        if (shoot) {
          shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt; shoot.life += dt;
          if (shoot.life > shoot.max) shoot = null;
        }
      },
      draw: function (ctx, t) {
        if (!bg) {
          bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.8);
          bg.addColorStop(0, "#0c0e18");
          bg.addColorStop(1, "#040508");
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        for (var n = 0; n < nebula.length; n++) {
          var nb = nebula[n];
          var g = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
          g.addColorStop(0, rgba(nb.c, 0.07));
          g.addColorStop(1, rgba(nb.c, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = "lighter";
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          var a = s.a * (0.55 + 0.45 * Math.sin(t * s.f + s.ph));
          ctx.fillStyle = rgba(s.c, a);
          if (s.r < 1.1 * U) {
            ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
          } else {
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
          }
        }
        for (var k = 0; k < sparks.length; k++) {
          var sp = sparks[k];
          var pulse = Math.pow(0.5 + 0.5 * Math.sin(t * sp.f + sp.ph), 2.2);
          if (pulse < 0.02) continue;
          cross(ctx, sp.x, sp.y, sp.len * (0.6 + 0.4 * pulse), 0.85 * pulse);
          ctx.fillStyle = "rgba(200,215,255," + (0.12 * pulse).toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5 * U, 0, TAU); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255," + (0.95 * pulse).toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.5 * U, 0, TAU); ctx.fill();
        }
        if (shoot) {
          var fade = Math.sin(Math.PI * shoot.life / shoot.max);
          var tail = 0.12;
          var g2 = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * tail, shoot.y - shoot.vy * tail);
          g2.addColorStop(0, "rgba(255,255,255," + (0.9 * fade).toFixed(3) + ")");
          g2.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g2; ctx.lineWidth = 1.4 * U; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * tail, shoot.y - shoot.vy * tail); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    };
  }

  // ---------- Matrix: green code raining through a field of characters ----------
  function Matrix(rand) {
    // Half-width katakana (U+FF66 to U+FF9D), built from code points so the
    // file's text encoding never matters, plus the film's digits and marks.
    var GLYPHS = "012345789Z:.=*+-<>";
    for (var cp = 0xFF66; cp <= 0xFF9D; cp++) GLYPHS += String.fromCharCode(cp);
    var FONT = '"MS Gothic", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", "WenQuanYi Zen Hei", monospace';
    var W, H, U, layers = [];
    // Each glyph drawn once, mirrored like the film, into a sprite sheet:
    // row 0 in the trail green, row 1 as the bright, glowing head.
    function atlas(size) {
      var cw = Math.ceil(size * 1.05), ch = Math.ceil(size * 1.2), pad = Math.ceil(size * 0.5);
      var c = document.createElement("canvas");
      c.width = (cw + pad * 2) * GLYPHS.length;
      c.height = (ch + pad * 2) * 2;
      var x = c.getContext("2d");
      x.font = Math.round(size) + "px " + FONT;
      x.textAlign = "center";
      x.textBaseline = "middle";
      for (var i = 0; i < GLYPHS.length; i++) {
        for (var row = 0; row < 2; row++) {
          var cx = i * (cw + pad * 2) + pad + cw / 2, cy = row * (ch + pad * 2) + pad + ch / 2;
          x.save();
          x.translate(cx, cy);
          x.scale(-1, 1);
          if (row === 1) {
            x.shadowColor = "rgba(140,255,170,0.9)";
            x.shadowBlur = size * 0.6;
            x.fillStyle = "#e9fff0";
          } else {
            x.fillStyle = "#3dff7c";
          }
          x.fillText(GLYPHS[i], 0, 0);
          x.restore();
        }
      }
      return { canvas: c, cw: cw, ch: ch, pad: pad };
    }
    function makeLayer(size, alpha, speedLo, speedHi, active) {
      var a = atlas(size);
      var cols = Math.ceil(W / (a.cw * 0.98)) + 1, rows = Math.ceil(H / a.ch) + 1;
      var columns = [];
      for (var c = 0; c < cols; c++) {
        var g = new Uint8Array(rows);
        for (var r = 0; r < rows; r++) g[r] = (rand() * GLYPHS.length) | 0;
        var col = { glyphs: g, head: 0, speed: 0, len: 0, wait: 0 };
        drop(col, rows, speedLo, speedHi, active, true);
        columns.push(col);
      }
      return { a: a, cols: columns, rows: rows, alpha: alpha, lo: speedLo, hi: speedHi, active: active };
    }
    function drop(col, rows, lo, hi, active, anywhere) {
      col.speed = lo + rand() * (hi - lo);
      col.len = 8 + ((rand() * 24) | 0);
      col.head = anywhere ? rand() * (rows + col.len) : -rand() * rows * 0.6;
      // Not every column is raining at once.
      col.wait = rand() < active ? 0 : rand() * 6;
    }
    return {
      resize: function (w, h, u) {
        W = w; H = h; U = u;
        layers = [makeLayer(11 * u, 0.32, 5, 11, 0.55), makeLayer(16 * u, 0.95, 7, 16, 0.5)];
      },
      update: function (dt) {
        for (var l = 0; l < layers.length; l++) {
          var L = layers[l];
          for (var c = 0; c < L.cols.length; c++) {
            var col = L.cols[c];
            if (col.wait > 0) { col.wait -= dt; continue; }
            col.head += col.speed * dt;
            if (col.head - col.len > L.rows) drop(col, L.rows, L.lo, L.hi, L.active, false);
            // Characters in the trail flicker to new ones now and then.
            if (rand() < dt * 3) col.glyphs[(rand() * L.rows) | 0] = (rand() * GLYPHS.length) | 0;
          }
        }
      },
      draw: function (ctx) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#010302";
        ctx.fillRect(0, 0, W, H);
        for (var l = 0; l < layers.length; l++) {
          var L = layers[l], a = L.a, sw = a.cw + a.pad * 2, sh = a.ch + a.pad * 2;
          for (var c = 0; c < L.cols.length; c++) {
            var col = L.cols[c];
            if (col.wait > 0) continue;
            var headRow = Math.floor(col.head), x = c * a.cw * 0.98;
            for (var k = 0; k < col.len; k++) {
              var row = headRow - k;
              if (row < 0) break;
              if (row >= L.rows) continue;
              var gi = col.glyphs[row];
              var isHead = k === 0;
              var b = isHead ? 1 : Math.pow(1 - k / col.len, 1.5);
              ctx.globalAlpha = L.alpha * b;
              ctx.drawImage(a.canvas, gi * sw, isHead ? sh : 0, sw, sh, x - a.pad, row * a.ch - a.pad, sw, sh);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  // ---------- Black Hole: a glowing accretion disk bent around the shadow ----------
  function BlackHole(rand) {
    var W, H, U, R, cx, cy, parts = [], dust = [], bins = [], layers = null;
    var TILT = 0.17;
    // Color by radius (hot near the hole), brightness by Doppler side.
    var COLORS = [[255, 244, 214], [255, 214, 140], [244, 170, 84], [198, 120, 52]];
    var LEVELS = [0.3, 0.55, 0.8, 1];

    // The disk's glowing body: the half behind the hole, or the half in front.
    function diskGlow(c, front) {
      c.save();
      c.beginPath();
      if (front) c.rect(0, cy, W, H - cy); else c.rect(0, 0, W, cy);
      c.clip();
      c.translate(cx, cy);
      c.scale(1, TILT);
      var g = c.createRadialGradient(0, 0, R * 1.02, 0, 0, R * 4.4);
      g.addColorStop(0, "rgba(255,225,170,0)");
      g.addColorStop(0.03, "rgba(255,220,160,0.5)");
      g.addColorStop(0.18, "rgba(245,165,85,0.2)");
      g.addColorStop(0.5, "rgba(190,100,40,0.06)");
      g.addColorStop(1, "rgba(120,60,20,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, R * 4.4, 0, TAU); c.fill();
      c.restore();
    }
    // An arc that's brightest at its peak and fades out toward its ends.
    function fadingArc(c, rx, ry, from, to, peak, width, alpha) {
      var paint = "rgba(255,196,120," + alpha.toFixed(3) + ")";
      if (c.createConicGradient) {
        var g = c.createConicGradient(0, cx, cy), clear = "rgba(255,196,120,0)";
        g.addColorStop(0, clear);
        g.addColorStop(from / TAU, clear);
        g.addColorStop(peak / TAU, paint);
        g.addColorStop(to / TAU, clear);
        g.addColorStop(1, clear);
        paint = g;
      }
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, 0, from, to);
      c.strokeStyle = paint;
      c.lineWidth = width;
      c.lineCap = "butt";
      c.stroke();
    }
    function canvas(w, h) {
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      return c;
    }
    // Everything that doesn't move is painted once per size: behind the
    // particles (sky, haze, back of the disk, the lensed arcs), and in
    // front of them (the shadow, its photon ring, the front of the disk).
    function paintLayers() {
      var back = canvas(W, H), b = back.getContext("2d");
      b.fillStyle = "#020101";
      b.fillRect(0, 0, W, H);
      var haze = b.createRadialGradient(cx, cy, R * 0.9, cx, cy, Math.max(W, H) * 0.55);
      haze.addColorStop(0, "rgba(255,150,60,0.14)");
      haze.addColorStop(0.3, "rgba(140,70,25,0.05)");
      haze.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = haze;
      b.fillRect(0, 0, W, H);
      b.globalCompositeOperation = "lighter";
      diskGlow(b, false);
      // The far side of the disk, bent up over the top by the hole's
      // gravity: a soft wide glow, then a brighter core...
      b.filter = "blur(" + (R * 0.08).toFixed(1) + "px)";
      fadingArc(b, R * 1.5, R * 1.42, Math.PI * 1.02, Math.PI * 1.98, Math.PI * 1.5, R * 0.34, 0.42);
      b.filter = "blur(" + (R * 0.02).toFixed(1) + "px)";
      fadingArc(b, R * 1.47, R * 1.39, Math.PI * 1.06, Math.PI * 1.94, Math.PI * 1.5, R * 0.08, 0.5);
      b.filter = "none";
      // ...and the thin lensed image under it.
      fadingArc(b, R * 1.13, R * 1.1, Math.PI * 0.08, Math.PI * 0.92, Math.PI * 0.5, R * 0.035, 0.32);

      var y0 = Math.max(0, Math.floor(cy - R * 1.12));
      var front = canvas(W, Math.min(H, Math.ceil(cy + R * 1.12)) - y0), f = front.getContext("2d");
      f.translate(0, -y0);
      f.fillStyle = "#000";
      f.beginPath(); f.arc(cx, cy, R, 0, TAU); f.fill();
      f.globalCompositeOperation = "lighter";
      f.strokeStyle = "rgba(255,200,140,0.18)";
      f.lineWidth = 5 * U;
      f.beginPath(); f.arc(cx, cy, R * 1.03, 0, TAU); f.stroke();
      f.strokeStyle = "rgba(255,236,200,0.75)";
      f.lineWidth = 1.2 * U;
      f.beginPath(); f.arc(cx, cy, R * 1.02, 0, TAU); f.stroke();
      diskGlow(f, true);
      return { back: back, front: front, frontY: y0 };
    }

    return {
      resize: function (w, h, u) {
        W = w; H = h; U = u; layers = null;
        R = Math.min(W, H) * 0.17;
        cx = W * 0.56; cy = H * 0.44;
        parts = [];
        var n = count(w, h, u, 450, 1200, 3600);
        for (var i = 0; i < n; i++) {
          var r = 1.28 + Math.pow(rand(), 1.7) * 2.6;
          parts.push({
            r: r, a: rand() * TAU, v: 0.55 / Math.pow(r, 1.5),
            h: (rand() - 0.5) * 0.05 * r, s: (0.6 + rand() * 1.3) * U,
            ci: Math.min(3, Math.floor((r - 1.28) / 0.75)), b: 0.5 + rand() * 0.5
          });
        }
        dust = [];
        var m = count(w, h, u, 2500, 120, 700);
        for (var k = 0; k < m; k++) {
          var rr = 3 + rand() * 4.5;
          dust.push({ r: rr, a: rand() * TAU, v: 0.55 / Math.pow(rr, 1.5), h: (rand() - 0.5) * 0.9, s: (0.4 + rand() * 0.8) * U, b: 0.15 + rand() * 0.35 });
        }
        bins = [];
        for (var b = 0; b < 32; b++) bins.push([]);
      },
      update: function (dt) {
        for (var i = 0; i < parts.length; i++) parts[i].a += parts[i].v * dt;
        for (var k = 0; k < dust.length; k++) dust[k].a += dust[k].v * dt;
      },
      draw: function (ctx) {
        if (!layers) layers = paintLayers();
        // Sort this frame's particles into a few color/brightness bins so
        // each bin draws with one fill color. Back half (behind the hole)
        // goes in bins 0-15, front half in 16-31.
        for (var b = 0; b < bins.length; b++) bins[b].length = 0;
        function bin(p, isDust) {
          var x = cx + Math.cos(p.a) * p.r * R;
          var back = Math.sin(p.a) < 0;
          var y = cy + Math.sin(p.a) * p.r * R * TILT + p.h * R * (isDust ? 0.5 : 1);
          var dop = 0.55 + 0.45 * Math.cos(p.a + 0.4);           // approaching side brighter
          var lvl = Math.max(0, Math.min(3, Math.floor(dop * p.b * 4)));
          bins[(back ? 0 : 16) + (isDust ? 3 : p.ci) * 4 + lvl].push(x, y, p.s);
        }
        for (var i = 0; i < parts.length; i++) bin(parts[i], false);
        for (var k = 0; k < dust.length; k++) bin(dust[k], true);
        function drawBins(from) {
          for (var ci = 0; ci < 4; ci++) {
            for (var lvl = 0; lvl < 4; lvl++) {
              var list = bins[from + ci * 4 + lvl];
              if (!list.length) continue;
              ctx.fillStyle = rgba(COLORS[ci], LEVELS[lvl] * 0.85);
              for (var j = 0; j < list.length; j += 3) ctx.fillRect(list[j], list[j + 1], list[j + 2], list[j + 2]);
            }
          }
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(layers.back, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        drawBins(0);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(layers.front, 0, layers.frontY);
        ctx.globalCompositeOperation = "lighter";
        drawBins(16);
        ctx.globalCompositeOperation = "source-over";
      }
    };
  }

  // ---------- Embers: sparks drifting up from a fire below ----------
  function Embers(rand) {
    var W, H, U, sparks = [], orbs = [], bg = null, fire = null, orbSprite = null;
    function spawn(p, anywhere) {
      p.z = rand();
      p.x = rand() * W;
      p.y = anywhere ? rand() * H : H + rand() * 40 * U;
      p.vy = -(28 + p.z * 70 + rand() * 30) * U;
      p.vx = (rand() - 0.5) * 16 * U;
      p.life = anywhere ? rand() * 4 : 0;
      p.max = 3 + rand() * 5;
      p.w = (0.7 + p.z * 1.5) * U;
      p.heat = rand();
      p.ph = rand() * TAU;
      p.wob = 10 + rand() * 26;
    }
    function color(heat, fade) {
      // Hot yellow-white cools through orange to deep red as it rises.
      var k = Math.max(0, Math.min(1, heat * 0.6 + (1 - fade) * 0.5));
      return [255, Math.round(120 + 110 * (1 - k)), Math.round(40 + 120 * (1 - k) * (1 - k))];
    }
    return {
      resize: function (w, h, u) {
        W = w; H = h; U = u; bg = fire = null;
        sparks = [];
        var n = count(w, h, u, 6000, 50, 320);
        for (var i = 0; i < n; i++) { var p = {}; spawn(p, true); sparks.push(p); }
        orbs = [];
        var m = count(w, h, u, 120000, 4, 14);
        for (var k = 0; k < m; k++) orbs.push({ x: rand() * W, y: rand() * H, r: (18 + rand() * 50) * u, vy: -(4 + rand() * 10) * u, a: 0.04 + rand() * 0.06 });
        orbSprite = document.createElement("canvas");
        orbSprite.width = orbSprite.height = 64;
        var o = orbSprite.getContext("2d"), g = o.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, "rgba(255,150,60,1)");
        g.addColorStop(1, "rgba(255,150,60,0)");
        o.fillStyle = g; o.fillRect(0, 0, 64, 64);
      },
      update: function (dt, t) {
        for (var i = 0; i < sparks.length; i++) {
          var p = sparks[i];
          var swirl = Math.sin(p.y / (p.wob * U) + t * 1.1 + p.ph) * 22 * U;
          p.vx += (swirl - p.vx) * Math.min(1, dt * 1.5);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life += dt;
          if (p.life > p.max || p.y < -30 * U) spawn(p, false);
        }
        for (var k = 0; k < orbs.length; k++) {
          var o = orbs[k];
          o.y += o.vy * dt;
          if (o.y < -o.r) { o.y = H + o.r; o.x = rand() * W; }
        }
      },
      draw: function (ctx, t) {
        if (!bg) {
          bg = ctx.createLinearGradient(0, 0, 0, H);
          bg.addColorStop(0, "#080504");
          bg.addColorStop(0.6, "#120905");
          bg.addColorStop(1, "#1f0d05");
          fire = ctx.createRadialGradient(W * 0.5, H * 1.15, 0, W * 0.5, H * 1.15, Math.max(W, H) * 0.85);
          fire.addColorStop(0, "rgba(255,110,30,0.22)");
          fire.addColorStop(0.5, "rgba(200,70,20,0.07)");
          fire.addColorStop(1, "rgba(0,0,0,0)");
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = fire; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        for (var k = 0; k < orbs.length; k++) {
          var o = orbs[k];
          ctx.globalAlpha = o.a * (0.7 + 0.3 * Math.sin(t * 0.8 + k));
          ctx.drawImage(orbSprite, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = "round";
        for (var i = 0; i < sparks.length; i++) {
          var p = sparks[i];
          var fade = Math.sin(Math.PI * Math.min(1, p.life / p.max));
          var flick = 0.75 + 0.25 * Math.sin(t * 13 + p.ph * 7);
          var a = fade * flick * (0.35 + p.z * 0.65);
          if (a < 0.02) continue;
          var c = color(p.heat, fade);
          var tail = 0.1 + p.z * 0.1;
          var x2 = p.x - p.vx * tail, y2 = p.y - p.vy * tail;
          // A soft halo, then the bright core.
          ctx.strokeStyle = rgba(c, a * 0.2);
          ctx.lineWidth = p.w * 4;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = rgba(c, a);
          ctx.lineWidth = p.w;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    };
  }

  var SCENES = { sakura: Sakura, twinkle: Twinkle, matrix: Matrix, "black-hole": BlackHole, embers: Embers };
  var SEEDS = { sakura: 11, twinkle: 23, matrix: 37, "black-hole": 41, embers: 53 };

  // A running scene on a canvas: frame(dtMs, w, h, u) advances it by dtMs
  // of motion and draws it at w×h canvas pixels.
  function create(id, canvas) {
    var make = SCENES[id];
    if (!make) return null;
    var ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    var scene = make(rng(SEEDS[id])), t = 0, W = 0, H = 0, Uu = 0;
    return {
      frame: function (dtMs, w, h, u) {
        if (w !== W || h !== H || u !== Uu) {
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          W = w; H = h; Uu = u;
          scene.resize(w, h, u);
          // Start mid-motion rather than with everything bunched up.
          for (var i = 0; i < 90; i++) { t += 1 / 30; scene.update(1 / 30, t); }
        }
        var dt = Math.min(dtMs, 100) / 1000;
        t += dt;
        scene.update(dt, t);
        scene.draw(ctx, t);
      }
    };
  }

  // A still frame as an image URL (thumbnails).
  function still(id, w, h, u) {
    var c = document.createElement("canvas");
    var s = create(id, c);
    if (!s) return "";
    s.frame(0, w, h, u || 0.5);
    return c.toDataURL("image/jpeg", 0.88);
  }

  return { ids: Object.keys(SCENES), has: function (id) { return !!SCENES[id]; }, create: create, still: still };
})();
