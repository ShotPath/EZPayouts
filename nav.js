// Shared site chrome: a top header (brand + current page name + NY session
// clock + account widget mount point) and a left sidebar (primary nav, with
// an expanded/collapsed/expand-on-hover control). Included as a plain
// <script src="/nav.js"> before account.js on every page — no build step,
// matches the rest of the site. Must run before account.js so the
// #authWidget mount point it creates already exists when account.js
// auto-mounts into it.
(function () {
  "use strict";

  var SIDEBAR_MODE_KEY = "ezpayouts.sidebarMode";
  var SIDEBAR_MODES = ["expanded", "collapsed", "hover"];
  var SIDEBAR_MODE_LABELS = { expanded: "Expanded", collapsed: "Collapsed", hover: "Expand on hover" };

  // Theme: swaps the dark undertone + accent/text tokens site-wide. Loss
  // (--red) and warning (--amber) stay fixed across themes since they carry
  // financial meaning the reskin shouldn't touch — only the background
  // undertone, accent/brand color, and main text tones change.
  var THEME_KEY = "ezpayouts.theme";
  var THEMES = ["green", "ink", "red", "magenta"];
  var THEME_LABELS = { green: "Green", ink: "Inked Japan", red: "Red", magenta: "Magenta" };
  var THEME_SWATCHES = { green: "#3ee08c", ink: "#7b86d9", red: "#d4323f", magenta: "#d63f9d" };
  var THEME_ICON = '<path d="M10 3.2c-3.9 0-7 2.9-7 6.5 0 3.4 2.9 6.3 6.6 6.3.6 0 1.1-.4 1.1-1 0-.3-.1-.5-.3-.7-.2-.2-.3-.4-.3-.7 0-.5.5-1 1.1-1H13c2.2 0 4-1.6 4-3.6 0-3.2-3.1-5.8-7-5.8z" /><circle cx="7.3" cy="8.3" r=".9" fill="currentColor" stroke="none" /><circle cx="10" cy="6.3" r=".9" fill="currentColor" stroke="none" /><circle cx="12.7" cy="8.3" r=".9" fill="currentColor" stroke="none" />';

  function getTheme() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (THEMES.indexOf(stored) !== -1) return stored;
    } catch (err) {}
    return "green";
  }

  function setTheme(theme) {
    if (THEMES.indexOf(theme) === -1) return;
    document.documentElement.setAttribute("data-ez-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
  }

  // The public marketing page. Deliberately NOT in NAV_ITEMS/NAV_SECTIONS —
  // it's reachable only by visiting "/" directly (or the brand logo while
  // already on the marketing page itself), never from inside the app. It's
  // kept here as its own item so detectActiveItem() can still resolve "/"
  // to it correctly (see the explicit fallback below) even though it won't
  // render as a sidebar link.
  var HOME_ITEM = {
    slug: "home", href: "/", label: "Home",
    icon: '<path d="M3 9.5 10 3l7 6.5" /><path d="M5 8v8.5a.5.5 0 0 0 .5.5H8v-5h4v5h2.5a.5.5 0 0 0 .5-.5V8" />'
  };

  // Main flat nav group, rendered first, no divider above it — the app's
  // home base once you're inside the workspace (the brand logo links here
  // too, not back out to the marketing page — see buildHeader).
  var NAV_ITEMS = [
    {
      slug: "dashboard", href: "/dashboard/", label: "Dashboard",
      icon: '<rect x="3" y="3" width="6.5" height="8" rx="1.3" /><rect x="10.5" y="3" width="6.5" height="5" rx="1.3" /><rect x="10.5" y="9.5" width="6.5" height="7.5" rx="1.3" /><rect x="3" y="12.5" width="6.5" height="4.5" rx="1.3" />'
    }
  ];

  // Extra sections, each rendered below a divider (same treatment as the
  // collapse control at the bottom) so they read as separate groups from
  // the main nav above and from each other.
  var NAV_SECTIONS = [
    [
      {
        slug: "journal", href: "/journal/", label: "Journal",
        icon: '<path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M8 6.5h5M8 9.5h5M8 12.5h3" />'
      },
      {
        slug: "backtest", href: "/backtest/", label: "Backtest",
        icon: '<path d="M3.5 16.5V4M3.5 16.5H17" /><path d="m5.5 13 3-3.5 2.5 2 4-5" />'
      }
    ],
    [
      {
        slug: "lucid", href: "/lucid/", label: "Guide",
        icon: '<circle cx="10" cy="10" r="7" /><path d="M12.6 7.4 8.8 8.8l-1.4 3.8 3.8-1.4z" />'
      },
      {
        slug: "compare", href: "/compare/", label: "Compare",
        icon: '<rect x="3.5" y="9" width="4.5" height="7.5" rx="1" /><rect x="12" y="4.5" width="4.5" height="12" rx="1" />'
      },
      {
        slug: "calendar", href: "/calendar/", label: "Calendar",
        icon: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8h14M6.5 2.5v4M13.5 2.5v4" /><circle cx="10" cy="12" r="1.4" fill="currentColor" stroke="none" />'
      }
    ]
  ];

  // Not yet built — rendered in their own visually-muted section at the
  // bottom of the sidebar (non-interactive, no href) so the intended final
  // nav order is visible today without any dead links pretending to be
  // real pages.
  var COMING_SOON_ITEMS = [
    { label: "Accounts", icon: '<path d="M3 6h14v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z" /><path d="M3 6l1.8-2.5h10.4L17 6" /><path d="M8 10h4" />' },
    { label: "Analytics", icon: '<path d="M3.5 16.5V4M3.5 16.5H17" /><rect x="6" y="11" width="2.2" height="4" /><rect x="9.9" y="7.5" width="2.2" height="7.5" /><rect x="13.8" y="9.5" width="2.2" height="5.5" />' },
    { label: "Risk Management", icon: '<path d="M10 2.5 16.5 5.5v4.5c0 4-2.8 6.7-6.5 7.5-3.7-.8-6.5-3.5-6.5-7.5V5.5z" /><path d="m7.5 10 1.8 1.8 3.2-3.6" />' },
    { label: "Mentorship", icon: '<circle cx="10" cy="7" r="3" /><path d="M4 16.5c0-3 2.7-5 6-5s6 2 6 5" />' }
  ];

  var ALL_NAV_ITEMS = NAV_ITEMS.concat(NAV_SECTIONS.reduce(function (acc, section) { return acc.concat(section); }, []));

  var SIDEBAR_TOGGLE_ICON = '<rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M8 3.5v13" />';

  function detectActiveItem() {
    var path = window.location.pathname;
    for (var i = 0; i < ALL_NAV_ITEMS.length; i++) {
      var slug = ALL_NAV_ITEMS[i].slug;
      if (path.indexOf("/" + slug) === 0 || path.indexOf("/" + slug + "/") !== -1) return ALL_NAV_ITEMS[i];
    }
    return HOME_ITEM;
  }

  function getSidebarMode() {
    try {
      var stored = localStorage.getItem(SIDEBAR_MODE_KEY);
      if (SIDEBAR_MODES.indexOf(stored) !== -1) return stored;
    } catch (err) {}
    return "expanded";
  }

  function setSidebarMode(mode) {
    if (SIDEBAR_MODES.indexOf(mode) === -1) return;
    document.body.setAttribute("data-sidebar-mode", mode);
    try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch (err) {}
  }

  function ensureStyles() {
    if (document.getElementById("ezNavStyles")) return;
    var style = document.createElement("style");
    style.id = "ezNavStyles";
    style.textContent = "" +
      ":root{ --ez-header-h:60px; --ez-sidebar-w:212px; --ez-sidebar-collapsed-w:56px; --ez-content-gutter:clamp(16px,4vw,48px); }" +
      // Each page's own .wrap centers itself with margin:auto inside body's
      // content box — but that only adds breathing room once the viewport is
      // wider than sidebar + wrap + gutter. Below that (most real screens),
      // the auto-margin collapses to 0 and cards sit flush against the
      // sidebar with zero gap, while the right side keeps its own gutter.
      // Adding the same gutter to the sidebar's width keeps a real, matching
      // gap on both sides no matter how much leftover room there is.
      "body{ padding-top:var(--ez-header-h); padding-left:calc(var(--ez-sidebar-collapsed-w) + var(--ez-content-gutter)); transition:padding-left .18s ease; }" +
      "body[data-sidebar-mode=\"expanded\"]{ padding-left:calc(var(--ez-sidebar-w) + var(--ez-content-gutter)); }" +

      ".ez-header{ position:fixed; top:0; left:0; right:0; z-index:500; height:var(--ez-header-h);" +
      " display:flex; align-items:center; justify-content:space-between; gap:16px;" +
      " padding:0 20px; background:var(--panel-raised); border-bottom:1px solid var(--hairline-bright);" +
      " box-shadow:0 10px 30px -20px var(--phosphor-glow); }" +
      ".ez-brand-group{ display:flex; align-items:center; gap:10px; flex:none; min-width:0; }" +
      ".ez-brand{ display:flex; align-items:center; gap:8px; flex:none; text-decoration:none; }" +
      ".ez-brand img{ width:30px; height:30px; object-fit:contain; }" +
      ".ez-page-sep{ color:var(--hairline-bright); font-size:16px; }" +
      ".ez-page-title{ font-family:var(--font-display); font-weight:600; font-size:15px; color:var(--muted);" +
      " overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }" +
      ".ez-header-right{ display:flex; align-items:center; gap:12px; flex:none; }" +

      ".market-status{ display:inline-flex; align-items:center; gap:7px; white-space:nowrap;" +
      " padding:6px 12px; border-radius:999px; background:var(--panel); border:1px solid var(--hairline); }" +
      ".market-status .dot{ width:7px; height:7px; border-radius:50%; flex:none; animation:ez-pulse-dot 2.2s ease-in-out infinite; }" +
      "@keyframes ez-pulse-dot{ 0%,100%{ opacity:1; } 50%{ opacity:0.35; } }" +
      ".market-status .label{ font-weight:700; letter-spacing:0.02em; font-size:11px; }" +
      ".market-status strong{ font-size:14px; }" +
      ".market-status.open{ background:rgba(62,224,140,0.12); border-color:var(--phosphor-dim); }" +
      ".market-status.open .dot{ background:var(--phosphor); box-shadow:0 0 8px 2px var(--phosphor-glow); }" +
      ".market-status.open .label{ color:var(--phosphor-soft); }" +
      ".market-status.closed{ background:rgba(239,90,90,0.10); border-color:var(--red,#ef5a5a); }" +
      ".market-status.closed .dot{ background:var(--red,#ef5a5a); box-shadow:0 0 8px 2px var(--red-glow,rgba(239,90,90,0.5)); }" +
      ".market-status.closed .label{ color:var(--red,#ef5a5a); }" +
      ".market-status.open strong{ color:var(--phosphor-soft); font-weight:600; }" +
      ".market-status.closed strong{ color:var(--red,#ef5a5a); font-weight:600; }" +
      "@media (max-width:560px){ .market-status .label{ display:none; } }" +

      ".ez-sidebar{ position:fixed; top:var(--ez-header-h); left:0; bottom:0; z-index:400; width:var(--ez-sidebar-collapsed-w);" +
      " overflow-x:hidden; overflow-y:auto; background:var(--panel-raised); border-right:1px solid var(--hairline-bright);" +
      " padding:14px 10px; display:flex; flex-direction:column; gap:2px; transition:width .18s ease, box-shadow .18s ease; }" +
      "body[data-sidebar-mode=\"expanded\"] .ez-sidebar{ width:var(--ez-sidebar-w); }" +
      "body[data-sidebar-mode=\"hover\"] .ez-sidebar:hover{ width:var(--ez-sidebar-w); box-shadow:0 20px 50px -12px rgba(0,0,0,0.6); }" +
      ".ez-sidebar-link{ display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;" +
      " color:var(--muted); text-decoration:none; font-family:var(--font-display); font-weight:600; font-size:13.5px;" +
      " white-space:nowrap; overflow:hidden; transition:background .15s, color .15s; }" +
      ".ez-sidebar-link:hover{ color:var(--ice); background:var(--panel); }" +
      ".ez-sidebar-link.active{ color:var(--mint-text); background:var(--mint); }" +
      ".ez-sidebar-link-soon{ color:var(--muted-dim); cursor:default; opacity:0.6; }" +
      ".ez-sidebar-link-soon:hover{ color:var(--muted-dim); background:transparent; }" +
      ".ez-sidebar-link-soon .ez-sidebar-label{ display:flex; align-items:center; gap:7px; }" +
      "body:not([data-sidebar-mode=\"expanded\"]) .ez-sidebar-link-soon .ez-sidebar-label{ display:none; }" +
      ".ez-sidebar-soon-tag{ font-family:var(--font-mono); font-size:8.5px; font-weight:700; letter-spacing:0.05em;" +
      " text-transform:uppercase; color:var(--muted-dim); border:1px solid var(--hairline-bright); border-radius:999px;" +
      " padding:1.5px 6px; flex:none; }" +
      ".ez-sidebar-icon{ flex:none; width:20px; height:20px; }" +
      ".ez-sidebar-icon svg{ width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }" +
      ".ez-sidebar-label{ overflow:hidden; text-overflow:ellipsis; }" +
      "body:not([data-sidebar-mode=\"expanded\"]) .ez-sidebar-label{ display:none; }" +
      "body:not([data-sidebar-mode=\"expanded\"]) .ez-sidebar-link{ justify-content:center; padding:12px 0; }" +
      "body[data-sidebar-mode=\"hover\"] .ez-sidebar:hover .ez-sidebar-label{ display:inline; }" +
      "body[data-sidebar-mode=\"hover\"] .ez-sidebar:hover .ez-sidebar-link{ justify-content:flex-start; padding:10px 12px; }" +

      ".ez-sidebar-section{ display:flex; flex-direction:column; gap:2px;" +
      " border-top:1px solid var(--hairline); padding-top:8px; margin-top:8px; }" +

      ".ez-sidebar-spacer{ flex:1; }" +
      ".ez-sidebar-control{ position:relative; border-top:1px solid var(--hairline); padding-top:10px; margin-top:8px; }" +
      ".ez-sidebar-control-btn{ display:flex; align-items:center; gap:12px; width:100%; padding:10px 12px; border-radius:10px;" +
      " background:transparent; border:none; color:var(--muted); cursor:pointer; font-family:var(--font-mono); font-size:11.5px;" +
      " font-weight:600; white-space:nowrap; overflow:hidden; transition:background .15s, color .15s; }" +
      ".ez-sidebar-control-btn{ justify-content:center; padding:10px 0; }" +
      ".ez-sidebar-control-btn:hover{ color:var(--ice); background:var(--panel); }" +

      ".ez-sidebar-menu{ position:fixed; z-index:600; min-width:190px;" +
      " background:var(--panel-raised); border:1px solid var(--hairline-bright); border-radius:12px; padding:8px;" +
      " box-shadow:0 18px 40px -14px rgba(0,0,0,0.65); }" +
      ".ez-sidebar-menu[hidden]{ display:none; }" +
      ".ez-sidebar-menu-eyebrow{ font-family:var(--font-mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase;" +
      " color:var(--muted-dim); padding:6px 10px 8px; }" +
      ".ez-sidebar-menu-item{ display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 10px;" +
      " border-radius:8px; background:transparent; border:none; color:var(--muted); cursor:pointer; transition:background .15s, color .15s;" +
      " font-family:var(--font-display); font-weight:600; font-size:13px; }" +
      ".ez-sidebar-menu-item:hover{ background:var(--panel); color:var(--ice); }" +
      ".ez-sidebar-menu-item .dot{ width:7px; height:7px; border-radius:50%; flex:none; background:transparent;" +
      " border:1px solid var(--hairline-bright); }" +
      ".ez-sidebar-menu-item.selected{ color:var(--ice); }" +
      ".ez-sidebar-menu-item.selected .dot{ background:var(--mint); border-color:var(--mint); box-shadow:0 0 8px 1px rgba(62,224,140,0.5); }" +

      "@media (max-width:760px){" +
      "  body{ padding-left:calc(var(--ez-sidebar-collapsed-w) + 12px) !important; }" +
      "  .ez-sidebar{ width:var(--ez-sidebar-collapsed-w) !important; box-shadow:none !important; }" +
      "  .ez-sidebar-label{ display:none !important; }" +
      "  .ez-sidebar-link{ justify-content:center !important; padding:12px 0 !important; }" +
      "}" +

      // Welcome-page pill nav: no fixed header/sidebar chrome at all, just a
      // rounded top bar that scrolls with the page, matching the width of
      // the page's own .wrap content column.
      "body.ez-pill-mode{ padding-top:0 !important; padding-left:0 !important; }" +
      ".ez-topbar{ display:flex; align-items:center; gap:16px;" +
      " max-width:1080px; margin:0 auto 28px; padding:10px 22px 10px 14px;" +
      " background:var(--panel-raised); border:1px solid var(--hairline-bright);" +
      " border-radius:999px; box-shadow:0 18px 44px -24px var(--phosphor-glow); }" +
      ".ez-topbar .ez-brand img{ width:34px; height:34px; }" +
      ".ez-topbar-links{ display:flex; align-items:center; justify-content:center; flex:1; min-width:0; gap:clamp(14px,2.4vw,28px); }" +
      ".ez-topbar-links a{ font-family:var(--font-display); font-weight:600; font-size:13.5px;" +
      " color:var(--muted); text-decoration:none; letter-spacing:0.01em; white-space:nowrap; transition:color .15s; }" +
      ".ez-topbar-links a:hover{ color:var(--ice); }" +
      ".ez-topbar-links a.active{ color:var(--ice); }" +
      ".ez-topbar-actions{ display:flex; align-items:center; gap:10px; flex:none; }" +
      "@media (max-width:680px){" +
      "  .ez-topbar{ border-radius:22px; flex-wrap:wrap; justify-content:center; padding:14px 18px; }" +
      "  .ez-topbar-links{ flex:1 1 100%; order:2; gap:10px; flex-wrap:wrap; row-gap:6px; }" +
      "  .ez-topbar-actions{ order:3; }" +
      "}" +

      // Theme overrides. html[data-ez-theme] beats a bare :root on
      // specificity, so these win over each page's own default (green)
      // tokens without touching --red/--amber (loss/warning stay fixed).
      "html[data-ez-theme=\"ink\"]{" +
      " --void:#07080c; --panel:#0e1118; --panel-raised:#151926; --panel-hi:#1d2233;" +
      " --hairline:#262b3d; --hairline-bright:#3d4566;" +
      " --phosphor:#7b86d9; --phosphor-soft:#a8b0ec; --phosphor-dim:#363f6e; --phosphor-glow:rgba(123,134,217,0.35);" +
      " --mint:#8d93e0; --mint-text:#0b0d1a;" +
      " --ice:#e4e3f0; --muted:#8a8ca6; --muted-dim:#585a73; }" +
      "html[data-ez-theme=\"red\"]{" +
      " --void:#0a0707; --panel:#150c0c; --panel-raised:#1f1313; --panel-hi:#2a1818;" +
      " --hairline:#3a2020; --hairline-bright:#612c2c;" +
      " --phosphor:#d4323f; --phosphor-soft:#f08a93; --phosphor-dim:#6e1a21; --phosphor-glow:rgba(212,50,63,0.35);" +
      " --mint:#e2525f; --mint-text:#2b0609;" +
      " --ice:#f3dcdc; --muted:#a67f7f; --muted-dim:#6d4f4f; }" +
      "html[data-ez-theme=\"magenta\"]{" +
      " --void:#0a0710; --panel:#150d1c; --panel-raised:#1e1327; --panel-hi:#281a33;" +
      " --hairline:#3a2748; --hairline-bright:#5c3a74;" +
      " --phosphor:#d63f9d; --phosphor-soft:#ef8fc7; --phosphor-dim:#6e1e52; --phosphor-glow:rgba(214,63,157,0.35);" +
      " --mint:#e06bb8; --mint-text:#2b0a1f;" +
      " --ice:#ede3f2; --muted:#9586a8; --muted-dim:#645271; }";
    document.head.appendChild(style);
  }

  function buildTopbar(activeSlug) {
    var topbar = document.createElement("header");
    topbar.className = "ez-topbar";
    topbar.innerHTML = "" +
      '<a class="ez-brand" href="/" aria-label="EZPayouts home">' +
        '<img src="/ezpayouts-icon-only.png" alt="EZ" />' +
      "</a>" +
      '<nav class="ez-topbar-links" aria-label="Primary">' +
        [HOME_ITEM].concat(ALL_NAV_ITEMS).map(function (item) {
          return '<a href="' + item.href + '"' + (item.slug === activeSlug ? ' class="active"' : "") + ">" + item.label + "</a>";
        }).join("") +
      "</nav>" +
      '<div class="ez-topbar-actions">' +
        '<span class="market-status" id="marketStatus">' +
          '<span class="dot" aria-hidden="true"></span>' +
          '<span class="label mono" id="marketLabel">NY OPEN IN</span>' +
          '<strong class="mono" id="marketOpenIn">--:--:--</strong>' +
        "</span>" +
        '<div id="authWidget"></div>' +
      "</div>";
    return topbar;
  }

  function buildHeader(activeItem) {
    var header = document.createElement("header");
    header.className = "ez-header";
    header.innerHTML = "" +
      '<div class="ez-brand-group">' +
        // Inside the app the logo stays inside the app — it goes to the
        // Dashboard, not back out to the public marketing page.
        '<a class="ez-brand" href="/dashboard/" aria-label="EZPayouts dashboard">' +
          '<img src="/ezpayouts-icon-only.png" alt="EZ" />' +
        "</a>" +
        '<span class="ez-page-sep" aria-hidden="true">|</span>' +
        '<span class="ez-page-title">' + activeItem.label + "</span>" +
      "</div>" +
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

  // Shared across every ez-sidebar-control instance so opening one closes
  // any other that's already open (they're visually identical popovers).
  var openControlCloser = null;

  // Builds one bottom-of-sidebar icon button that opens a small popover
  // menu of radio-style choices. Used for both the theme switcher and the
  // expanded/collapsed/hover control below it.
  function buildSidebarControl(opts) {
    var wrap = document.createElement("div");
    wrap.className = "ez-sidebar-control";
    wrap.innerHTML =
      '<button type="button" class="ez-sidebar-control-btn" aria-label="' + opts.ariaLabel + '">' +
        '<span class="ez-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 20 20">' + opts.icon + "</svg></span>" +
      "</button>";
    var controlBtn = wrap.querySelector(".ez-sidebar-control-btn");
    var menuEl = null;

    function closeMenu() {
      if (menuEl) { menuEl.remove(); menuEl = null; }
      if (openControlCloser === closeMenu) openControlCloser = null;
    }

    // Appended to <body> (not the sidebar) and positioned with fixed
    // coordinates from the button's own rect, since the sidebar clips its
    // children horizontally (overflow-x:hidden, for the collapse/expand
    // width transition) and would otherwise cut the menu off when collapsed.
    function openMenu() {
      if (openControlCloser) openControlCloser();
      var current = opts.getActive();
      var menu = document.createElement("div");
      menu.className = "ez-sidebar-menu";
      menu.innerHTML = '<div class="ez-sidebar-menu-eyebrow">' + opts.eyebrow + '</div>' +
        opts.items.map(function (item) {
          var selected = item.value === current;
          var dotStyle = item.swatch
            ? ' style="background:' + item.swatch + ';border-color:' + item.swatch + (selected ? ";box-shadow:0 0 8px 1px " + item.swatch : "") + '"'
            : "";
          return '<button type="button" class="ez-sidebar-menu-item' + (selected ? " selected" : "") + '" data-value="' + item.value + '">' +
            '<span class="dot" aria-hidden="true"' + dotStyle + '></span>' + item.label +
          "</button>";
        }).join("");
      menu.querySelectorAll("[data-value]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          opts.onSelect(btn.getAttribute("data-value"));
          closeMenu();
        });
      });
      document.body.appendChild(menu);
      var btnRect = controlBtn.getBoundingClientRect();
      menu.style.left = btnRect.left + "px";
      menu.style.bottom = (window.innerHeight - btnRect.top + 8) + "px";
      menuEl = menu;
      openControlCloser = closeMenu;
    }

    controlBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menuEl) closeMenu();
      else openMenu();
    });
    document.addEventListener("click", function (e) {
      if (menuEl && !e.target.closest(".ez-sidebar-control") && !e.target.closest(".ez-sidebar-menu")) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuEl) closeMenu();
    });

    return wrap;
  }

  function buildSidebar(activeSlug) {
    var nav = document.createElement("nav");
    nav.className = "ez-sidebar";
    nav.setAttribute("aria-label", "Primary");
    function renderLink(item) {
      return '<a class="ez-sidebar-link' + (item.slug === activeSlug ? " active" : "") + '" href="' + item.href + '">' +
        '<span class="ez-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 20 20">' + item.icon + "</svg></span>" +
        '<span class="ez-sidebar-label">' + item.label + "</span>" +
      "</a>";
    }
    // Not a real page yet — rendered inert (no href, reduced opacity, a
    // "Soon" tag) rather than a link that would 404 or silently go nowhere.
    function renderComingSoon(item) {
      return '<span class="ez-sidebar-link ez-sidebar-link-soon" aria-disabled="true">' +
        '<span class="ez-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 20 20">' + item.icon + "</svg></span>" +
        '<span class="ez-sidebar-label">' + item.label + '<span class="ez-sidebar-soon-tag">Soon</span></span>' +
      "</span>";
    }

    nav.innerHTML = NAV_ITEMS.map(renderLink).join("") +
      NAV_SECTIONS.map(function (section) {
        return '<div class="ez-sidebar-section">' + section.map(renderLink).join("") + "</div>";
      }).join("") +
      '<div class="ez-sidebar-section">' + COMING_SOON_ITEMS.map(renderComingSoon).join("") + "</div>" +
      '<span class="ez-sidebar-spacer"></span>';

    nav.appendChild(buildSidebarControl({
      icon: THEME_ICON,
      ariaLabel: "Theme",
      eyebrow: "Theme",
      items: THEMES.map(function (t) { return { value: t, label: THEME_LABELS[t], swatch: THEME_SWATCHES[t] }; }),
      getActive: getTheme,
      onSelect: setTheme
    }));
    nav.appendChild(buildSidebarControl({
      icon: SIDEBAR_TOGGLE_ICON,
      ariaLabel: "Sidebar control",
      eyebrow: "Sidebar control",
      items: SIDEBAR_MODES.map(function (m) { return { value: m, label: SIDEBAR_MODE_LABELS[m] }; }),
      getActive: getSidebarMode,
      onSelect: setSidebarMode
    }));

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
  document.documentElement.setAttribute("data-ez-theme", getTheme());
  var activeItem = detectActiveItem();
  var isHome = window.location.pathname === "/" || window.location.pathname === "/index.html";

  // The welcome page (Home) and other plain content pages (like Credits)
  // read as landing pages, not the app: a pill nav bar in the content flow
  // instead of the fixed header + sidebar the rest of the site uses.
  if (activeItem.slug === "home") {
    document.body.classList.add("ez-pill-mode");
    var topbar = buildTopbar(isHome ? activeItem.slug : null);
    document.body.insertBefore(topbar, document.body.firstChild);
  } else {
    document.body.setAttribute("data-sidebar-mode", getSidebarMode());
    var header = buildHeader(activeItem);
    var sidebar = buildSidebar(activeItem.slug);
    document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.insertBefore(header, document.body.firstChild);
  }
  startClock();
})();
