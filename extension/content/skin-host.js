// Runs on chart pages (TradingView, plus any site the user turned it on
// for). Finds the chart area, places the skin behind it, and turns the
// page hook on (data-ez-skin) so the chart's own background goes
// see-through. The skin itself is an extension page in an iframe
// (skin/skin.html): it draws on its own, so this script only places it
// and sets Strength and the base color. Order tags are separate: with
// them on, data-ez-tags hands the page hook the tag theme, whether or not
// the wallpaper is on.
(function () {
  if (window.__ezSkinHost) return;
  window.__ezSkinHost = true;

  var root = document.documentElement;
  // By origin, so a chart frame loaded from a blob: URL counts as its site.
  var TRADINGVIEW = /(^|\.)tradingview(-widget)?\.com$/.test((function () {
    try { return new URL(location.origin).hostname; } catch (err) { return location.hostname; }
  })());
  var DEFAULT_BASE = "#131722"; // TradingView's dark chart background
  var settings = null;
  var layers = new Map(); // host element -> { layer, frame }

  var style = document.createElement("style");
  style.id = "ez-skin-style";
  style.textContent =
    // The chart's own wrappers go clear so the layer underneath shows.
    "html[data-ez-skin=\"on\"] .ez-skin-host .chart-container," +
    "html[data-ez-skin=\"on\"] .ez-skin-host .chart-container-border," +
    "html[data-ez-skin=\"on\"] .ez-skin-host .chart-widget," +
    "html[data-ez-skin=\"on\"] .ez-skin-host .chart-markup-table," +
    "html[data-ez-skin=\"on\"] .ez-skin-host .tv-lightweight-charts{ background:transparent !important; }" +
    // Its own stacking context, so the layer (z-index -1) sits above the
    // host's background but under everything the chart draws.
    ".ez-skin-host{ isolation:isolate; }" +
    ".ez-skin-layer{ position:absolute; inset:0; z-index:-1; pointer-events:none; overflow:hidden;" +
    " background:var(--ez-skin-base, " + DEFAULT_BASE + "); }" +
    ".ez-skin-layer > iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; display:block;" +
    " pointer-events:none; background:transparent; color-scheme:normal; transition:opacity .2s; }";

  function allowedHere(s) {
    return TRADINGVIEW || window.__ezSkinForce === true || s.sites.indexOf(location.origin) !== -1;
  }
  function active() { return !!(settings && settings.enabled && allowedHere(settings)); }
  function tagsActive() { return !!(settings && settings.tagsEnabled && allowedHere(settings)); }

  // The area every chart in the layout sits in; one skin behind them all.
  function findHosts() {
    var list = [].slice.call(document.querySelectorAll(".layout__area--center"));
    if (!list.length) list = [].slice.call(document.querySelectorAll(".chart-container"));
    if (!list.length) {
      list = [].slice.call(document.querySelectorAll(".tv-lightweight-charts"))
        .map(function (el) { return el.parentElement; }).filter(Boolean);
    }
    return list.filter(function (el) { return el.offsetWidth > 40 && el.offsetHeight > 40; });
  }

  function attach(host) {
    if (layers.has(host)) return;
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
      host.setAttribute("data-ez-skin-pos", "");
    }
    host.classList.add("ez-skin-host");
    var layer = document.createElement("div");
    layer.className = "ez-skin-layer";
    var frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("skin/skin.html");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("allow", "autoplay");
    frame.title = "Chart skin";
    layer.appendChild(frame);
    host.insertBefore(layer, host.firstChild);
    layers.set(host, { layer: layer, frame: frame });
  }

  function detach(host) {
    var l = layers.get(host);
    if (!l) return;
    l.layer.remove();
    host.classList.remove("ez-skin-host");
    if (host.hasAttribute("data-ez-skin-pos")) {
      host.style.position = "";
      host.removeAttribute("data-ez-skin-pos");
    }
    layers.delete(host);
  }

  // Ask the chart to draw again (it repaints on resize), so turning the
  // skin on or off shows at once instead of on the next price tick.
  function repaint() {
    window.dispatchEvent(new Event("resize"));
  }

  function paintLayers() {
    var base = root.getAttribute("data-ez-chart-bg") || DEFAULT_BASE;
    layers.forEach(function (l) {
      l.layer.style.setProperty("--ez-skin-base", base);
      l.frame.style.opacity = String(settings.strength / 100);
    });
  }

  function update() {
    var was = root.getAttribute("data-ez-skin") === "on";
    var tagsWas = root.getAttribute("data-ez-tags") || "";
    var tags = tagsActive() ? JSON.stringify(EZSkins.tagTheme(settings)) : "";
    if (tags) root.setAttribute("data-ez-tags", tags);
    else root.removeAttribute("data-ez-tags");
    if (active()) {
      if (!style.isConnected) (document.head || root).appendChild(style);
      layers.forEach(function (l, host) { if (!host.isConnected) detach(host); });
      findHosts().forEach(attach);
      if (layers.size) root.setAttribute("data-ez-skin", "on");
      else root.removeAttribute("data-ez-skin");
      paintLayers();
    } else {
      layers.forEach(function (l, host) { detach(host); });
      root.removeAttribute("data-ez-skin");
      style.remove();
    }
    if (was !== (root.getAttribute("data-ez-skin") === "on") || tagsWas !== tags) repaint();
  }

  // Charts are built after the page loads and rebuilt when the layout
  // changes; a light check every second keeps the skin in place.
  setInterval(function () { if (active() || tagsActive()) update(); }, 1000);
  new MutationObserver(function () { if (layers.size) paintLayers(); })
    .observe(root, { attributes: true, attributeFilter: ["data-ez-chart-bg"] });

  EZSkins.onChange(function (s) { settings = s; update(); });
  EZSkins.load().then(function (s) { settings = s; update(); });

  // The popup asks whether this frame has a chart skinned. Frames without
  // a chart stay quiet so the one with it answers.
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || msg.type !== "ez-skin-status") return;
    if (!layers.size && !findHosts().length) return;
    reply({ charts: Math.max(layers.size, findHosts().length), on: layers.size > 0, tags: root.hasAttribute("data-ez-tags"), base: root.getAttribute("data-ez-chart-bg") || "" });
  });

  window.__ezSkinRefresh = update;
})();
