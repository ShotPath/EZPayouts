// Shared site chrome: a top header (brand + NY session clock + account
// widget mount point) and a left sidebar (primary nav). Included as a plain
// <script src="/nav.js"> before account.js on every page — no build step,
// matches the rest of the site. Must run before account.js so the
// #authWidget mount point it creates already exists when account.js
// auto-mounts into it.
(function () {
  "use strict";

  var NAV_ITEMS = [
    {
      slug: "home", href: "/", label: "Home",
      icon: '<path d="M3 9.5 10 3l7 6.5" /><path d="M5 8v8.5a.5.5 0 0 0 .5.5H8v-5h4v5h2.5a.5.5 0 0 0 .5-.5V8" />'
    },
    {
      slug: "lucid", href: "/lucid/", label: "Guide",
      icon: '<circle cx="10" cy="10" r="7" /><path d="M12.6 7.4 8.8 8.8l-1.4 3.8 3.8-1.4z" />'
    },
    {
      slug: "compare", href: "/compare/", label: "Compare",
      icon: '<rect x="3.5" y="9" width="4.5" height="7.5" rx="1" /><rect x="12" y="4.5" width="4.5" height="12" rx="1" />'
    },
    {
      slug: "backtest", href: "/backtest/", label: "Backtest",
      icon: '<path d="M3.5 16.5V4M3.5 16.5H17" /><path d="m5.5 13 3-3.5 2.5 2 4-5" />'
    },
    {
      slug: "news", href: "/news/", label: "News",
      icon: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5" /><path d="M6.5 7h7M6.5 10h7M6.5 13h4" />'
    }
  ];

  function detectActiveSlug() {
    var path = window.location.pathname;
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var slug = NAV_ITEMS[i].slug;
      if (slug === "home") continue;
      if (path.indexOf("/" + slug) === 0 || path.indexOf("/" + slug + "/") !== -1) return slug;
    }
    return "home";
  }

  function ensureStyles() {
    if (document.getElementById("ezNavStyles")) return;
    var style = document.createElement("style");
    style.id = "ezNavStyles";
    style.textContent = "" +
      ":root{ --ez-header-h:60px; --ez-sidebar-w:212px; }" +
      "@media (max-width:760px){ :root{ --ez-sidebar-w:56px; } }" +
      "body{ padding-top:var(--ez-header-h); padding-left:var(--ez-sidebar-w); }" +

      ".ez-header{ position:fixed; top:0; left:0; right:0; z-index:500; height:var(--ez-header-h);" +
      " display:flex; align-items:center; justify-content:space-between; gap:16px;" +
      " padding:0 20px; background:var(--panel-raised); border-bottom:1px solid var(--hairline-bright);" +
      " box-shadow:0 10px 30px -20px var(--phosphor-glow); }" +
      ".ez-brand{ display:flex; align-items:center; flex:none; text-decoration:none; }" +
      ".ez-brand img{ width:32px; height:32px; object-fit:contain; }" +
      ".ez-header-right{ display:flex; align-items:center; gap:12px; flex:none; }" +

      ".market-status{ display:inline-flex; align-items:center; gap:4px; white-space:nowrap;" +
      " padding:2px 7px 2px 6px; border-radius:999px; background:var(--panel); border:1px solid var(--hairline); }" +
      ".market-status .dot{ width:5px; height:5px; border-radius:50%; flex:none; animation:ez-pulse-dot 2.2s ease-in-out infinite; }" +
      "@keyframes ez-pulse-dot{ 0%,100%{ opacity:1; } 50%{ opacity:0.35; } }" +
      ".market-status .label{ font-weight:700; letter-spacing:0.02em; font-size:8px; }" +
      ".market-status strong{ font-size:9.5px; }" +
      ".market-status.open{ background:rgba(62,224,140,0.12); border-color:var(--phosphor-dim); }" +
      ".market-status.open .dot{ background:var(--phosphor); box-shadow:0 0 8px 2px var(--phosphor-glow); }" +
      ".market-status.open .label{ color:var(--phosphor-soft); }" +
      ".market-status.closed{ background:rgba(239,90,90,0.10); border-color:var(--red,#ef5a5a); }" +
      ".market-status.closed .dot{ background:var(--red,#ef5a5a); box-shadow:0 0 8px 2px var(--red-glow,rgba(239,90,90,0.5)); }" +
      ".market-status.closed .label{ color:var(--red,#ef5a5a); }" +
      ".market-status.open strong{ color:var(--phosphor-soft); font-weight:600; }" +
      ".market-status.closed strong{ color:var(--red,#ef5a5a); font-weight:600; }" +
      "@media (max-width:520px){ .market-status .label{ display:none; } }" +

      ".ez-sidebar{ position:fixed; top:var(--ez-header-h); left:0; bottom:0; z-index:400; width:var(--ez-sidebar-w);" +
      " overflow-y:auto; background:var(--panel-raised); border-right:1px solid var(--hairline-bright);" +
      " padding:14px 10px; display:flex; flex-direction:column; gap:2px; }" +
      ".ez-sidebar-link{ display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;" +
      " color:var(--muted); text-decoration:none; font-family:var(--font-display); font-weight:600; font-size:13.5px;" +
      " white-space:nowrap; overflow:hidden; transition:background .15s, color .15s; }" +
      ".ez-sidebar-link:hover{ color:var(--ice); background:var(--panel); }" +
      ".ez-sidebar-link.active{ color:var(--mint-text); background:var(--mint); }" +
      ".ez-sidebar-icon{ flex:none; width:20px; height:20px; }" +
      ".ez-sidebar-icon svg{ width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }" +
      ".ez-sidebar-label{ overflow:hidden; text-overflow:ellipsis; }" +
      "@media (max-width:760px){" +
      "  .ez-sidebar-link{ justify-content:center; padding:12px 0; }" +
      "  .ez-sidebar-label{ display:none; }" +
      "}";
    document.head.appendChild(style);
  }

  function buildHeader() {
    var header = document.createElement("header");
    header.className = "ez-header";
    header.innerHTML = "" +
      '<a class="ez-brand" href="/" aria-label="EZPayouts home">' +
        '<img src="/ezpayouts-icon-only.png" alt="EZ" />' +
      "</a>" +
      '<div class="ez-header-right">' +
        '<span class="market-status" id="marketStatus">' +
          '<span class="dot" aria-hidden="true"></span>' +
          '<span class="label mono" id="marketLabel">NY OPEN IN</span>' +
          '<strong class="mono" id="marketOpenIn">--:--:--</strong>' +
        "</span>" +
        '<div id="authWidget"></div>' +
      "</div>";
    return header;
  }

  function buildSidebar(activeSlug) {
    var nav = document.createElement("nav");
    nav.className = "ez-sidebar";
    nav.setAttribute("aria-label", "Primary");
    nav.innerHTML = NAV_ITEMS.map(function (item) {
      return '<a class="ez-sidebar-link' + (item.slug === activeSlug ? " active" : "") + '" href="' + item.href + '">' +
        '<span class="ez-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 20 20">' + item.icon + "</svg></span>" +
        '<span class="ez-sidebar-label">' + item.label + "</span>" +
      "</a>";
    }).join("");
    return nav;
  }

  // ---------- NY session clock (shared across pages) ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MARKET_OPEN_SEC = 9 * 3600 + 30 * 60;
  var MARKET_CLOSE_SEC = 16 * 3600 + 15 * 60;

  function startClock() {
    var marketStatusEl = document.getElementById("marketStatus");
    var marketLabelEl = document.getElementById("marketLabel");
    var marketOpenInEl = document.getElementById("marketOpenIn");
    if (!marketStatusEl) return;

    function tick() {
      var nyParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour12: false, weekday: "short",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }).formatToParts(new Date());
      var h = 0, m = 0, s = 0, weekday = "Sun";
      nyParts.forEach(function (p) {
        if (p.type === "hour") h = parseInt(p.value, 10) % 24;
        if (p.type === "minute") m = parseInt(p.value, 10);
        if (p.type === "second") s = parseInt(p.value, 10);
        if (p.type === "weekday") weekday = p.value;
      });
      var weekdayIdx = WEEKDAYS.indexOf(weekday);
      var nowSec = h * 3600 + m * 60 + s;
      var isWeekday = weekdayIdx >= 1 && weekdayIdx <= 5;
      var isOpen = isWeekday && nowSec >= MARKET_OPEN_SEC && nowSec < MARKET_CLOSE_SEC;

      if (isOpen) {
        marketStatusEl.classList.add("open");
        marketStatusEl.classList.remove("closed");
        marketLabelEl.textContent = "NY Closes";
        var closeDiff = MARKET_CLOSE_SEC - nowSec;
        var ch = Math.floor(closeDiff / 3600);
        var cm = Math.floor((closeDiff % 3600) / 60);
        var cs = closeDiff % 60;
        marketOpenInEl.textContent = pad(ch) + ":" + pad(cm) + ":" + pad(cs);
        return;
      }

      marketStatusEl.classList.remove("open");
      marketStatusEl.classList.add("closed");
      marketLabelEl.textContent = "NY Opens";

      var daysToAdd;
      if (isWeekday && nowSec < MARKET_OPEN_SEC) {
        daysToAdd = 0;
      } else {
        daysToAdd = 1;
        var nextIdx = (weekdayIdx + 1) % 7;
        while (nextIdx === 0 || nextIdx === 6) {
          daysToAdd++;
          nextIdx = (nextIdx + 1) % 7;
        }
      }

      var diff = daysToAdd * 86400 - nowSec + MARKET_OPEN_SEC;
      var label;
      if (diff >= 86400) {
        var days = Math.floor(diff / 86400);
        var hrs = Math.floor((diff % 86400) / 3600);
        var mins = Math.floor((diff % 3600) / 60);
        label = days + "d " + pad(hrs) + "h " + pad(mins) + "m";
      } else {
        var hh = Math.floor(diff / 3600);
        var mm = Math.floor((diff % 3600) / 60);
        var ss = diff % 60;
        label = pad(hh) + ":" + pad(mm) + ":" + pad(ss);
      }
      marketOpenInEl.textContent = label;
    }
    tick();
    setInterval(tick, 1000);
  }

  ensureStyles();
  var header = buildHeader();
  var sidebar = buildSidebar(detectActiveSlug());
  document.body.insertBefore(sidebar, document.body.firstChild);
  document.body.insertBefore(header, document.body.firstChild);
  startClock();
})();
