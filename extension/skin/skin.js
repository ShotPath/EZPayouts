// The skin drawn behind a chart (this page runs in an iframe the host
// script places under the chart). Shows the chosen skin, liquid chrome,
// a video, or the user's own file, and applies Dim, Blur, Speed and the
// frame rate. Strength is the iframe's opacity, set by the host.
(function () {
  var stage = document.getElementById("stage");
  var canvas = document.getElementById("chrome");
  var video = document.getElementById("video");
  var image = document.getElementById("image");
  var dim = document.getElementById("dim");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var settings = EZSkins.defaults();
  var shown = null;       // { id, version } of what's on screen
  var showToken = 0;      // drops a custom file that arrives after a newer pick
  var customUrl = null;

  // ---------- Liquid chrome ----------
  // Same pixel budget and step-down as the site's page background.
  var renderer = null, raf = 0;
  var motionMs = 0, lastNow = 0, lastDraw = 0;
  var MAX_PIXELS = 3400000, quality = 1, slowFrames = 0;

  function size() {
    var cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
    var scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (cssW * cssH))) * quality;
    return [Math.max(1, Math.round(cssW * scale)), Math.max(1, Math.round(cssH * scale))];
  }
  function drawChrome() {
    var s = size();
    if (!renderer.draw(motionMs, s[0], s[1])) stopChrome();
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    // Motion advances with real time times Speed, so changing Speed never
    // jumps the picture.
    var dt = lastNow ? Math.min(100, now - lastNow) : 0;
    lastNow = now;
    motionMs += dt * settings.speed;
    var interval = 1000 / settings.fps;
    if (lastDraw && now - lastDraw < interval - 2) return;
    // Draws coming in well under the chosen rate mean the device can't keep
    // up at this resolution: render a little smaller (never below 60%).
    if (lastDraw && now - lastDraw > interval * 1.6) {
      if (++slowFrames > 30 && quality > 0.6) { quality = Math.max(0.6, quality * 0.85); slowFrames = 0; }
    } else if (slowFrames > 0) {
      slowFrames--;
    }
    lastDraw = now;
    drawChrome();
  }
  function startChrome() {
    if (!renderer) renderer = EZChrome.create(canvas, false);
    if (!renderer) {
      // No WebGL: the site's still gradient stand-in.
      stage.style.background = "linear-gradient(125deg, #121317 0%, #34363c 22%, #101114 42%, #3b3d44 63%, #121316 82%, #2a2c31 100%)";
      return;
    }
    canvas.classList.add("show");
    lastNow = 0; lastDraw = 0;
    drawChrome();
    if (!reduced && !raf) raf = requestAnimationFrame(loop);
  }
  function stopChrome() {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.classList.remove("show");
  }

  // ---------- Video / image ----------
  function play() {
    if (reduced || document.hidden) return;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }
  function showVideo(src) {
    video.defaultPlaybackRate = settings.speed;
    video.playbackRate = settings.speed;
    video.src = src;
    video.classList.add("show");
    play();
  }
  // A clip that can't load (offline, say) falls back to the chrome.
  video.addEventListener("error", function () {
    if (!video.getAttribute("src")) return;
    video.classList.remove("show");
    startChrome();
  });

  function clear() {
    stopChrome();
    video.pause();
    video.classList.remove("show");
    video.removeAttribute("src");
    video.load();
    image.classList.remove("show");
    image.removeAttribute("src");
    stage.style.background = "";
    if (customUrl) { URL.revokeObjectURL(customUrl); customUrl = null; }
  }

  function show(id) {
    clear();
    var token = ++showToken;
    var skin = EZSkins.byId(id);
    shown = { id: id, version: settings.customVersion };
    if (skin.type === "video") { showVideo(skin.src); return; }
    if (skin.type !== "custom") { startChrome(); return; }
    EZMedia.getCustom().then(function (rec) {
      if (token !== showToken) return;
      if (!rec || !rec.blob) { startChrome(); return; } // nothing uploaded yet
      customUrl = URL.createObjectURL(rec.blob);
      if (/^video\//.test(rec.type)) {
        showVideo(customUrl);
      } else {
        image.src = customUrl;
        image.classList.add("show");
      }
    }).catch(function () {
      if (token === showToken) startChrome();
    });
  }

  function apply(s) {
    settings = s;
    dim.style.opacity = String(s.dim / 100);
    // Blur softens the edges too; scaling up a touch keeps them filled.
    stage.style.filter = s.blur ? "blur(" + s.blur + "px)" : "";
    stage.style.transform = s.blur ? "scale(" + (1 + s.blur * 0.012).toFixed(3) + ")" : "";
    video.defaultPlaybackRate = s.speed;
    video.playbackRate = s.speed;
    if (!shown || shown.id !== s.skin || (s.skin === "custom" && shown.version !== s.customVersion)) show(s.skin);
  }

  // Motion pauses while the tab is in the background.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      video.pause();
    } else {
      lastNow = 0;
      if (video.classList.contains("show")) play();
    }
  });
  window.addEventListener("resize", function () {
    if (renderer && canvas.classList.contains("show") && !raf) drawChrome();
  });
  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    stopChrome();
  });

  EZSkins.onChange(apply);
  EZSkins.load().then(apply);
})();
