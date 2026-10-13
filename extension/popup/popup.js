// The toolbar popup. Every change is saved straight away; open charts pick
// it up live (see shared/skins.js). Also opened as a full tab for
// "Upload your own", because a file picker closes the popup.
(function () {
  var IN_TAB = /[?&]tab=/.test(location.search) ||
    (chrome.extension && chrome.extension.getViews && chrome.extension.getViews({ type: "popup" }).indexOf(window) === -1);
  if (IN_TAB) document.body.classList.add("in-tab");

  var $ = function (id) { return document.getElementById(id); };
  var enabledEl = $("enabled");
  var grid = $("grid");
  var fileEl = $("file");
  var uploadNote = $("uploadNote");
  var settings = EZSkins.defaults();
  var custom = null; // { thumb, name } of the user's own file, if any
  var liveThumbs = {};   // liquid chrome and scene stills, made here
  var skinTab = "live";  // which skins the grid shows: "live" or "video"

  var SLIDERS = {
    strength: function (v) { return Math.round(v) + "%"; },
    dim: function (v) { return Math.round(v) + "%"; },
    blur: function (v) { return Math.round(v) + "px"; },
    speed: function (v) { return Number(v).toFixed(2) + "×"; }
  };

  function save() { return EZSkins.save(settings); }

  // ---------- Skins ----------
  function tileFor(skin) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.setAttribute("role", "radio");
    b.setAttribute("data-id", skin.id);
    var thumb = skin.type === "liquid" || skin.type === "scene" ? liveThumbs[skin.id]
      : skin.type === "custom" ? (custom && custom.thumb) : skin.thumb;
    if (skin.type === "custom" && !custom) {
      b.classList.add("empty");
      b.innerHTML = '<span class="plus" aria-hidden="true">+</span>';
    } else if (thumb) {
      var img = document.createElement("img");
      img.src = thumb;
      img.alt = "";
      img.loading = "lazy";
      b.appendChild(img);
    }
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = skin.label;
    b.appendChild(label);
    b.title = skin.type === "custom" && custom ? "Your own: " + custom.name : skin.label;
    return b;
  }
  // Animated skins and videos each get a tab; your own file shows in both.
  function inTab(skin) {
    if (skin.type === "custom") return true;
    return skinTab === "video" ? skin.type === "video" : skin.type !== "video";
  }
  function renderGrid() {
    grid.textContent = "";
    EZSkins.list.filter(inTab).forEach(function (skin) { grid.appendChild(tileFor(skin)); });
    [].forEach.call($("skinTabs").children, function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === skinTab ? "true" : "false");
    });
    markSelected();
  }
  $("skinTabs").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.getAttribute("data-tab") === skinTab) return;
    skinTab = b.getAttribute("data-tab");
    renderGrid();
  });
  function markSelected() {
    [].forEach.call(grid.children, function (t) {
      var on = t.getAttribute("data-id") === settings.skin;
      t.setAttribute("aria-checked", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
  }
  grid.addEventListener("click", function (e) {
    var t = e.target.closest(".tile");
    if (!t) return;
    var id = t.getAttribute("data-id");
    if (id === "custom" && !custom) { startUpload(); return; }
    settings.skin = id;
    markSelected();
    save();
  });
  // Arrow keys move through the skins, like any radio group.
  grid.addEventListener("keydown", function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var tiles = [].slice.call(grid.children);
    var i = tiles.indexOf(document.activeElement);
    var next = tiles[Math.max(0, Math.min(tiles.length - 1, i + keys[e.key]))];
    if (next) { next.focus(); next.click(); }
  });

  // ---------- Your own file ----------
  function startUpload() {
    if (!IN_TAB) {
      // The file picker would close this popup; finish in a tab instead.
      chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html?tab=upload") });
      window.close();
      return;
    }
    fileEl.click();
  }
  $("uploadBtn").addEventListener("click", startUpload);

  function note(text, bad) {
    uploadNote.textContent = text;
    uploadNote.hidden = !text;
    uploadNote.classList.toggle("bad", !!bad);
  }

  // A small still for the tile: the video's frame half a second in, or the image.
  function makeThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var done = function (el, w, h) {
        try {
          var c = document.createElement("canvas");
          var scale = Math.max(240 / w, 150 / h);
          c.width = 240; c.height = 150;
          var ctx = c.getContext("2d");
          ctx.drawImage(el, (240 - w * scale) / 2, (150 - h * scale) / 2, w * scale, h * scale);
          resolve(c.toDataURL("image/jpeg", 0.85));
        } catch (err) {
          resolve("");
        }
        URL.revokeObjectURL(url);
      };
      if (/^video\//.test(file.type)) {
        var v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.onloadeddata = function () { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
        v.onseeked = function () { done(v, v.videoWidth, v.videoHeight); };
        v.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        v.src = url;
      } else {
        var img = new Image();
        img.onload = function () { done(img, img.naturalWidth, img.naturalHeight); };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      }
    });
  }

  fileEl.addEventListener("change", function () {
    var f = fileEl.files && fileEl.files[0];
    fileEl.value = "";
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) { note("That file is over 500 MB. Try a shorter clip.", true); return; }
    note("Saving " + f.name + "…");
    makeThumb(f).then(function (thumb) {
      if (thumb === null) throw new Error("unreadable");
      return EZMedia.setCustom({ blob: f, type: f.type, name: f.name, thumb: thumb }).then(function () {
        custom = { thumb: thumb, name: f.name };
        settings.skin = "custom";
        settings.customVersion = Date.now();
        renderGrid();
        return save();
      });
    }).then(function () {
      note("Saved. It stays on this computer and is now your skin.");
    }, function (err) {
      note(err && err.message === "unreadable"
        ? "Chrome can't play that file. Try an MP4, WebM, GIF, PNG or JPG."
        : "Couldn't save that file. Try a smaller one.", true);
    });
  });

  // ---------- Adjust ----------
  function renderControls() {
    enabledEl.checked = settings.enabled;
    Object.keys(SLIDERS).forEach(function (k) {
      $(k).value = settings[k];
      $(k + "Out").textContent = SLIDERS[k](settings[k]);
    });
    [].forEach.call($("fps").children, function (b) {
      b.setAttribute("aria-checked", Number(b.getAttribute("data-fps")) === settings.fps ? "true" : "false");
    });
  }
  Object.keys(SLIDERS).forEach(function (k) {
    $(k).addEventListener("input", function () {
      settings[k] = Number($(k).value);
      $(k + "Out").textContent = SLIDERS[k](settings[k]);
      save();
    });
  });
  $("fps").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    settings.fps = Number(b.getAttribute("data-fps"));
    renderControls();
    save();
  });
  enabledEl.addEventListener("change", function () {
    settings.enabled = enabledEl.checked;
    save().then(refreshSite);
  });
  $("resetBtn").addEventListener("click", function () {
    var d = EZSkins.defaults();
    ["strength", "dim", "blur", "speed", "fps"].forEach(function (k) { settings[k] = d[k]; });
    renderControls();
    save();
  });

  // ---------- This site ----------
  var tab = null;
  var siteEl = $("site"), siteText = $("siteText"), siteBtn = $("siteBtn"), siteDot = $("siteDot"), tipEl = $("tip");

  function isTradingView(u) { return /(^|\.)tradingview\.com$/.test(u.hostname); }
  function setSite(html, on, button, quiet) {
    siteEl.hidden = false;
    siteText.innerHTML = html;
    siteDot.classList.toggle("on", !!on);
    siteBtn.hidden = !button;
    siteBtn.textContent = button || "";
    siteBtn.classList.toggle("quiet", !!quiet);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function isLight(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return false;
    var n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6;
  }
  function askTab() {
    return chrome.tabs.sendMessage(tab.id, { type: "ez-skin-status" }).catch(function () { return null; });
  }

  function refreshSite() {
    tipEl.hidden = true;
    if (IN_TAB || !tab || !tab.url || !/^https?:/.test(tab.url)) {
      if (!IN_TAB) setSite("Open a <b>TradingView</b> chart to see your skin.", false);
      return;
    }
    var u = new URL(tab.url);
    var listed = settings.sites.indexOf(u.origin) !== -1;
    askTab().then(function (st) {
      var host = esc(u.hostname.replace(/^www\./, ""));
      if (isTradingView(u)) {
        if (!st) setSite("Open a chart on <b>TradingView</b> to see your skin.", false);
        else if (!settings.enabled) setSite("Off on <b>TradingView</b>. Flip the switch.", false);
        else setSite("Skinning your <b>TradingView</b> chart.", true);
      } else if (listed || st) {
        if (!settings.enabled) setSite("Off. Flip the switch to skin <b>" + host + "</b>.", false, "Turn off here", true);
        else if (st && st.charts) setSite("Skinning the chart on <b>" + host + "</b>.", true, "Turn off here", true);
        else setSite("On for <b>" + host + "</b>, waiting for a chart.", false, "Turn off here", true);
      } else {
        setSite("Not on <b>" + host + "</b>.", false, "Turn on here");
      }
      if (st && st.on && isLight(st.base)) {
        tipEl.textContent = "Tip: switch the chart to its dark theme so labels stay readable over the skin.";
        tipEl.hidden = false;
      }
    });
  }

  siteBtn.addEventListener("click", function () {
    if (!tab) return;
    var origin = new URL(tab.url).origin;
    var pattern = origin + "/*";
    if (settings.sites.indexOf(origin) !== -1 || siteBtn.classList.contains("quiet")) {
      settings.sites = settings.sites.filter(function (o) { return o !== origin; });
      save()
        .then(function () { return chrome.permissions.remove({ origins: [pattern] }).catch(function () {}); })
        .then(function () { return chrome.runtime.sendMessage({ type: "ez-skin-site", tabId: tab.id, on: false }); })
        .then(refreshSite);
      return;
    }
    // Saved for next time if Chrome grants the site; otherwise just this visit.
    chrome.permissions.request({ origins: [pattern] }).catch(function () { return false; }).then(function (granted) {
      if (granted && settings.sites.indexOf(origin) === -1) settings.sites.push(origin);
      return save().then(function () {
        return chrome.runtime.sendMessage({ type: "ez-skin-site", tabId: tab.id, on: true, persist: !!granted });
      });
    }).then(function () { setTimeout(refreshSite, 600); });
  });

  // ---------- Start ----------
  EZSkins.list.forEach(function (skin) {
    if (skin.type === "liquid") liveThumbs[skin.id] = EZChrome.still(240, 150);
    else if (skin.type === "scene") liveThumbs[skin.id] = EZScenes.still(skin.id, 240, 150, 0.6);
  });
  Promise.all([
    EZSkins.load(),
    EZMedia.getCustom().catch(function () { return null; }),
    IN_TAB ? Promise.resolve([]) : chrome.tabs.query({ active: true, currentWindow: true })
  ]).then(function (r) {
    settings = r[0];
    if (r[1] && r[1].blob) custom = { thumb: r[1].thumb, name: r[1].name };
    tab = r[2][0] || null;
    var current = EZSkins.byId(settings.skin);
    skinTab = current && current.type === "video" ? "video" : "live";
    renderGrid();
    renderControls();
    refreshSite();
    if (IN_TAB && /tab=upload/.test(location.search)) note("Pick a video (MP4, WebM, MOV), a GIF or an image. It stays on this computer.");
  });
  // The shortcut, or another window, changed something.
  EZSkins.onChange(function (s) {
    var skinChanged = s.skin !== settings.skin;
    var enabledChanged = s.enabled !== settings.enabled;
    settings = s;
    renderControls();
    if (skinChanged) markSelected();
    if (enabledChanged) refreshSite();
  });
})();
