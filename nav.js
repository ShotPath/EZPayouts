// Shared site chrome: a left sidebar (brand + primary nav, Settings and an
// expanded/collapsed/expand-on-hover control) and, floating in the top-right
// corner with no bar behind it, the NY session orb + account widget mount
// point. Also owns appearance: the color theme and the page background
// (both chosen on /settings/), applied on every page. Included as a plain
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
  var THEMES = ["ink", "magenta", "red", "green"];
  var THEME_LABELS = { ink: "Inked Japan", magenta: "Magenta", red: "Red", green: "Green" };

  // Page background, shown behind every app page (and through the
  // translucent sidebar). "current" is the original themed glow.
  var BG_KEY = "ezpayouts.background";
  var BACKGROUNDS = ["liquid", "black", "current", "gray"];
  var BACKGROUND_LABELS = { liquid: "Liquid Chrome", black: "Black", current: "Current", gray: "Gray" };

  var SETTINGS_ICON = '<circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /><circle cx="10" cy="10" r="5.4" />';

  function readStored(key, allowed, fallback) {
    try {
      var stored = localStorage.getItem(key);
      if (allowed.indexOf(stored) !== -1) return stored;
    } catch (err) {}
    return fallback;
  }
  function getTheme() { return readStored(THEME_KEY, THEMES, "ink"); }
  function getBackground() { return readStored(BG_KEY, BACKGROUNDS, "current"); }

  // Lets the page's own widgets (charts, 3D views, the Settings page)
  // follow a change made here or in another tab.
  function announceAppearance() {
    var evt;
    try { evt = new CustomEvent("ez-appearance", { detail: { theme: getTheme(), background: getBackground() } }); }
    catch (err) { evt = document.createEvent("CustomEvent"); evt.initCustomEvent("ez-appearance", false, false, null); }
    window.dispatchEvent(evt);
  }
  function setTheme(theme) {
    if (THEMES.indexOf(theme) === -1) return;
    document.documentElement.setAttribute("data-ez-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
    announceAppearance();
  }
  function setBackground(bg) {
    if (BACKGROUNDS.indexOf(bg) === -1) return;
    try { localStorage.setItem(BG_KEY, bg); } catch (err) {}
    applyBackground();
    announceAppearance();
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
      },
      {
        slug: "calendar", href: "/calendar/", label: "Calendar",
        icon: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8h14M6.5 2.5v4M13.5 2.5v4" /><circle cx="10" cy="12" r="1.4" fill="currentColor" stroke="none" />'
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
        slug: "calendar", href: "/calendar/?view=econ", label: "Economic Calendar", query: "view=econ",
        icon: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8h14M6.5 2.5v4M13.5 2.5v4" /><path d="M6.5 11h1.2M9.4 11h1.2M12.3 11h1.2M6.5 13.5h1.2M9.4 13.5h1.2" />'
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

  // Lives at the bottom of the sidebar with the layout control rather than
  // in the nav groups above.
  var SETTINGS_ITEM = { slug: "settings", href: "/settings/", label: "Settings", icon: SETTINGS_ICON };

  var ALL_NAV_ITEMS = NAV_ITEMS.concat(NAV_SECTIONS.reduce(function (acc, section) { return acc.concat(section); }, []));

  // Plain slug isn't unique — P&L Calendar and Economic Calendar both use
  // slug "calendar" (same /calendar/ page, told apart by a ?view= query).
  // This is the real identity used for "is this the active link" checks.
  function itemKey(item) {
    return item.query ? item.slug + "|" + item.query : item.slug;
  }

  var SIDEBAR_TOGGLE_ICON = '<rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M8 3.5v13" />';

  function detectActiveItem() {
    var path = window.location.pathname;
    var search = window.location.search.replace(/^\?/, "");
    // Two items can share the same path (P&L vs Economic Calendar both
    // live at /calendar/, told apart only by a ?view= query) — check the
    // query-qualified ones first so a plain path match doesn't win first
    // and highlight the wrong sidebar entry.
    for (var i = 0; i < ALL_NAV_ITEMS.length; i++) {
      var qItem = ALL_NAV_ITEMS[i];
      if (!qItem.query) continue;
      var qSlug = qItem.slug;
      if ((path.indexOf("/" + qSlug) === 0 || path.indexOf("/" + qSlug + "/") !== -1) && search === qItem.query) return qItem;
    }
    var plain = ALL_NAV_ITEMS.concat([SETTINGS_ITEM]);
    for (var j = 0; j < plain.length; j++) {
      var item = plain[j];
      if (item.query) continue;
      if (path.indexOf("/" + item.slug) === 0 || path.indexOf("/" + item.slug + "/") !== -1) return item;
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
      ":root{ --ez-header-h:56px; --ez-sidebar-w:212px; --ez-sidebar-collapsed-w:56px; --ez-content-gutter:clamp(16px,4vw,48px); }" +
      // Each page's own .wrap centers itself with margin:auto inside body's
      // content box — but that only adds breathing room once the viewport is
      // wider than sidebar + wrap + gutter. Below that (most real screens),
      // the auto-margin collapses to 0 and cards sit flush against the
      // sidebar with zero gap, while the right side keeps its own gutter.
      // Adding the same gutter to the sidebar's width keeps a real, matching
      // gap on both sides no matter how much leftover room there is.
      "body{ padding-top:var(--ez-header-h); padding-left:calc(var(--ez-sidebar-collapsed-w) + var(--ez-content-gutter)); transition:padding-left .18s ease; }" +
      "body[data-sidebar-mode=\"expanded\"]{ padding-left:calc(var(--ez-sidebar-w) + var(--ez-content-gutter)); }" +

      // No bar: just the NY orb + account widget floating top-right. Body
      // keeps --ez-header-h of top padding so page content never sits under it.
      ".ez-header{ position:fixed; top:11px; right:16px; z-index:500; height:34px;" +
      " display:flex; align-items:center; justify-content:flex-end; gap:10px; pointer-events:none; }" +
      ".ez-header > *{ pointer-events:auto; }" +
      ".ez-brand{ display:flex; align-items:center; gap:8px; flex:none; text-decoration:none; }" +
      ".ez-brand img{ width:30px; height:30px; object-fit:contain; }" +

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
      // In the floating cluster the session clock shrinks to a glowing orb
      // and expands into the full pill on hover, keyboard focus, or tap.
      ".ez-header .market-status{ height:34px; box-sizing:border-box; padding:0 11px; gap:0; cursor:pointer; outline:none;" +
      " background:transparent; border-color:transparent; transition:padding .3s ease, gap .3s ease, background .25s, border-color .25s; }" +
      ".ez-header .market-status .dot{ width:12px; height:12px; animation:ez-orb-breathe 2.4s ease-in-out infinite; }" +
      "@keyframes ez-orb-breathe{ 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:0.78; transform:scale(0.86); } }" +
      ".ez-header .market-status.open .dot{ box-shadow:0 0 10px 3px var(--phosphor-glow), 0 0 22px 6px rgba(62,224,140,0.18); }" +
      ".ez-header .market-status.closed .dot{ box-shadow:0 0 10px 3px var(--red-glow,rgba(239,90,90,0.5)), 0 0 22px 6px rgba(239,90,90,0.18); }" +
      ".ez-header .market-status .label, .ez-header .market-status strong{ display:inline-block; max-width:0; opacity:0; overflow:hidden;" +
      " transition:max-width .35s ease, opacity .2s ease; }" +
      ".ez-header .market-status:hover, .ez-header .market-status:focus-visible, .ez-header .market-status.expanded{ gap:8px; padding:0 14px; }" +
      ".ez-header .market-status.open:hover, .ez-header .market-status.open:focus-visible, .ez-header .market-status.open.expanded{" +
      " background:rgba(62,224,140,0.12); border-color:var(--phosphor-dim); }" +
      ".ez-header .market-status.closed:hover, .ez-header .market-status.closed:focus-visible, .ez-header .market-status.closed.expanded{" +
      " background:rgba(239,90,90,0.10); border-color:var(--red,#ef5a5a); }" +
      ".ez-header .market-status:hover .label, .ez-header .market-status:focus-visible .label, .ez-header .market-status.expanded .label{ max-width:110px; opacity:1; }" +
      ".ez-header .market-status:hover strong, .ez-header .market-status:focus-visible strong, .ez-header .market-status.expanded strong{ max-width:130px; opacity:1; }" +
      "@media (max-width:560px){ .ez-header .market-status .label{ display:none; } }" +

      // ~70% opaque in the theme's panel color, blurred, so the page
      // background shows through softly while labels stay crisp.
      ".ez-sidebar{ position:fixed; top:0; left:0; bottom:0; z-index:400; width:var(--ez-sidebar-collapsed-w);" +
      " overflow-x:hidden; overflow-y:auto; background:var(--ez-sidebar-bg, var(--panel-raised));" +
      " -webkit-backdrop-filter:blur(18px) saturate(1.25); backdrop-filter:blur(18px) saturate(1.25);" +
      " border-right:1px solid var(--hairline-bright); box-shadow:1px 0 0 rgba(255,255,255,0.03), 12px 0 32px -24px rgba(0,0,0,0.8);" +
      " padding:14px 10px; display:flex; flex-direction:column; gap:2px; transition:width .18s ease, box-shadow .18s ease; }" +
      "body[data-sidebar-mode=\"expanded\"] .ez-sidebar{ width:var(--ez-sidebar-w); }" +
      "body[data-sidebar-mode=\"hover\"] .ez-sidebar:hover{ width:var(--ez-sidebar-w); box-shadow:0 20px 50px -12px rgba(0,0,0,0.6); }" +
      ".ez-sidebar-link{ display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;" +
      " color:var(--muted); text-decoration:none; font-family:var(--font-display); font-weight:600; font-size:13.5px;" +
      " white-space:nowrap; overflow:hidden; transition:background .15s, color .15s; }" +
      ".ez-sidebar-link:hover{ color:var(--ice); background:rgba(255,255,255,0.05); }" +
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

      ".ez-sidebar-brand{ display:flex; align-items:center; gap:10px; padding:4px 8px 12px; margin-bottom:4px; text-decoration:none;" +
      " border-bottom:1px solid var(--hairline); white-space:nowrap; overflow:hidden; }" +
      ".ez-sidebar-brand img{ width:30px; height:30px; object-fit:contain; flex:none; }" +
      ".ez-sidebar-brand .ez-sidebar-label{ font-family:var(--font-display); font-weight:700; font-size:15px; color:var(--ice); }" +
      "body:not([data-sidebar-mode=\"expanded\"]) .ez-sidebar-brand{ justify-content:center; padding:4px 0 12px; }" +
      "body[data-sidebar-mode=\"hover\"] .ez-sidebar:hover .ez-sidebar-brand{ justify-content:flex-start; padding:4px 8px 12px; }" +
      ".ez-sidebar-section{ display:flex; flex-direction:column; gap:2px;" +
      " border-top:1px solid var(--hairline); padding-top:8px; margin-top:8px; }" +

      // Short windows scroll the sidebar instead of squashing its rows.
      ".ez-sidebar > *{ flex-shrink:0; }" +
      ".ez-sidebar-spacer{ flex:1; }" +
      ".ez-sidebar-control{ position:relative; border-top:1px solid var(--hairline); padding-top:10px; margin-top:8px; }" +
      ".ez-sidebar-control-btn{ display:flex; align-items:center; gap:12px; width:100%; padding:10px 12px; border-radius:10px;" +
      " background:transparent; border:none; color:var(--muted); cursor:pointer; font-family:var(--font-mono); font-size:11.5px;" +
      " font-weight:600; white-space:nowrap; overflow:hidden; transition:background .15s, color .15s; }" +
      ".ez-sidebar-control-btn{ justify-content:center; padding:10px 0; }" +
      ".ez-sidebar-control-btn:hover{ color:var(--ice); background:rgba(255,255,255,0.05); }" +
      ".ez-sidebar-settings{ padding-top:8px; }" +

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
      "  .ez-sidebar-brand{ justify-content:center !important; padding:4px 0 12px !important; }" +
      "  .ez-header{ right:12px; }" +
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

      // Themes. html[data-ez-theme] beats a page's bare :root, so these win
      // over each page's own default tokens. --red/--amber (loss/warning)
      // never change: they carry financial meaning.
      //  * Page tokens (--void, --panel, --phosphor, --mint, ...).
      //  * --ez-*: accents several pages used to hard-code in ink blue
      //    (header buttons, trade modal, popovers), the page glow and the
      //    translucent sidebar.
      //  * --holo-*: the dashboard's 3D views (r,g,b).
      //  * --ij-*: the dashboard's own palette; "ink" leaves the
      //    dashboard's built-in values alone, which ARE the ink look.
      // "ink" (Inked Japan) is the default and keeps its exact original
      // values everywhere.
      "html[data-ez-theme=\"ink\"]{" +
      " --ez-cal-top:#141b2d; --ez-cal-bottom:#0e1424; --ez-cal-well:#0b0f19; --ez-cal-cell:rgba(14,20,36,0.6); --ez-cal-cell-border:#1b2540; --ez-cal-cell-hover:#2d3a5f; --ez-pnl-accent:#2d5bff; --ez-pnl-bg:#0d0f1a; --ez-pnl-border:#22253f; --ez-pnl-cell:#131527; --ez-pnl-cell-border:#1c1f35; --ez-pnl-cell-active:#191c32;" +
      " --ez-win-a:rgba(59,130,246,0.3); --ez-win-b:rgba(79,70,229,0.2); --ez-win-c:rgba(30,27,75,0.4); --ez-win-line:rgba(96,165,250,0.4); --ez-win-glow:rgba(59,130,246,0.7);" +
      " --void:#050811; --panel:#0d1425; --panel-raised:#121a2e; --panel-hi:#1a243d;" +
      " --hairline:#1c2742; --hairline-bright:#243153;" +
      " --phosphor:#3b82f6; --phosphor-soft:#38bdf8; --phosphor-dim:#1d3a6e; --phosphor-glow:rgba(59,130,246,0.35);" +
      " --mint:#2563eb; --mint-text:#f8fafc;" +
      " --ice:#e2e8f0; --muted:#94a3b8; --muted-dim:#64748b;" +
      " --ez-accent:#3262f6; --ez-accent-rgb:50,98,246; --ez-accent-soft:#8fa8ff; --ez-accent-strong:#527eff; --ez-focus-rgb:59,130,246;" +
      " --ez-grad-a:#0099ff; --ez-grad-b:#00d2ff; --ez-grad-text:#050811; --ez-grad-glow:rgba(0,210,255,0.4);" +
      " --ez-btn-bg:#0d1122; --ez-btn-border:#1c2445; --ez-btn-border-hi:#202b54; --ez-btn-text:#cbd5e1;" +
      " --ez-surface:#0c0e17; --ez-surface-border:#181e30; --ez-field:#0b1020; --ez-field-border:#1f2a44;" +
      " --ez-popover-bg:rgba(9,13,24,0.95); --ez-popover-border:#26356e;" +
      " --ez-foot-bg:#0d1329; --ez-foot-border:#1f2d61; --ez-foot-bg-hi:#121b3a;" +
      " --ez-tint-a:rgba(50,98,246,0.12); --ez-tint-b:rgba(83,186,121,0.07); --ez-sidebar-bg:rgba(18,26,46,0.7);" +
      " --holo-wire:70,212,255; --holo-prism:72,160,255; --holo-deep:50,98,246; }" +

      "html[data-ez-theme=\"magenta\"]{" +
      " --ez-sel-bg:#150d1c; --ez-sel-border:#2a1a36; --ez-sel-text:#efe4f4; --ez-sel-border-hi:#46305a; --ez-sel-muted:#9a8bab; --ez-sel-accent-soft:#f5a3d6; --ez-sel-dim:#645271; --ez-sel-opt:#e0d0ea; --ez-sel-glow:rgba(236,72,153,0.5); --ez-sel-active:#2a1736; --ez-sel-disabled:#4a3b57;" +
      " --ez-cal-top:#1e1327; --ez-cal-bottom:#150d1c; --ez-cal-well:#0f0914; --ez-cal-cell:rgba(26,15,34,0.6); --ez-cal-cell-border:#2c1c39; --ez-cal-cell-hover:#4a3160; --ez-pnl-accent:#d63f9d; --ez-pnl-bg:#120a17; --ez-pnl-border:#33213f; --ez-pnl-cell:#1a1022; --ez-pnl-cell-border:#281a33; --ez-pnl-cell-active:#22152c;" +
      " --ez-win-a:rgba(16,185,129,0.28); --ez-win-b:rgba(5,150,105,0.18); --ez-win-c:rgba(6,40,30,0.45); --ez-win-line:rgba(52,211,153,0.4); --ez-win-glow:rgba(16,185,129,0.6);" +
      " --void:#0a0710; --panel:#150d1c; --panel-raised:#1e1327; --panel-hi:#281a33;" +
      " --hairline:#3a2748; --hairline-bright:#5c3a74;" +
      " --phosphor:#d63f9d; --phosphor-soft:#f5a3d6; --phosphor-dim:#6e1e52; --phosphor-glow:rgba(214,63,157,0.35);" +
      " --mint:#d63f9d; --mint-text:#fff5fb;" +
      " --ice:#efe4f4; --muted:#9a8bab; --muted-dim:#645271;" +
      " --ez-accent:#d63f9d; --ez-accent-rgb:214,63,157; --ez-accent-soft:#f5a3d6; --ez-accent-strong:#ec6cbd; --ez-focus-rgb:214,63,157;" +
      " --ez-grad-a:#b62fd6; --ez-grad-b:#f472b6; --ez-grad-text:#ffffff; --ez-grad-glow:rgba(236,72,153,0.4);" +
      " --ez-btn-bg:#170e1f; --ez-btn-border:#33213f; --ez-btn-border-hi:#43295a; --ez-btn-text:#e7d9ef;" +
      " --ez-surface:#120b18; --ez-surface-border:#2a1a36; --ez-field:#170e1f; --ez-field-border:#3a2648;" +
      " --ez-popover-bg:rgba(20,11,27,0.95); --ez-popover-border:#5c3a74;" +
      " --ez-foot-bg:#1d1027; --ez-foot-border:#4a2a5e; --ez-foot-bg-hi:#271536;" +
      " --ez-tint-a:rgba(214,63,157,0.13); --ez-tint-b:rgba(139,92,246,0.08); --ez-sidebar-bg:rgba(30,19,39,0.7);" +
      " --holo-wire:244,150,226; --holo-prism:220,96,200; --holo-deep:140,48,150;" +
      " --ij-void:#0a0710; --ij-panel:#150d1c; --ij-panel-hi:#1e1327; --ij-border:#2a1a36; --ij-border-bright:#46305a;" +
      " --ij-blue:#d63f9d; --ij-blue-soft:#f5a3d6; --ij-blue-glow:rgba(214,63,157,0.35);" +
      " --ij-soft-glow:rgba(245,163,214,0.6); --ij-track:#2a1a36; --ez-cal-icon:#f5a3d6; --ij-ice:#efe4f4; --ij-muted:#9a8bab; --ij-muted-dim:#645271; }" +

      "html[data-ez-theme=\"red\"]{" +
      " --ez-sel-bg:#150c0c; --ez-sel-border:#2a1616; --ez-sel-text:#f5e1e1; --ez-sel-border-hi:#4a2226; --ez-sel-muted:#a88383; --ez-sel-accent-soft:#f8a0a6; --ez-sel-dim:#6d4f4f; --ez-sel-opt:#ead2d2; --ez-sel-glow:rgba(255,90,80,0.5); --ez-sel-active:#2c1416; --ez-sel-disabled:#553c3c;" +
      " --ez-cal-top:#1f1313; --ez-cal-bottom:#150c0c; --ez-cal-well:#0e0808; --ez-cal-cell:rgba(30,14,14,0.6); --ez-cal-cell-border:#351b1d; --ez-cal-cell-hover:#5a2a2e; --ez-pnl-accent:#e23744; --ez-pnl-bg:#120909; --ez-pnl-border:#3a1c20; --ez-pnl-cell:#1a0e0f; --ez-pnl-cell-border:#2a1517; --ez-pnl-cell-active:#231214;" +
      " --ez-win-a:rgba(16,185,129,0.28); --ez-win-b:rgba(5,150,105,0.18); --ez-win-c:rgba(6,40,30,0.45); --ez-win-line:rgba(52,211,153,0.4); --ez-win-glow:rgba(16,185,129,0.6);" +
      " --void:#0a0707; --panel:#150c0c; --panel-raised:#1f1313; --panel-hi:#2a1818;" +
      " --hairline:#3a2020; --hairline-bright:#612c2c;" +
      " --phosphor:#e23744; --phosphor-soft:#f3c68c; --phosphor-dim:#6e1a21; --phosphor-glow:rgba(226,55,68,0.35);" +
      " --mint:#e23744; --mint-text:#fff6f6;" +
      " --ice:#f5e1e1; --muted:#a88383; --muted-dim:#6d4f4f;" +
      " --ez-accent:#e23744; --ez-accent-rgb:226,55,68; --ez-accent-soft:#f8a0a6; --ez-accent-strong:#ff5c69; --ez-focus-rgb:226,55,68;" +
      " --ez-grad-a:#d42a3c; --ez-grad-b:#ff7a59; --ez-grad-text:#ffffff; --ez-grad-glow:rgba(255,90,80,0.4);" +
      " --ez-btn-bg:#170c0d; --ez-btn-border:#3a1c20; --ez-btn-border-hi:#4c2228; --ez-btn-text:#f1d8d8;" +
      " --ez-surface:#130a0b; --ez-surface-border:#2c1517; --ez-field:#170c0d; --ez-field-border:#3f2125;" +
      " --ez-popover-bg:rgba(22,10,11,0.95); --ez-popover-border:#612c2c;" +
      " --ez-foot-bg:#1f0d10; --ez-foot-border:#5a232a; --ez-foot-bg-hi:#2a1215;" +
      " --ez-tint-a:rgba(226,55,68,0.12); --ez-tint-b:rgba(255,122,89,0.07); --ez-sidebar-bg:rgba(31,19,19,0.7);" +
      " --holo-wire:255,150,134; --holo-prism:240,88,98; --holo-deep:160,32,48;" +
      " --ij-void:#0a0707; --ij-panel:#150c0c; --ij-panel-hi:#1f1313; --ij-border:#2a1616; --ij-border-bright:#4a2226;" +
      " --ij-blue:#e23744; --ij-blue-soft:#f8a0a6; --ij-blue-glow:rgba(226,55,68,0.35);" +
      " --ij-soft-glow:rgba(248,160,166,0.6); --ij-track:#2a1616; --ez-cal-icon:#f3c68c; --ij-ice:#f5e1e1; --ij-muted:#a88383; --ij-muted-dim:#6d4f4f; }" +

      "html[data-ez-theme=\"green\"]{" +
      " --ez-sel-bg:#0b130e; --ez-sel-border:#16261c; --ez-sel-text:#e3f3e8; --ez-sel-border-hi:#24402f; --ez-sel-muted:#86a090; --ez-sel-accent-soft:#8fe6b6; --ez-sel-dim:#566b5e; --ez-sel-opt:#cfe5d7; --ez-sel-glow:rgba(62,224,140,0.5); --ez-sel-active:#13261b; --ez-sel-disabled:#3d4f44;" +
      " --ez-cal-top:#111d16; --ez-cal-bottom:#0b130e; --ez-cal-well:#070d0a; --ez-cal-cell:rgba(12,24,18,0.6); --ez-cal-cell-border:#1a2f23; --ez-cal-cell-hover:#2b4a38; --ez-pnl-accent:#22c57a; --ez-pnl-bg:#09110d; --ez-pnl-border:#1c3326; --ez-pnl-cell:#0e1813; --ez-pnl-cell-border:#17271e; --ez-pnl-cell-active:#13211a;" +
      " --ez-win-a:rgba(16,185,129,0.28); --ez-win-b:rgba(5,150,105,0.18); --ez-win-c:rgba(6,40,30,0.45); --ez-win-line:rgba(52,211,153,0.4); --ez-win-glow:rgba(16,185,129,0.6);" +
      " --void:#050a07; --panel:#0b130e; --panel-raised:#101a14; --panel-hi:#16231b;" +
      " --hairline:#1c2e23; --hairline-bright:#2b4a38;" +
      " --phosphor:#3ee08c; --phosphor-soft:#8fe6b6; --phosphor-dim:#1c5c3d; --phosphor-glow:rgba(62,224,140,0.35);" +
      " --mint:#3ee08c; --mint-text:#03200f;" +
      " --ice:#e3f3e8; --muted:#7f9a89; --muted-dim:#4f6457;" +
      " --ez-accent:#22c57a; --ez-accent-rgb:34,197,122; --ez-accent-soft:#8fe6b6; --ez-accent-strong:#3ee08c; --ez-focus-rgb:62,224,140;" +
      " --ez-grad-a:#10b981; --ez-grad-b:#5eead4; --ez-grad-text:#03140b; --ez-grad-glow:rgba(45,212,191,0.4);" +
      " --ez-btn-bg:#0b1510; --ez-btn-border:#1c3326; --ez-btn-border-hi:#24412f; --ez-btn-text:#d2e9db;" +
      " --ez-surface:#09110d; --ez-surface-border:#172a20; --ez-field:#0c1611; --ez-field-border:#21392c;" +
      " --ez-popover-bg:rgba(8,16,12,0.95); --ez-popover-border:#2b4a38;" +
      " --ez-foot-bg:#0d1c14; --ez-foot-border:#24503a; --ez-foot-bg-hi:#11261a;" +
      " --ez-tint-a:rgba(62,224,140,0.10); --ez-tint-b:rgba(45,212,191,0.06); --ez-sidebar-bg:rgba(16,26,20,0.7);" +
      " --holo-wire:94,234,212; --holo-prism:52,211,153; --holo-deep:16,120,80;" +
      " --ij-void:#050a07; --ij-panel:#0b130e; --ij-panel-hi:#111d16; --ij-border:#16261c; --ij-border-bright:#24402f;" +
      " --ij-blue:#22c57a; --ij-blue-soft:#8fe6b6; --ij-blue-glow:rgba(34,197,122,0.35);" +
      " --ij-soft-glow:rgba(143,230,182,0.6); --ij-track:#16261c; --ez-cal-icon:#8fe6b6; --ij-ice:#e3f3e8; --ij-muted:#86a090; --ij-muted-dim:#566b5e; }" +

      // ---- Page titles: one style for every app page.
      "body.ez-app .ez-page-title{ font-family:var(--font-display); font-weight:700; text-transform:uppercase;" +
      " font-size:clamp(22px,2.4vw,28px); line-height:1.15; letter-spacing:0.16em; color:var(--ice, #eef1fb); margin:0; }" +
      "body.ez-app .ez-page-sub{ margin:8px 0 0; font-size:13px; line-height:1.5; color:var(--muted, #848ca3); letter-spacing:0; text-transform:none; }" +
      "body.ez-app .ez-page-head{ padding:22px 0 18px; }" +

      // ---- Backgrounds (app pages only; the public home page keeps its
      // own). "current" = the original glow, tinted by the theme.
      "html[data-ez-bg=\"current\"] body.ez-app{ background:" +
      " radial-gradient(ellipse 120% 60% at 50% -10%, var(--ez-tint-a), transparent 60%)," +
      " radial-gradient(ellipse 80% 50% at 100% 100%, var(--ez-tint-b), transparent 60%), var(--void); }" +
      "html[data-ez-bg=\"black\"] body.ez-app{ background:#000; }" +
      "html[data-ez-bg=\"gray\"] body.ez-app{ background:#2a2c31; }" +
      // Liquid chrome: a WebGL canvas fixed behind the page (see
      // startLiquidChrome); the gradient is its stand-in until the first
      // frame, or for good without WebGL.
      "html[data-ez-bg=\"liquid\"]{ background:#0d0e11 linear-gradient(125deg, #121317 0%, #34363c 22%, #101114 42%, #3b3d44 63%, #121316 82%, #2a2c31 100%) fixed; }" +
      "html[data-ez-bg=\"liquid\"] body.ez-app{ background:transparent; }" +
      // The pages' faint scanline overlay would read as a screen door over
      // real metal.
      "html[data-ez-bg=\"liquid\"] body.ez-app::before{ display:none; }" +
      ".ez-bg-chrome{ position:fixed; inset:0; width:100vw; height:100vh; z-index:-1; pointer-events:none; display:block; }";
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
          return '<a href="' + item.href + '"' + (itemKey(item) === activeSlug ? ' class="active"' : "") + ">" + item.label + "</a>";
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

  function buildHeader() {
    var header = document.createElement("header");
    header.className = "ez-header";
    header.innerHTML = "" +
      '<span class="market-status" id="marketStatus" tabindex="0" role="timer">' +
        '<span class="dot" aria-hidden="true"></span>' +
        '<span class="label mono" id="marketLabel">NY OPEN IN</span>' +
        '<strong class="mono" id="marketOpenIn">--:--:--</strong>' +
      "</span>" +
      '<div id="authWidget"></div>';
    // Tap toggles the expanded pill on touch screens (no hover there);
    // tapping anywhere else collapses it again.
    var orb = header.querySelector(".market-status");
    orb.addEventListener("click", function (e) {
      e.stopPropagation();
      orb.classList.toggle("expanded");
    });
    document.addEventListener("click", function () { orb.classList.remove("expanded"); });
    return header;
  }

  // Shared across every ez-sidebar-control instance so opening one closes
  // any other that's already open (they're visually identical popovers).
  var openControlCloser = null;

  // Builds one bottom-of-sidebar icon button that opens a small popover
  // menu of radio-style choices (the expanded/collapsed/hover control).
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
          return '<button type="button" class="ez-sidebar-menu-item' + (selected ? " selected" : "") + '" data-value="' + item.value + '">' +
            '<span class="dot" aria-hidden="true"></span>' + item.label +
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
      return '<a class="ez-sidebar-link' + (itemKey(item) === activeSlug ? " active" : "") + '" href="' + item.href + '">' +
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

    // Inside the app the logo stays inside the app: it goes to the
    // Dashboard, not back out to the public marketing page.
    nav.innerHTML = '<a class="ez-sidebar-brand" href="/dashboard/" aria-label="EZPayouts dashboard">' +
        '<img src="/ezpayouts-icon-only.png" alt="EZ" />' +
        '<span class="ez-sidebar-label">EZPayouts</span>' +
      "</a>" +
      NAV_ITEMS.map(renderLink).join("") +
      NAV_SECTIONS.map(function (section) {
        return '<div class="ez-sidebar-section">' + section.map(renderLink).join("") + "</div>";
      }).join("") +
      '<div class="ez-sidebar-section">' + COMING_SOON_ITEMS.map(renderComingSoon).join("") + "</div>" +
      '<span class="ez-sidebar-spacer"></span>';

    // Settings (theme, background, layout) in place of the old color picker.
    var settingsWrap = document.createElement("div");
    settingsWrap.className = "ez-sidebar-control ez-sidebar-settings";
    settingsWrap.innerHTML = renderLink(SETTINGS_ITEM);
    nav.appendChild(settingsWrap);
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

  // ---------- Liquid chrome page background ----------
  // Domain-warped metal: rounded tubes along a flowing field, shaded as a
  // mirror reflecting a dark studio. Quality matters here, so it renders at
  // the screen's real resolution (capped on very large hi-DPI screens, and
  // stepped down only if a device can't hold its frame rate), the surface
  // is smooth everywhere so edges never break into jagged pixels, and the
  // output is dithered so the dark gradients don't band. The key light
  // drifts gently toward the pointer. Paused by the browser while the tab
  // is hidden; a single still frame with reduced motion. Without WebGL the
  // CSS gradient stand-in stays.
  var chrome = null;
  var CHROME_FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 uRes;",
    "uniform float uTime;",
    "uniform vec2 uLight;",
    "float field(vec2 p, float t){",
    "  vec2 q = p;",
    "  q += 0.42 * vec2(sin(q.y * 1.35 + t * 0.50), cos(q.x * 1.15 - t * 0.42));",
    "  q += 0.26 * vec2(sin(q.y * 2.30 - t * 0.36 + 1.7), cos(q.x * 2.05 + t * 0.55 + 0.4));",
    "  q += 0.12 * vec2(sin(q.y * 3.90 + t * 0.70 + 2.3), cos(q.x * 3.60 - t * 0.62 + 1.1));",
    "  return sin(q.x * 1.7) * cos(q.y * 1.9) + 0.4 * sin(q.x * 2.6 + q.y * 1.4 + t * 0.22);",
    "}",
    "// Rounded tubes along the field's zero lines. Smooth everywhere (no",
    "// abs/min creases), so the surface never breaks into jagged pixels.",
    "float height(vec2 p, float t){",
    "  float v = field(p, t);",
    "  return 0.9 * exp(-v * v * 7.5) + 0.2 * v;",
    "}",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / uRes;",
    "  float s = 3.1 / uRes.y;",
    "  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) * s + vec2(0.6, -0.2);",
    "  float t = uTime;",
    "  float e = max(s, 0.0025);",
    "  float h = height(p, t);",
    "  float hx = (height(p + vec2(e, 0.0), t) - height(p - vec2(e, 0.0), t)) / (2.0 * e);",
    "  float hy = (height(p + vec2(0.0, e), t) - height(p - vec2(0.0, e), t)) / (2.0 * e);",
    "  vec3 n = normalize(vec3(-hx * 0.5, -hy * 0.5, 1.0));",
    "  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);",
    "  vec3 key = normalize(vec3(-0.35 + uLight.x, 0.75 + uLight.y, 0.55));",
    "  float env = 0.16;",
    "  env += 1.1 * smoothstep(0.57, 0.97, dot(r, key));",
    "  env += 0.5 * smoothstep(0.60, 0.96, dot(r, normalize(vec3(0.85, -0.15, 0.55))));",
    "  env += 0.2 * smoothstep(0.70, 0.98, dot(r, normalize(vec3(-0.2, -0.85, 0.5))));",
    "  env *= 0.75 + 0.35 * (0.5 + 0.5 * sin((r.x * 2.4 - r.y * 3.2) * 3.0 + 1.3));",
    "  env += 1.05 * pow(max(dot(r, normalize(vec3(-0.45 + uLight.x, 0.55 + uLight.y, 0.70))), 0.0), 36.0);",
    "  env += pow(1.0 - n.z, 3.0) * 0.3;",
    "  vec3 col = vec3(env) * vec3(0.86, 0.89, 0.95);",
    "  col *= 0.55 + 0.45 * smoothstep(-0.25, 0.7, h);",
    "  col *= 0.5 + 0.5 * smoothstep(1.25, 0.1, length((uv - vec2(0.55, 0.55)) * vec2(1.2, 1.0)));",
    "  col *= 0.6;",
    "  col = col / (1.0 + 0.35 * col);",
    "  col = pow(col, vec3(0.95));",
    "  col += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 19.19) - 1.0) / 255.0;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");
  // Sets up the chrome shader on a canvas; null without WebGL.
  function chromeGL(canvas, keepPixels) {
    var gl = null;
    try {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power", preserveDrawingBuffer: !!keepPixels });
      if (!gl) return null;
      var compile = function (type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      var prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}"));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, CHROME_FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return {
        gl: gl,
        uRes: gl.getUniformLocation(prog, "uRes"),
        uTime: gl.getUniformLocation(prog, "uTime"),
        uLight: gl.getUniformLocation(prog, "uLight")
      };
    } catch (err) {
      return null;
    }
  }
  // A still frame as an image URL, for the Settings page's preview tile.
  var chromeStillUrl = null;
  function chromeStill() {
    if (chromeStillUrl !== null) return chromeStillUrl;
    var canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 400;
    var c = chromeGL(canvas, true);
    if (!c) return (chromeStillUrl = "");
    c.gl.viewport(0, 0, 640, 400);
    c.gl.uniform2f(c.uRes, 640, 400);
    c.gl.uniform1f(c.uTime, 4.0);
    c.gl.uniform2f(c.uLight, 0, 0);
    c.gl.drawArrays(c.gl.TRIANGLES, 0, 3);
    chromeStillUrl = canvas.toDataURL("image/jpeg", 0.9);
    var lose = c.gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return chromeStillUrl;
  }
  function startLiquidChrome() {
    if (chrome) return;
    var canvas = document.createElement("canvas");
    canvas.className = "ez-bg-chrome";
    canvas.setAttribute("aria-hidden", "true");
    var c = chromeGL(canvas, false);
    if (!c) return;
    var gl = c.gl;
    document.body.insertBefore(canvas, document.body.firstChild);
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var raf = 0, start = performance.now();
    // Render scale in device pixels per CSS pixel: the screen's own density,
    // within a pixel budget; lowered if frames run long.
    var MAX_PIXELS = 3400000;
    var quality = 1, slowFrames = 0, lastNow = 0;
    var light = [0, 0], lightTo = [0, 0];
    function size() {
      var cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
      var scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (cssW * cssH))) * quality;
      var w = Math.max(1, Math.round(cssW * scale)), h = Math.max(1, Math.round(cssH * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(c.uRes, w, h);
    }
    function draw(now) {
      light[0] += (lightTo[0] - light[0]) * 0.04;
      light[1] += (lightTo[1] - light[1]) * 0.04;
      gl.uniform2f(c.uLight, light[0], light[1]);
      gl.uniform1f(c.uTime, 4.0 + (now - start) / 1000 * 0.24);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      // Long frames in a row mean this device can't keep up at this
      // resolution: step it down a little (never below 60% of a CSS px).
      if (lastNow && now - lastNow > 24) {
        if (++slowFrames > 45 && quality > 0.6) { quality = Math.max(0.6, quality * 0.85); slowFrames = 0; size(); }
      } else if (slowFrames > 0) {
        slowFrames--;
      }
      lastNow = now;
      draw(now);
    }
    function onResize() { size(); draw(performance.now()); }
    function onPointer(e) {
      lightTo[0] = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 0.3;
      lightTo[1] = -(e.clientY / Math.max(1, window.innerHeight) - 0.5) * 0.2;
    }
    function onVisibility() { lastNow = 0; }
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      cancelAnimationFrame(raf);
      canvas.style.display = "none";
    });
    size();
    draw(performance.now());
    if (!reduced) {
      raf = requestAnimationFrame(loop);
      window.addEventListener("pointermove", onPointer, { passive: true });
    }
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    chrome = {
      stop: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("visibilitychange", onVisibility);
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
        canvas.remove();
        chrome = null;
      }
    };
  }

  // App pages only; the public home page keeps its own background.
  function applyBackground() {
    var bg = getBackground();
    var isApp = document.body && document.body.classList.contains("ez-app");
    if (isApp) document.documentElement.setAttribute("data-ez-bg", bg);
    else document.documentElement.removeAttribute("data-ez-bg");
    if (bg === "liquid" && isApp) startLiquidChrome();
    else if (chrome) chrome.stop();
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
    // The orb only shows its dot until hovered, so screen readers get the
    // full countdown from its label.
    function update() {
      tick();
      marketStatusEl.setAttribute("aria-label", marketLabelEl.textContent + " in " + marketOpenInEl.textContent);
    }
    update();
    setInterval(update, 1000);
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
    var topbar = buildTopbar(isHome ? itemKey(activeItem) : null);
    document.body.insertBefore(topbar, document.body.firstChild);
  } else {
    document.body.classList.add("ez-app");
    document.body.setAttribute("data-sidebar-mode", getSidebarMode());
    var header = buildHeader();
    var sidebar = buildSidebar(itemKey(activeItem));
    document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.insertBefore(header, document.body.firstChild);
  }
  applyBackground();
  startClock();

  // Follow appearance changes made in another tab.
  window.addEventListener("storage", function (e) {
    if (e.key === THEME_KEY) {
      document.documentElement.setAttribute("data-ez-theme", getTheme());
      announceAppearance();
    } else if (e.key === BG_KEY) {
      applyBackground();
      announceAppearance();
    }
  });

  // For the Settings page.
  window.EZAppearance = {
    themes: THEMES.map(function (id) { return { id: id, label: THEME_LABELS[id] }; }),
    backgrounds: BACKGROUNDS.map(function (id) { return { id: id, label: BACKGROUND_LABELS[id] }; }),
    sidebarModes: SIDEBAR_MODES.map(function (id) { return { id: id, label: SIDEBAR_MODE_LABELS[id] }; }),
    getTheme: getTheme, setTheme: setTheme,
    getBackground: getBackground, setBackground: setBackground,
    getSidebarMode: getSidebarMode, setSidebarMode: setSidebarMode,
    chromeStill: chromeStill
  };
})();
