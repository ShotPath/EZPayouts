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
  // Only what the plan covers goes on the chart (EZSkins.applied).
  var pro = false;
  function on(part) { return !!(settings && allowedHere(settings) && EZSkins.applied(settings, pro)[part]); }
  function active() { return on("wall"); }
  function tagsActive() { return on("tags"); }
  function posActive() { return on("pos"); }

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

  // The tag looks use the extension's own typefaces (popup/fonts), given to
  // the chart page under names of their own; it redraws once they load.
  var fontsAdded = false;
  function addFonts() {
    if (fontsAdded) return;
    fontsAdded = true;
    var url = function (f) { return chrome.runtime.getURL("popup/fonts/" + f); };
    var css = document.createElement("style");
    css.id = "ez-tag-fonts";
    css.textContent =
      "@font-face{font-family:'EZ Chakra';font-weight:700;src:url(" + url("chakra-petch-700.woff2") + ") format('woff2');}" +
      "@font-face{font-family:'EZ Plex Sans';font-weight:400 600;src:url(" + url("ibm-plex-sans.woff2") + ") format('woff2');}" +
      "@font-face{font-family:'EZ Plex Mono';font-weight:600;src:url(" + url("ibm-plex-mono-600.woff2") + ") format('woff2');}";
    (document.head || root).appendChild(css);
    if (document.fonts && document.fonts.load) {
      Promise.all(["700 10px 'EZ Chakra'", "600 10px 'EZ Plex Sans'", "600 10px 'EZ Plex Mono'"].map(function (f) {
        return document.fonts.load(f);
      })).then(repaint, function () {});
    }
  }

  function update() {
    var was = root.getAttribute("data-ez-skin") === "on";
    var tagsWas = root.getAttribute("data-ez-tags") || "";
    var tags = tagsActive() ? JSON.stringify(EZSkins.tagTheme(settings)) : "";
    if (tags) addFonts();
    if (tags) root.setAttribute("data-ez-tags", tags);
    else root.removeAttribute("data-ez-tags");
    // The Long/Short Position tool's theme, on its own switch.
    var posWas = root.getAttribute("data-ez-pos") || "";
    var pos = posActive() ? JSON.stringify(EZSkins.posTheme(settings)) : "";
    if (pos) { addFonts(); root.setAttribute("data-ez-pos", pos); }
    else root.removeAttribute("data-ez-pos");
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
    if (was !== (root.getAttribute("data-ez-skin") === "on") || tagsWas !== tags || posWas !== pos) repaint();
  }

  // Charts are built after the page loads and rebuilt when the layout
  // changes; a light check every second keeps the skin in place.
  setInterval(function () { if (active() || tagsActive() || posActive()) update(); }, 1000);
  new MutationObserver(function () { if (layers.size) paintLayers(); })
    .observe(root, { attributes: true, attributeFilter: ["data-ez-chart-bg"] });

  EZSkins.onChange(function (s) { settings = s; update(); });
  EZSkins.onProChange(function (p) { pro = p.pro; if (settings) update(); });
  Promise.all([EZSkins.load(), EZSkins.loadPro()]).then(function (r) { settings = r[0]; pro = r[1].pro; update(); });
  if (window === window.top) chrome.runtime.sendMessage({ type: "ez-pro-check" }).catch(function () {});

  // The popup asks whether this frame has a chart skinned. Frames without
  // a chart stay quiet so the one with it answers.
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || msg.type !== "ez-skin-status") return;
    if (!layers.size && !findHosts().length) return;
    reply({ charts: Math.max(layers.size, findHosts().length), on: layers.size > 0, tags: root.hasAttribute("data-ez-tags"), pos: root.hasAttribute("data-ez-pos"), base: root.getAttribute("data-ez-chart-bg") || "" });
  });

  window.__ezSkinRefresh = update;
})();
