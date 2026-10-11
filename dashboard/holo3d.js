// Holographic 3D views for the dashboard's Edge Profile and Daily Net
// Cumulative P&L cards.
//
// Both scenes are real 3D geometry seen through a perspective camera that
// orbits them; every point is projected each frame. They are drawn on a 2D
// canvas instead of WebGL because they are made of glowing wires, nodes and
// text: a 2D canvas strokes those crisply at any width (WebGL lines are
// stuck at 1px) and the page doesn't have to download a 3D library.
//
// While a card is focused: drag to orbit (with inertia), Ctrl/Cmd + wheel or
// a trackpad/touch pinch to zoom (a plain wheel still scrolls the page),
// double-click to reset. A view only redraws while something is moving or
// it is focused, and never while it is scrolled off-screen.
(function(){
  "use strict";

  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  var MONTHS_LONG = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  var CYAN = [70, 212, 255];
  var PRISM = [72, 160, 255];
  var BLUE = [50, 98, 246];
  var GREEN = [86, 236, 146];
  var RED = [255, 98, 98];
  var ICE = [232, 240, 255];
  var MUTED = [138, 150, 178];

  var FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace";
  var FONT_DISPLAY = "'Chakra Petch', 'Segoe UI', sans-serif";

  function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function easeOut(t){ t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function rgba(c, a){ return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + clamp(a, 0, 1).toFixed(3) + ")"; }

  function pathPoly(ctx, pts, closed){
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (closed) ctx.closePath();
  }
  function pathLine(ctx, a, b){
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  // Neon stroke of the current path: wide faint halo, softer mid pass,
  // bright core, all added on top of what's below.
  function glowStroke(ctx, color, width, alpha, glow){
    var op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    if (glow){
      ctx.lineWidth = width * 5.5; ctx.strokeStyle = rgba(color, alpha * 0.07); ctx.stroke();
      ctx.lineWidth = width * 2.6; ctx.strokeStyle = rgba(color, alpha * 0.18); ctx.stroke();
    }
    ctx.lineWidth = width; ctx.strokeStyle = rgba(color, alpha); ctx.stroke();
    ctx.globalCompositeOperation = op;
  }

  var sprites = {};
  function glowSprite(c){
    var key = c.join(",");
    if (sprites[key]) return sprites[key];
    var s = 64, cv = document.createElement("canvas");
    cv.width = cv.height = s;
    var g = cv.getContext("2d");
    var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, rgba(c, 0.95));
    grad.addColorStop(0.16, rgba(c, 0.6));
    grad.addColorStop(0.42, rgba(c, 0.16));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return (sprites[key] = cv);
  }
  function drawNode(ctx, p, color, size, core){
    var op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glowSprite(color), p[0] - size / 2, p[1] - size / 2, size, size);
    if (core){
      ctx.beginPath();
      ctx.arc(p[0], p[1], core, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(240,255,250,0.95)";
      ctx.fill();
    }
    ctx.globalCompositeOperation = op;
  }

  // ---------- Camera: orbits a target point ----------
  function Camera(){
    this.yaw = 0; this.pitch = 0; this.dist = 10;
    this.tx = 0; this.ty = 0; this.tz = 0;
  }
  // fit: { f: focal length in px, ox/oy: where the target lands on screen }.
  Camera.prototype.begin = function(fit){
    this.cY = Math.cos(this.yaw); this.sY = Math.sin(this.yaw);
    this.cP = Math.cos(this.pitch); this.sP = Math.sin(this.pitch);
    this.f = fit.f; this.ox = fit.ox; this.oy = fit.oy;
  };
  // World point -> [screenX, screenY, depth]; depth grows away from the
  // camera. The camera sits `dist` from the target, `yaw` around the
  // vertical axis (0 = looking along +z) and `pitch` above the horizon.
  Camera.prototype.project = function(x, y, z){
    x -= this.tx; y -= this.ty; z -= this.tz;
    var x1 = x * this.cY + z * this.sY;
    var z1 = -x * this.sY + z * this.cY;
    var y2 = y * this.cP + z1 * this.sP;
    var z2 = -y * this.sP + z1 * this.cP;
    var d = z2 + this.dist;
    if (d < 0.1) d = 0.1;
    var k = this.f / d;
    return [this.ox + x1 * k, this.oy - y2 * k, d];
  };

  // ---------- Orbit controls ----------
  function Orbit(el, cam, cfg, kick){
    var self = this;
    this.cam = cam; this.cfg = cfg;
    this.yaw = cam.yaw = cfg.home.yaw;
    this.pitch = cam.pitch = cfg.home.pitch;
    this.dist = cam.dist = cfg.home.dist;
    this.vYaw = 0; this.vPitch = 0;
    this.dragging = false;

    var pointers = {}, lastX = 0, lastY = 0, lastT = 0, pinchFrom = 0, pinchDist = 0;
    function ids(){ return Object.keys(pointers); }
    function spread(){
      var k = ids(), a = pointers[k[0]], b = pointers[k[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    el.addEventListener("pointerdown", function(e){
      if (!cfg.enabled()) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      var n = ids().length;
      if (n === 1){
        self.dragging = true;
        self.vYaw = self.vPitch = 0;
        lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
        el.classList.add("is-dragging");
      } else if (n === 2){
        pinchFrom = spread(); pinchDist = self.dist;
      }
      kick();
    });
    el.addEventListener("pointermove", function(e){
      if (!pointers[e.pointerId]){ if (cfg.onHover) cfg.onHover(e); return; }
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ids().length >= 2){
        var s = spread();
        if (pinchFrom > 0 && s > 0) self.dist = clamp(pinchDist * pinchFrom / s, cfg.distMin, cfg.distMax);
      } else {
        var now = performance.now(), dt = Math.max(8, now - lastT) / 1000;
        var dYaw = -(e.clientX - lastX) * 0.0085, dPitch = (e.clientY - lastY) * 0.0065;
        lastX = e.clientX; lastY = e.clientY; lastT = now;
        self.rotate(dYaw, dPitch);
        // Fling speed for after release, smoothed so a single jittery
        // last event doesn't decide it.
        self.vYaw = lerp(self.vYaw, dYaw / dt, 0.4);
        self.vPitch = lerp(self.vPitch, dPitch / dt, 0.4);
      }
      kick();
    });
    function end(e){
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      var left = ids();
      if (!left.length){
        self.dragging = false;
        el.classList.remove("is-dragging");
        // Held still before letting go: no fling.
        if (performance.now() - lastT > 80) self.vYaw = self.vPitch = 0;
      } else {
        lastX = pointers[left[0]].x; lastY = pointers[left[0]].y; lastT = performance.now();
        self.vYaw = self.vPitch = 0;
      }
      kick();
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);

    // Ctrl/Cmd + wheel zooms (trackpad pinches arrive this way too) and is
    // kept from zooming the page. A plain wheel is left alone so the page
    // scrolls normally over the chart.
    el.addEventListener("wheel", function(e){
      if (!cfg.enabled() || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      var rate = Math.abs(dy) < 40 ? 0.012 : 0.0024;
      self.dist = clamp(self.dist * Math.exp(dy * rate), cfg.distMin, cfg.distMax);
      kick();
    }, { passive: false });
    // Safari's trackpad pinch (its touch pinch already comes through the
    // pointer events above).
    var gestureFrom = 0;
    el.addEventListener("gesturestart", function(e){
      if (!cfg.enabled()) return;
      e.preventDefault();
      gestureFrom = self.dist;
    });
    el.addEventListener("gesturechange", function(e){
      if (!cfg.enabled()) return;
      e.preventDefault();
      if (ids().length || !gestureFrom || !e.scale) return;
      self.dist = clamp(gestureFrom / e.scale, cfg.distMin, cfg.distMax);
      kick();
    });
    el.addEventListener("dblclick", function(){
      if (!cfg.enabled()) return;
      self.reset();
      kick();
    });
  }
  Orbit.prototype.rotate = function(dYaw, dPitch){
    var c = this.cfg;
    this.yaw += dYaw;
    if (c.yawMin != null) this.yaw = clamp(this.yaw, c.yawMin, c.yawMax);
    this.pitch = clamp(this.pitch + dPitch, c.pitchMin, c.pitchMax);
  };
  Orbit.prototype.reset = function(){
    var home = this.cfg.home, turn = Math.PI * 2;
    this.vYaw = this.vPitch = 0;
    // Swing back the short way, not back through every turn dragged.
    this.yaw = home.yaw + Math.round((this.cam.yaw - home.yaw) / turn) * turn;
    this.pitch = home.pitch;
    this.dist = home.dist;
  };
  // Eases the camera toward where input put it; true while still moving.
  Orbit.prototype.step = function(dt){
    if (!this.dragging && (this.vYaw || this.vPitch)){
      this.rotate(this.vYaw * dt, this.vPitch * dt);
      var decay = Math.exp(-dt * 4.2);
      this.vYaw *= decay; this.vPitch *= decay;
      if (Math.abs(this.vYaw) < 0.015 && Math.abs(this.vPitch) < 0.015) this.vYaw = this.vPitch = 0;
    }
    var cam = this.cam, k = 1 - Math.exp(-dt * 15);
    cam.yaw += (this.yaw - cam.yaw) * k;
    cam.pitch += (this.pitch - cam.pitch) * k;
    cam.dist += (this.dist - cam.dist) * k;
    var moving = this.dragging || this.vYaw || this.vPitch ||
      Math.abs(this.yaw - cam.yaw) > 1e-4 || Math.abs(this.pitch - cam.pitch) > 1e-4 || Math.abs(this.dist - cam.dist) > 1e-3;
    if (!moving){ cam.yaw = this.yaw; cam.pitch = this.pitch; cam.dist = this.dist; }
    return !!moving;
  };

  // ---------- Shared view plumbing: canvas, sizing, render loop ----------
  function View(container, cfg){
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext ? canvas.getContext("2d") : null;
    this.ok = !!ctx;
    if (!ctx) return;
    var self = this;
    canvas.className = "holo3d-canvas";
    container.appendChild(canvas);
    this.container = container; this.canvas = canvas; this.ctx = ctx;
    this.cam = new Camera();
    this.focused = false;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.intro = 1; this.introStart = -1; this.introPending = false;
    this.introDur = cfg.introDur || 1400;
    this.raf = 0; this.lastT = 0; this.onScreen = true;
    this.data = null; this.dataKey = null;
    this.hover = null; this.pointer = null;

    cfg.enabled = function(){ return self.focused; };
    cfg.onHover = function(e){
      if (!self.focused) return;
      var r = canvas.getBoundingClientRect();
      self.pointer = [e.clientX - r.left, e.clientY - r.top];
      self.kick();
    };
    this.orbit = new Orbit(canvas, this.cam, cfg, function(){ self.kick(); });
    canvas.addEventListener("pointerleave", function(){
      if (!self.pointer) return;
      self.pointer = null;
      self.kick();
    });

    this._frame = function(t){ self.frame(t); };
    this.resize();
    if (window.ResizeObserver){
      new ResizeObserver(function(){ if (self.resize()) self.drawNow(); }).observe(container);
    } else {
      window.addEventListener("resize", function(){ if (self.resize()) self.drawNow(); });
    }
    if (window.IntersectionObserver){
      new IntersectionObserver(function(entries){
        self.onScreen = entries[entries.length - 1].isIntersecting;
        if (self.onScreen) self.kick();
      }).observe(container);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ self.drawNow(); });
  }
  View.prototype.resize = function(){
    var r = this.container.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.fit = null;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return true;
  };
  View.prototype.kick = function(){
    if (!this.raf && this.onScreen) this.raf = requestAnimationFrame(this._frame);
  };
  View.prototype.drawNow = function(){
    if (this.w > 1) this.draw(performance.now() / 1000);
  };
  View.prototype.frame = function(t){
    this.raf = 0;
    var dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 1 / 60;
    var moving = this.orbit.step(dt);
    if (this.introPending){ this.introPending = false; this.introStart = t; }
    var introRunning = false;
    if (this.introStart >= 0){
      var p = (t - this.introStart) / this.introDur;
      this.intro = Math.min(1, p);
      introRunning = p < 1;
      if (!introRunning) this.introStart = -1;
    }
    this.draw(t / 1000);
    // Focused views keep animating (pulses, scan lines); otherwise the
    // loop stops as soon as nothing is moving.
    if (moving || introRunning || this.introPending || (this.focused && !REDUCED)){
      this.lastT = t;
      this.kick();
    } else {
      this.lastT = 0;
    }
  };
  View.prototype.playIntro = function(){
    if (REDUCED){ this.intro = 1; this.introStart = -1; this.drawNow(); return; }
    this.intro = 0;
    this.introPending = true;
    this.drawNow();
    this.kick();
  };
  // Replays the draw-on animation only when the numbers actually changed,
  // not on every re-render of the page.
  View.prototype.setData = function(data){
    var key = JSON.stringify(data);
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.data = data;
    if (this.prepare) this.prepare();
    this.playIntro();
  };
  View.prototype.setFocused = function(on){
    on = !!on;
    if (on === this.focused) return;
    this.focused = on;
    this.fit = null;
    this.canvas.classList.toggle("is-interactive", on);
    this.pointer = null;
    this.orbit.reset();
    if (this.prepare) this.prepare();
    if (on && this.data) this.playIntro();
    this.kick();
  };
  View.prototype.begin = function(){
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.fit) this.fit = this.computeFit();
    this.cam.begin(this.fit);
    return ctx;
  };
  // Frames the scene for this canvas: projects the scene's bounding points
  // from the home view, then picks the scale and offset that fit them
  // inside the margins (left, right, top, bottom: room for the labels).
  // Zooming and orbiting then move the camera from there.
  View.prototype.computeFit = function(){
    var cam = this.cam, home = this.orbit.cfg.home, keep = [cam.yaw, cam.pitch, cam.dist];
    cam.yaw = home.yaw; cam.pitch = home.pitch; cam.dist = home.dist;
    cam.begin({ f: 1, ox: 0, oy: 0 });
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    this.bounds().forEach(function(v){
      var p = cam.project(v[0], v[1], v[2]);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    });
    cam.yaw = keep[0]; cam.pitch = keep[1]; cam.dist = keep[2];
    var m = this.margins(), aw = Math.max(20, this.w - m[0] - m[1]), ah = Math.max(20, this.h - m[2] - m[3]);
    var f = Math.min(aw / ((x1 - x0) || 1), ah / ((y1 - y0) || 1));
    return { f: f, ox: m[0] + aw / 2 - f * (x0 + x1) / 2, oy: m[2] + ah / 2 - f * (y0 + y1) / 2 };
  };

  // Text lying flat on a plane of the scene (ux, uy: the plane's world
  // directions for the text's right and up), fitted to the perspective at
  // its anchor.
  function planeText(view, text, anchor, ux, uy, size, font, color, alpha, align, glow){
    var cam = view.cam, ctx = view.ctx, dpr = view.dpr;
    var o = cam.project(anchor[0], anchor[1], anchor[2]);
    var ax = cam.project(anchor[0] + ux[0], anchor[1] + ux[1], anchor[2] + ux[2]);
    var ay = cam.project(anchor[0] + uy[0], anchor[1] + uy[1], anchor[2] + uy[2]);
    var U = 100; // layout scale: text is set at U px per world unit
    ctx.save();
    ctx.setTransform(dpr * (ax[0] - o[0]) / U, dpr * (ax[1] - o[1]) / U,
      -dpr * (ay[0] - o[0]) / U, -dpr * (ay[1] - o[1]) / U, dpr * o[0], dpr * o[1]);
    ctx.font = font.replace("{px}", (size * U).toFixed(1) + "px");
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    if (glow){
      ctx.shadowColor = rgba(color, 0.75);
      ctx.shadowBlur = glow * dpr;
    }
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // =====================================================================
  // Edge Profile: a pentagonal score prism standing on a pentagon floor.
  // =====================================================================
  var E_R = 3, E_CASE_H = 1.75, E_PRISM_H = 1.05;

  function EdgeProfile(container){
    View.call(this, container, {
      home: { yaw: -0.36, pitch: 0.56, dist: 12 },
      pitchMin: -0.2, pitchMax: 1.4, distMin: 7.5, distMax: 24
    });
    if (this.ok){ this.cam.ty = 0.5; }
  }
  EdgeProfile.prototype = Object.create(View.prototype);
  // Labels show their detail lines only when focused on a wide enough card.
  EdgeProfile.prototype.detailed = function(){ return this.focused && this.w >= 640; };
  EdgeProfile.prototype.bounds = function(){
    var pts = [], n = 5;
    for (var i = 0; i < n; i++){
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2, x = Math.cos(a) * E_R * 1.1, z = -Math.sin(a) * E_R * 1.1;
      pts.push([x, 0, z], [x, E_CASE_H, z]);
    }
    return pts;
  };
  EdgeProfile.prototype.margins = function(){
    return this.detailed() ? [200, 200, 34, 64] : [56, 56, 36, 38];
  };

  EdgeProfile.prototype.draw = function(time){
    var ctx = this.begin(), d = this.data, cam = this.cam;
    if (!d || this.w < 2) return;
    var focused = this.focused, n = d.scores.length;
    var grow = easeOut(this.intro * 1.15), rise = easeOut(this.intro * 1.4 - 0.3);

    function ang(i){ return -Math.PI / 2 + (i / n) * Math.PI * 2; }
    function at(i, r, y){ var a = ang(i); return [Math.cos(a) * r, y, -Math.sin(a) * r]; }
    function P(v){ return cam.project(v[0], v[1], v[2]); }
    function ring(r, y){ var out = []; for (var i = 0; i < n; i++) out.push(P(at(i, r, y))); return out; }

    var center = P([0, 0, 0]);
    var outer = ring(E_R, 0);
    var dMin = Infinity, dMax = -Infinity, reach = 0;
    outer.forEach(function(p){
      dMin = Math.min(dMin, p[2]); dMax = Math.max(dMax, p[2]);
      reach = Math.max(reach, Math.hypot(p[0] - center[0], p[1] - center[1]));
    });
    function fade(depth){ return dMax > dMin ? 1 - 0.5 * clamp((depth - dMin) / (dMax - dMin), 0, 1) : 1; }

    // Floor: glow pool, rings and spokes.
    ctx.globalCompositeOperation = "lighter";
    var pool = ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], reach * 1.05);
    pool.addColorStop(0, rgba(BLUE, 0.26));
    pool.addColorStop(0.55, rgba(BLUE, 0.08));
    pool.addColorStop(1, rgba(BLUE, 0));
    pathPoly(ctx, outer, true);
    ctx.fillStyle = pool;
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    [0.25, 0.5, 0.75].forEach(function(f){
      pathPoly(ctx, ring(E_R * f, 0), true);
      glowStroke(ctx, CYAN, 1, 0.16, false);
    });
    pathPoly(ctx, outer, true);
    glowStroke(ctx, CYAN, 1.3, 0.5, true);
    for (var s = 0; s < n; s++){
      pathLine(ctx, center, outer[s]);
      glowStroke(ctx, CYAN, 1, 0.16, false);
    }

    // Glass case: the full-score pentagon as a faint prism.
    var caseTop = ring(E_R, E_CASE_H * rise);
    pathPoly(ctx, caseTop, true);
    glowStroke(ctx, CYAN, 1, 0.13, false);
    for (var c = 0; c < n; c++){
      var gEdge = ctx.createLinearGradient(outer[c][0], outer[c][1], caseTop[c][0], caseTop[c][1]);
      gEdge.addColorStop(0, rgba(CYAN, 0.32 * fade(outer[c][2])));
      gEdge.addColorStop(1, rgba(CYAN, 0.02));
      pathLine(ctx, outer[c], caseTop[c]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = gEdge;
      ctx.stroke();
    }

    // Score prism.
    var botW = [], topW = [];
    for (var i = 0; i < n; i++){
      var r = E_R * Math.max(0.05, d.scores[i] / 100) * grow;
      botW.push(at(i, r, 0));
      topW.push(at(i, r, E_PRISM_H * rise));
    }
    var bot = botW.map(P), top = topW.map(P);

    ctx.globalCompositeOperation = "lighter";
    pathPoly(ctx, bot, true);
    ctx.fillStyle = rgba(CYAN, 0.12);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // Faces back to front, shaded by how much each one faces a light up
    // and to the front-left, so the solid reads as a solid.
    var light = [-0.45, 0.6, -0.66];
    var faces = [];
    for (var f = 0; f < n; f++){
      var g2 = (f + 1) % n;
      var mx = (botW[f][0] + botW[g2][0]) / 2, mz = (botW[f][2] + botW[g2][2]) / 2;
      var ml = Math.hypot(mx, mz) || 1;
      faces.push({
        pts: [bot[f], bot[g2], top[g2], top[f]],
        depth: (bot[f][2] + bot[g2][2] + top[f][2] + top[g2][2]) / 4,
        shade: 0.45 + 0.55 * Math.max(0, (mx / ml) * light[0] + (mz / ml) * light[2])
      });
    }
    faces.push({ pts: top, depth: top.reduce(function(s2, p){ return s2 + p[2]; }, 0) / n - 0.01, top: true });
    faces.sort(function(a, b){ return b.depth - a.depth; });
    faces.forEach(function(face){
      var pts = face.pts;
      pathPoly(ctx, pts, true);
      if (face.top){
        ctx.fillStyle = rgba(PRISM, 0.24);
      } else {
        var yb = (pts[0][1] + pts[1][1]) / 2, yt = (pts[2][1] + pts[3][1]) / 2;
        var xb = (pts[0][0] + pts[1][0]) / 2, xt = (pts[2][0] + pts[3][0]) / 2;
        var gf = ctx.createLinearGradient(xb, yb, xt, yt);
        gf.addColorStop(0, rgba(PRISM, 0.05 * face.shade));
        gf.addColorStop(1, rgba(PRISM, 0.26 * face.shade));
        ctx.fillStyle = gf;
      }
      ctx.fill();
    });

    // Edges: base, uprights, then the bright top rim.
    for (var e = 0; e < n; e++){
      var e2 = (e + 1) % n;
      pathLine(ctx, bot[e], bot[e2]);
      glowStroke(ctx, CYAN, 1.1, 0.5 * fade((bot[e][2] + bot[e2][2]) / 2), false);
      pathLine(ctx, bot[e], top[e]);
      glowStroke(ctx, CYAN, 1.1, 0.55 * fade(bot[e][2]), true);
    }
    for (var t2 = 0; t2 < n; t2++){
      var t3 = (t2 + 1) % n;
      pathLine(ctx, top[t2], top[t3]);
      glowStroke(ctx, CYAN, 1.7, 0.95 * fade((top[t2][2] + top[t3][2]) / 2), true);
    }

    // A scan line sweeping up the prism while it's being looked at.
    if (focused && !REDUCED && this.intro >= 1){
      var sweep = (time * 0.3) % 1;
      pathPoly(ctx, botW.map(function(v){ return P([v[0], E_PRISM_H * sweep, v[2]]); }), true);
      glowStroke(ctx, ICE, 1.2, 0.55 * Math.sin(sweep * Math.PI), true);
    }

    // Nodes: score corners on top, full-score corners on the floor.
    var pulse = focused && !REDUCED ? 1 + 0.14 * Math.sin(time * 2.6) : 1;
    for (var v = 0; v < n; v++){
      drawNode(ctx, outer[v], CYAN, 13, 1.4);
      drawNode(ctx, bot[v], CYAN, 12, 0);
      drawNode(ctx, top[v], CYAN, (focused ? 30 : 24) * pulse * fade(top[v][2]), focused ? 2.4 : 2);
    }

    // Labels, billboarded so they always face the viewer.
    var labelAlpha = easeOut(this.intro * 1.6 - 0.4);
    if (labelAlpha > 0) this.drawLabels(ring(E_R * 1.1, 0), outer, center, fade, labelAlpha);
  };

  EdgeProfile.prototype.drawLabels = function(anchors, verts, center, fade, alpha){
    var ctx = this.ctx, d = this.data, focused = this.focused, detailed = this.detailed(), w = this.w, h = this.h;
    var nameFont = "700 " + (detailed ? 11 : 9) + "px " + FONT_MONO;
    var scoreFont = "700 " + (detailed ? 11 : 13) + "px " + (detailed ? FONT_MONO : FONT_DISPLAY);
    var subFont = "500 " + 10 + "px " + FONT_MONO;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (var i = 0; i < anchors.length; i++){
      var p = anchors[i];
      var a = alpha * fade(p[2]);
      var dx = p[0] - center[0], dy = p[1] - center[1];
      var align = Math.abs(dx) < Math.abs(dy) * 0.35 ? "center" : dx > 0 ? "left" : "right";
      var name = String(d.labels[i]).toUpperCase(), score = d.scores[i].toFixed(1) + "%";
      var lines;
      if (detailed){
        lines = [{ h: 16, parts: [[name + "  ", nameFont, ICE], [score, scoreFont, CYAN]] }];
        (d.details && d.details[i] || []).forEach(function(s){ lines.push({ h: 14, parts: [["• " + s, subFont, MUTED]] }); });
      } else {
        // Two-word names stack so the labels stay narrow on a small card.
        lines = name.split(" ").map(function(word){ return { h: 12, parts: [[word, nameFont, ICE]] }; });
        lines.push({ h: 16, parts: [[score, scoreFont, CYAN]] });
      }
      var blockW = 0, blockH = 0;
      lines.forEach(function(line){
        line.w = 0;
        line.parts.forEach(function(part){ ctx.font = part[1]; part.w = ctx.measureText(part[0]).width; line.w += part.w; });
        blockW = Math.max(blockW, line.w);
        blockH += line.h;
      });
      var gap = focused ? 14 : 8, bx, by;
      if (align === "left") bx = p[0] + gap;
      else if (align === "right") bx = p[0] - gap - blockW;
      else bx = p[0] - blockW / 2;
      // Above the corner when it's above the middle, below when below,
      // centered on it at the sides.
      var lift = clamp(dy / 40, -1, 1);
      by = p[1] - blockH * (0.5 - 0.5 * lift) + (align === "center" ? gap * lift : 0);
      bx = clamp(bx, 6, Math.max(6, w - 6 - blockW));
      by = clamp(by, 4, Math.max(4, h - 4 - blockH));

      if (focused){
        // Dashed leader from the floor corner to the text.
        var tx = align === "left" ? bx - 4 : align === "right" ? bx + blockW + 4 : bx + blockW / 2;
        var ty = align === "center" ? (dy < 0 ? by + blockH + 2 : by - 2) : clamp(p[1], by + 6, by + blockH - 6);
        ctx.save();
        ctx.setLineDash([3, 3]);
        pathLine(ctx, verts[i], [tx, ty]);
        glowStroke(ctx, CYAN, 1, 0.45 * a, false);
        ctx.restore();
      }
      var y = by;
      lines.forEach(function(line){
        var x = align === "left" ? bx : align === "right" ? bx + blockW - line.w : bx + (blockW - line.w) / 2;
        line.parts.forEach(function(part){
          ctx.font = part[1];
          ctx.fillStyle = rgba(part[2], a);
          ctx.fillText(part[0], x, y);
          x += part.w;
        });
        y += line.h;
      });
    }
  };

  // =====================================================================
  // Daily Net Cumulative P&L: a glass panel with a wireframe terrain of the
  // equity curve receding into depth (front row = the exact daily curve,
  // rows behind it = progressively smoother trend) and the daily line with
  // glowing nodes and drop lines in front.
  // =====================================================================
  var PW = 10, PH = 4.2, PD = 3.1, Z0 = 0.55;
  // The glass panel the chart sits behind, and the back wall of its box.
  var P_X0 = -PW / 2 - 1.35, P_X1 = PW / 2 + 0.75, P_Y0 = -0.95, P_Y1 = PH + 1.75, P_ZF = -0.85, P_ZB = PD + 0.3;

  function CumulativePnl(container, fmt){
    this.fmt = fmt || {};
    View.call(this, container, {
      home: { yaw: -0.5, pitch: 0.27, dist: 17.5 },
      yawMin: -1.3, yawMax: 1.3, pitchMin: -0.12, pitchMax: 1.25, distMin: 8, distMax: 34,
      introDur: 1700
    });
    if (this.ok){ this.cam.tx = -0.1; this.cam.ty = PH * 0.55; this.cam.tz = PD * 0.5; }
  }
  CumulativePnl.prototype = Object.create(View.prototype);
  CumulativePnl.prototype.bounds = function(){
    var pts = [];
    [P_X0, P_X1].forEach(function(x){ [P_Y0, P_Y1].forEach(function(y){ pts.push([x, y, P_ZF]); }); });
    return pts;
  };
  CumulativePnl.prototype.margins = function(){
    return this.focused ? [12, 12, 8, 8] : [6, 6, 4, 4];
  };

  function niceTicks(lo, hi, count){
    if (hi - lo < 1){ hi = lo + 100; }
    var raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.floor(lo / step) * step; v <= hi + step * 0.5; v += step){
      out.push(Math.round(v / step) * step);
      if (v >= hi) break;
    }
    if (out.length < 2) out.push(out[0] + step);
    return out;
  }
  function gaussSmooth(a, sigma){
    var n = a.length, out = new Float64Array(n), rad = Math.ceil(sigma * 3), k = [];
    for (var t = -rad; t <= rad; t++) k.push(Math.exp(-t * t / (2 * sigma * sigma)));
    for (var i = 0; i < n; i++){
      var s = 0, ws = 0;
      for (var u = -rad; u <= rad; u++){
        var idx = i + u;
        if (idx < 0 || idx >= n) continue;
        s += a[idx] * k[u + rad]; ws += k[u + rad];
      }
      out[i] = s / ws;
    }
    return out;
  }
  function buildTerrain(S, maxCols, rows){
    var N = S.length - 1;
    var M = Math.max(2, Math.min(maxCols, N + 1));
    var base = new Float64Array(M), u = new Float64Array(M);
    for (var m = 0; m < M; m++){
      var pos = (m / (M - 1)) * N, i0 = Math.floor(pos), i1 = Math.min(N, i0 + 1);
      u[m] = pos;
      base[m] = S[i0] + (S[i1] - S[i0]) * (pos - i0);
    }
    var out = [];
    for (var j = 0; j < rows; j++){
      var sigma = j * M / 30;
      out.push(sigma < 0.35 ? base : gaussSmooth(base, sigma));
    }
    return { u: u, rows: out, M: M };
  }
  function parseDay(s){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function xTicks(points, maxTicks){
    var n = points.length;
    if (!n) return [];
    var a = parseDay(points[0].date), b = parseDay(points[n - 1].date);
    var ticks = [];
    var spanDays = a && b ? (Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 864e5 : 0;
    if (spanDays >= 45){
      var prev = null;
      points.forEach(function(p, k){
        var key = (p.date || "").slice(0, 7), pd = parseDay(p.date);
        if (pd && key !== prev){ ticks.push({ i: k + 1, label: MONTHS[pd.m] }); prev = key; }
      });
      if (ticks.length > maxTicks){
        var step = Math.ceil(ticks.length / maxTicks);
        ticks = ticks.filter(function(_, k){ return k % step === 0; });
      }
    } else {
      var count = Math.min(n, maxTicks);
      for (var c = 0; c < count; c++){
        var k2 = count > 1 ? Math.round(c * (n - 1) / (count - 1)) : 0;
        var pd2 = parseDay(points[k2].date);
        if (pd2) ticks.push({ i: k2 + 1, label: MONTHS[pd2.m] + " " + pd2.d });
      }
    }
    return ticks;
  }

  CumulativePnl.prototype.prepare = function(){
    var pts = (this.data && this.data.points) || [];
    var S = [0].concat(pts.map(function(p){ return p.cum; }));
    var lo = Math.min.apply(null, S), hi = Math.max.apply(null, S);
    this.S = S;
    this.ticks = niceTicks(lo, hi, this.focused ? 5 : 4);
    this.axisMin = this.ticks[0];
    this.axisMax = this.ticks[this.ticks.length - 1];
    this.xt = xTicks(pts, this.focused ? 8 : 5);
    this.terrain = buildTerrain(S, this.focused ? 120 : 64, this.focused ? 13 : 8);
    this.fit = null;
  };

  CumulativePnl.prototype.draw = function(time){
    var ctx = this.begin(), d = this.data, cam = this.cam, self = this;
    if (!d || this.w < 2 || !this.S) return;
    var focused = this.focused, S = this.S, N = S.length - 1, ter = this.terrain;
    var axisMin = this.axisMin, axisSpan = (this.axisMax - this.axisMin) || 1;
    function P(x, y, z){ return cam.project(x, y, z); }
    function yOf(v){ return (v - axisMin) / axisSpan * PH; }
    function xOf(i){ return N > 0 ? -PW / 2 + (i / N) * PW : 0; }
    var reveal = this.intro;

    // ---- Chart box: back wall and left side lines at each value tick,
    // floor grid.
    var ZB = P_ZB, hasNeg = axisMin < 0;
    this.ticks.forEach(function(t){
      var y = yOf(t), isZero = t === 0 && hasNeg;
      pathLine(ctx, P(-PW / 2, y, ZB), P(PW / 2, y, ZB));
      glowStroke(ctx, CYAN, 1, isZero ? 0.32 : 0.11, false);
      pathLine(ctx, P(-PW / 2, y, 0), P(-PW / 2, y, ZB));
      glowStroke(ctx, CYAN, 1, isZero ? 0.2 : 0.07, false);
    });
    pathLine(ctx, P(-PW / 2, 0, ZB), P(-PW / 2, PH, ZB));
    glowStroke(ctx, CYAN, 1, 0.14, false);
    pathLine(ctx, P(PW / 2, 0, ZB), P(PW / 2, PH, ZB));
    glowStroke(ctx, CYAN, 1, 0.1, false);
    var floorFront = P(-PW / 2, 0, 0);
    [0, PD / 3, PD * 2 / 3, ZB].forEach(function(z){
      pathLine(ctx, P(-PW / 2, 0, z), P(PW / 2, 0, z));
      glowStroke(ctx, CYAN, 1, 0.1, false);
    });
    this.xt.forEach(function(t){
      var x = xOf(t.i);
      pathLine(ctx, P(x, 0, 0), P(x, 0, ZB));
      glowStroke(ctx, CYAN, 1, 0.08, false);
    });
    if (hasNeg){
      // Zero line across the front.
      ctx.save();
      ctx.setLineDash([4, 4]);
      pathLine(ctx, P(-PW / 2, yOf(0), 0), P(PW / 2, yOf(0), 0));
      glowStroke(ctx, ICE, 1, 0.22, false);
      ctx.restore();
    }

    if (!N){
      this.drawAxes(P, yOf, xOf, floorFront, 1);
      this.drawGlass(P);
      planeText(this, "No trades in this range", [0, PH * 0.5, 0], [1, 0, 0], [0, 1, 0],
        0.36, "500 {px} " + FONT_MONO, MUTED, 0.9, "center", 0);
      return;
    }

    // ---- Terrain, back rows first. Each row is revealed left to right a
    // little behind the row in front of it.
    var J = ter.rows.length, M = ter.M;
    var rowsP = [];
    for (var j = 0; j < J; j++){
      var z = Z0 + (PD - Z0) * (J > 1 ? j / (J - 1) : 0);
      var limit = clamp(reveal * 1.18 - (j / J) * 0.18, 0, 1) * N;
      var row = ter.rows[j], pts = [], xs = [];
      for (var m = 0; m < M; m++){
        if (ter.u[m] <= limit){
          xs.push(xOf(ter.u[m]));
          pts.push(P(xs[xs.length - 1], yOf(row[m]), z));
        } else {
          if (m > 0){
            var f = (limit - ter.u[m - 1]) / (ter.u[m] - ter.u[m - 1]);
            xs.push(xOf(limit));
            pts.push(P(xs[xs.length - 1], yOf(lerp(row[m - 1], row[m], f)), z));
          }
          break;
        }
      }
      rowsP.push({ z: z, pts: pts, xs: xs });
    }
    ctx.globalCompositeOperation = "lighter";
    for (var s = J - 2; s >= 0; s--){
      var a = rowsP[s].pts, b = rowsP[s + 1].pts;
      if (a.length < 2 || b.length < 2) continue;
      pathPoly(ctx, a.concat(b.slice().reverse()), true);
      ctx.fillStyle = rgba(CYAN, 0.042);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // Front curtain down to the floor.
    var front = rowsP[0].pts;
    if (front.length > 1){
      var lastU = Math.min(N, clamp(reveal * 1.18, 0, 1) * N);
      var fl = P(xOf(lastU), 0, Z0), fr = P(xOf(0), 0, Z0);
      var topY = Math.min.apply(null, front.map(function(p){ return p[1]; }));
      var curtain = ctx.createLinearGradient(0, topY, 0, Math.max(fl[1], fr[1]));
      curtain.addColorStop(0, rgba(CYAN, 0.13));
      curtain.addColorStop(1, rgba(CYAN, 0.01));
      pathPoly(ctx, front.concat([fl, fr]), true);
      ctx.fillStyle = curtain;
      ctx.fill();
    }
    // Column lines (across depth) and the hatched end wall.
    var colStep = Math.max(1, Math.round(M / (focused ? 42 : 26)));
    var minLen = Infinity;
    rowsP.forEach(function(r){ minLen = Math.min(minLen, r.pts.length); });
    for (var cIdx = 0; cIdx < minLen; cIdx += colStep){
      var col = [];
      for (var j2 = 0; j2 < J; j2++) col.push(rowsP[j2].pts[cIdx]);
      pathPoly(ctx, col, false);
      glowStroke(ctx, CYAN, 1, 0.2, false);
    }
    if (minLen > 1){
      var endCol = [], floorCol = [];
      for (var j3 = 0; j3 < J; j3++){
        endCol.push(rowsP[j3].pts[minLen - 1]);
        floorCol.push(P(rowsP[j3].xs[minLen - 1], 0, rowsP[j3].z));
      }
      pathPoly(ctx, endCol, false);
      glowStroke(ctx, CYAN, 1.2, 0.5, true);
      for (var j4 = 0; j4 < J; j4 += focused ? 1 : 2){
        pathLine(ctx, endCol[j4], floorCol[j4]);
        glowStroke(ctx, CYAN, 1, 0.16, false);
      }
    }
    for (var r2 = J - 1; r2 >= 0; r2--){
      var rp = rowsP[r2].pts;
      if (rp.length < 2) continue;
      var depthT = J > 1 ? r2 / (J - 1) : 0;
      pathPoly(ctx, rp, false);
      glowStroke(ctx, CYAN, r2 === 0 ? 1.4 : 1, r2 === 0 ? 0.8 : 0.16 + 0.4 * Math.pow(1 - depthT, 1.6), r2 === 0);
    }

    // ---- The daily line at the front, split by sign at zero crossings.
    var limitLine = clamp(reveal * 1.1, 0, 1) * N;
    var line = [];
    for (var i = 0; i <= N; i++){
      if (i <= limitLine) line.push({ x: xOf(i), v: S[i], i: i });
      else {
        var fr2 = limitLine - (i - 1);
        if (fr2 > 0) line.push({ x: xOf(limitLine), v: lerp(S[i - 1], S[i], fr2), i: limitLine });
        break;
      }
    }
    this.drawLine(line, P, yOf);

    // Drop lines and nodes for each revealed day.
    var nodeEvery = Math.max(1, Math.ceil(N / (focused ? 160 : 70)));
    var dropEvery = Math.max(1, Math.ceil(N / (focused ? 60 : 32)));
    var nodes = [];
    for (var k = 1; k <= N && k <= limitLine + 1e-6; k++){
      var p = P(xOf(k), yOf(S[k]), 0);
      p.k = k;
      nodes.push(p);
      var isLast = k === N;
      var colr = S[k] >= 0 ? GREEN : RED;
      if (k % dropEvery === 0 || isLast){
        var floorP = P(xOf(k), 0, 0);
        var drop = ctx.createLinearGradient(p[0], p[1], floorP[0], floorP[1]);
        drop.addColorStop(0, rgba(colr, 0.42));
        drop.addColorStop(1, rgba(colr, 0.02));
        pathLine(ctx, p, floorP);
        ctx.lineWidth = 1;
        ctx.strokeStyle = drop;
        ctx.stroke();
      }
    }
    var hoverK = this.findHover(nodes);
    var pulse = focused && !REDUCED ? Math.sin(time * 2.4) : 0;
    nodes.forEach(function(p){
      var k2 = p.k, isLast = k2 === N;
      if (k2 % nodeEvery !== 0 && !isLast && k2 !== hoverK) return;
      var colr = S[k2] >= 0 ? GREEN : RED;
      var size = (focused ? 17 : 12) * (isLast ? 1.7 + 0.2 * pulse : 1) * (k2 === hoverK ? 1.6 : 1);
      drawNode(ctx, p, colr, size, focused ? (isLast ? 2.6 : 1.6) : (isLast ? 2 : 1.1));
    });

    // A pulse of light running along the line while focused.
    if (focused && !REDUCED && reveal >= 1 && N > 1){
      var run = (time * 0.2) % 1.4;
      if (run <= 1){
        var at2 = run * N, i0 = Math.floor(at2), i1 = Math.min(N, i0 + 1);
        var v2 = lerp(S[i0], S[i1], at2 - i0);
        drawNode(ctx, P(xOf(at2), yOf(v2), 0), v2 >= 0 ? GREEN : RED, 34, 2.2);
      }
    }

    // Value tag on the latest day.
    if (limitLine >= N && this.fmt.short){
      var lastP = nodes[nodes.length - 1];
      var txt = (S[N] >= 0 ? "+" : "") + this.fmt.short(S[N]);
      ctx.font = "700 " + (focused ? 13 : 11) + "px " + FONT_MONO;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var tw = ctx.measureText(txt).width;
      var tx = clamp(lastP[0] + 12, 4, this.w - tw - 6), ty = clamp(lastP[1] - (focused ? 16 : 12), 10, this.h - 10);
      ctx.fillStyle = rgba(S[N] >= 0 ? GREEN : RED, 0.95);
      ctx.fillText(txt, tx, ty);
    }

    this.drawAxes(P, yOf, xOf, floorFront, easeOut(reveal * 2));
    this.drawGlass(P);
    if (hoverK != null) this.drawTooltip(nodes, hoverK);
  };

  // The glass the chart sits behind: faint tint with a sheen, thin border,
  // glowing corner brackets, the title and a divider under it.
  CumulativePnl.prototype.drawGlass = function(P){
    var ctx = this.ctx, X0 = P_X0, X1 = P_X1, Y0 = P_Y0, Y1 = P_Y1, Z = P_ZF;
    var c00 = P(X0, Y0, Z), c10 = P(X1, Y0, Z), c11 = P(X1, Y1, Z), c01 = P(X0, Y1, Z);
    var glass = ctx.createLinearGradient(c01[0], c01[1], c10[0], c10[1]);
    glass.addColorStop(0, rgba(CYAN, 0.07));
    glass.addColorStop(0.3, rgba(CYAN, 0.02));
    glass.addColorStop(0.38, rgba(CYAN, 0.045));
    glass.addColorStop(0.46, rgba(CYAN, 0.015));
    glass.addColorStop(1, rgba(CYAN, 0.045));
    ctx.globalCompositeOperation = "lighter";
    pathPoly(ctx, [c00, c10, c11, c01], true);
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    glowStroke(ctx, CYAN, 1, 0.36, false);
    var BL = 0.62;
    [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X1, Y1, -1, -1], [X0, Y1, 1, -1]].forEach(function(k){
      pathPoly(ctx, [P(k[0] + BL * k[2], k[1], Z), P(k[0], k[1], Z), P(k[0], k[1] + BL * k[3], Z)], false);
      glowStroke(ctx, CYAN, 2, 0.95, true);
    });
    planeText(this, "Daily Net Cumulative P&L", [X0 + 0.5, Y1 - 0.72, Z], [1, 0, 0], [0, 1, 0],
      0.52, "500 {px} " + FONT_DISPLAY, CYAN, 0.95, "left", 10);
    pathLine(ctx, P(X0 + 0.5, Y1 - 1.0, Z), P(X1 - 0.5, Y1 - 1.0, Z));
    glowStroke(ctx, CYAN, 1, 0.42, false);
  };

  CumulativePnl.prototype.drawLine = function(line, P, yOf){
    var ctx = this.ctx;
    if (line.length < 2) return;
    var segs = { pos: [], neg: [] };
    for (var i = 1; i < line.length; i++){
      var a = line[i - 1], b = line[i];
      if ((a.v < 0) !== (b.v < 0) && a.v !== b.v){
        var t = (0 - a.v) / (b.v - a.v), mid = { x: lerp(a.x, b.x, t), v: 0 };
        segs[a.v < 0 ? "neg" : "pos"].push([a, mid]);
        segs[b.v < 0 ? "neg" : "pos"].push([mid, b]);
      } else {
        segs[(a.v < 0 || (a.v === 0 && b.v < 0)) ? "neg" : "pos"].push([a, b]);
      }
    }
    var width = this.focused ? 2.2 : 1.8;
    [["pos", GREEN], ["neg", RED]].forEach(function(k){
      var list = segs[k[0]];
      if (!list.length) return;
      ctx.beginPath();
      list.forEach(function(s){
        var p0 = P(s[0].x, yOf(s[0].v), 0), p1 = P(s[1].x, yOf(s[1].v), 0);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      });
      ctx.lineCap = "round";
      glowStroke(ctx, k[1], width, 0.95, true);
      ctx.lineCap = "butt";
    });
  };

  CumulativePnl.prototype.drawAxes = function(P, yOf, xOf, floorFront, alpha){
    var ctx = this.ctx, focused = this.focused, fmt = this.fmt;
    if (alpha <= 0) return;
    // Value axis up the front-left edge.
    pathLine(ctx, floorFront, P(-PW / 2, PH, 0));
    glowStroke(ctx, CYAN, 1, 0.42 * alpha, false);
    ctx.font = "500 " + (focused ? 11 : 9.5) + "px " + FONT_MONO;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var self = this;
    this.ticks.forEach(function(t){
      var p = P(-PW / 2, yOf(t), 0), q = P(-PW / 2 - 0.16, yOf(t), 0);
      pathLine(ctx, p, q);
      glowStroke(ctx, CYAN, 1, 0.5 * alpha, false);
      var label = fmt.axis ? fmt.axis(t) : String(t);
      ctx.fillStyle = rgba(t === 0 ? ICE : CYAN, (t === 0 ? 0.85 : 0.72) * alpha);
      ctx.fillText(label, Math.max(q[0] - 6, ctx.measureText(label).width + 4), q[1]);
    });
    // Time axis along the front edge of the floor.
    pathLine(ctx, floorFront, P(PW / 2, 0, 0));
    glowStroke(ctx, CYAN, 1, 0.4 * alpha, false);
    ctx.font = "600 " + (focused ? 11 : 9.5) + "px " + FONT_MONO;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    this.xt.forEach(function(t){
      var x = xOf(t.i), base = P(x, 0, 0), tick = P(x, 0, -0.18), lab = P(x, 0, -0.42);
      pathLine(ctx, base, tick);
      glowStroke(ctx, CYAN, 1, 0.5 * alpha, false);
      ctx.fillStyle = rgba(ICE, 0.7 * alpha);
      ctx.fillText(t.label, clamp(lab[0], 18, self.w - 18), lab[1] + 2);
    });
  };

  CumulativePnl.prototype.findHover = function(nodes){
    if (!this.focused || !this.pointer || this.orbit.dragging || this.intro < 1){
      this.canvas.classList.remove("is-pointing");
      return null;
    }
    var best = null, bestD = 22 * 22, px = this.pointer[0], py = this.pointer[1];
    for (var i = 0; i < nodes.length; i++){
      var dx = nodes[i][0] - px, dy = nodes[i][1] - py, dd = dx * dx + dy * dy;
      if (dd < bestD){ bestD = dd; best = nodes[i].k; }
    }
    this.canvas.classList.toggle("is-pointing", best != null);
    return best;
  };

  CumulativePnl.prototype.drawTooltip = function(nodes, k){
    var ctx = this.ctx, d = this.data, fmt = this.fmt, pt = d.points[k - 1], node = null;
    for (var i = 0; i < nodes.length; i++) if (nodes[i].k === k){ node = nodes[i]; break; }
    if (!pt || !node) return;
    var day = parseDay(pt.date);
    var lines = [
      [day ? MONTHS_LONG[day.m] + " " + day.d + ", " + day.y : pt.date, "600 11px " + FONT_MONO, ICE],
      ["Cumulative " + (fmt.signed ? fmt.signed(pt.cum) : pt.cum), "700 12px " + FONT_MONO, pt.cum >= 0 ? GREEN : RED],
      ["Day " + (fmt.signed ? fmt.signed(pt.day) : pt.day), "500 11px " + FONT_MONO, pt.day >= 0 ? GREEN : RED]
    ];
    var w = 0;
    lines.forEach(function(l){ ctx.font = l[1]; w = Math.max(w, ctx.measureText(l[0]).width); });
    var bw = w + 22, bh = 62;
    var bx = clamp(node[0] - bw / 2, 6, this.w - bw - 6);
    var by = node[1] - bh - 18;
    if (by < 6) by = node[1] + 18;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 9); else ctx.rect(bx, by, bw, bh);
    ctx.fillStyle = "rgba(8,14,28,0.92)";
    ctx.fill();
    glowStroke(ctx, CYAN, 1, 0.55, false);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach(function(l, i){
      ctx.font = l[1];
      ctx.fillStyle = rgba(l[2], 0.95);
      ctx.fillText(l[0], bx + 11, by + 9 + i * 16);
    });
  };

  function make(Ctor){
    return function(container, opts){
      if (!container) return null;
      var view = new Ctor(container, opts);
      return view.ok ? view : null;
    };
  }
  window.EZHolo3D = {
    edgeProfile: make(EdgeProfile),
    cumulativePnl: make(CumulativePnl)
  };
})();
