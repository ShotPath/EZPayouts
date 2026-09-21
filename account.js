// Shared account widget: sign up / sign in against the ezpayouts-auth
// Worker, and a small topbar pill reflecting the signed-in state. Included
// as a plain <script src> on every page (no build step, matches the rest
// of the site) — drop a <div id="authWidget"></div> in .topbar-actions and
// this mounts into it automatically.
//
// Not real security: good enough to key a person's synced Backtest log and
// cockpit plan/size selection to an account, nothing more.
(function () {
  "use strict";

  var API_BASE = window.EZ_AUTH_BASE || "https://ezpayouts-auth.ezpayouts.workers.dev";
  var TOKEN_KEY = "ezpayouts.auth.token";
  var USERNAME_KEY = "ezpayouts.auth.username";

  var listeners = [];
  var mountedContainer = null;
  var modalBuilt = false;
  var modalEls = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (err) { return null; }
  }
  function getUsername() {
    try { return localStorage.getItem(USERNAME_KEY); } catch (err) { return null; }
  }
  function setSession(token, username) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USERNAME_KEY, username);
    } catch (err) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERNAME_KEY);
    } catch (err) {}
  }
  function isLoggedIn() { return !!getToken(); }

  function onChange(fn) { listeners.push(fn); }
  function emitChange() {
    var loggedIn = isLoggedIn();
    var username = getUsername();
    listeners.forEach(function (fn) {
      try { fn(loggedIn, username); } catch (err) {}
    });
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    var headers = {};
    var body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    return fetch(API_BASE + path, { method: opts.method || "GET", headers: headers, body: body })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Request failed.");
          return data;
        });
      });
  }

  function signup(username, password) {
    return apiFetch("/signup", { method: "POST", json: { username: username, password: password } })
      .then(function (data) {
        setSession(data.token, data.username);
        emitChange();
        return data;
      });
  }
  function login(username, password) {
    return apiFetch("/login", { method: "POST", json: { username: username, password: password } })
      .then(function (data) {
        setSession(data.token, data.username);
        emitChange();
        return data;
      });
  }
  function logout() {
    var pending = getToken() ? apiFetch("/logout", { method: "POST" }).catch(function () {}) : Promise.resolve();
    return pending.then(function () {
      clearSession();
      emitChange();
    });
  }
  function fetchData() {
    if (!isLoggedIn()) return Promise.resolve(null);
    return apiFetch("/data").catch(function () { return null; });
  }
  function saveData(partial) {
    if (!isLoggedIn()) return Promise.resolve(null);
    return apiFetch("/data", { method: "PUT", json: partial }).catch(function () { return null; });
  }

  // ---------- Styles (injected once; relies on the :root tokens every page already defines) ----------
  function ensureStyles() {
    if (document.getElementById("ezAuthStyles")) return;
    var style = document.createElement("style");
    style.id = "ezAuthStyles";
    style.textContent = "" +
      ".ez-auth-btn{ font-family:var(--font-mono); font-size:11.5px; font-weight:600; letter-spacing:0.02em; white-space:nowrap;" +
      " padding:6px 13px; border-radius:999px; border:1px solid var(--hairline-bright); background:var(--panel-raised);" +
      " color:var(--phosphor-soft); cursor:pointer; transition:background .15s, border-color .15s, color .15s; }" +
      ".ez-auth-btn:hover{ border-color:var(--phosphor-dim); color:var(--ice); }" +
      ".ez-auth-pill{ position:relative; }" +
      ".ez-auth-user{ display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono); font-size:11.5px; font-weight:600;" +
      " white-space:nowrap; padding:6px 12px; border-radius:999px; border:1px solid var(--hairline-bright); background:var(--panel);" +
      " color:var(--ice); cursor:pointer; transition:border-color .15s; }" +
      ".ez-auth-user:hover{ border-color:var(--phosphor-dim); }" +
      ".ez-auth-caret{ font-size:9px; color:var(--muted); }" +
      ".ez-auth-menu{ position:absolute; top:calc(100% + 8px); right:0; z-index:40; min-width:120px;" +
      " background:var(--panel-raised); border:1px solid var(--hairline-bright); border-radius:12px; overflow:hidden;" +
      " box-shadow:0 18px 36px -18px rgba(0,0,0,0.6); }" +
      ".ez-auth-menu[hidden]{ display:none; }" +
      ".ez-auth-signout{ display:block; width:100%; text-align:left; font-family:var(--font-mono); font-size:11.5px;" +
      " padding:10px 14px; background:transparent; border:none; color:var(--muted); cursor:pointer; transition:color .15s, background .15s; }" +
      ".ez-auth-signout:hover{ color:#ef5a5a; background:rgba(239,90,90,0.08); }" +
      ".ez-auth-overlay{ position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center;" +
      " padding:20px; background:rgba(4,6,5,0.72); backdrop-filter:blur(3px); }" +
      ".ez-auth-overlay[hidden]{ display:none; }" +
      ".ez-auth-modal{ position:relative; width:100%; max-width:360px; background:var(--panel); border:1px solid var(--hairline-bright);" +
      " border-radius:18px; padding:26px 24px 22px; box-shadow:0 24px 60px -20px var(--phosphor-glow); }" +
      ".ez-auth-close{ position:absolute; top:12px; right:14px; background:transparent; border:none; color:var(--muted);" +
      " font-size:20px; line-height:1; cursor:pointer; padding:4px; transition:color .15s; }" +
      ".ez-auth-close:hover{ color:var(--ice); }" +
      ".ez-auth-eyebrow{ font-family:var(--font-mono); font-size:11px; letter-spacing:0.2em; text-transform:uppercase;" +
      " color:var(--phosphor); margin:0 0 16px; }" +
      ".ez-auth-tabs{ position:relative; display:inline-flex; align-items:stretch; width:100%; margin-bottom:18px;" +
      " border-radius:9px; overflow:hidden; border:1px solid var(--hairline-bright); background:var(--panel-raised); }" +
      ".ez-auth-tabs .seg-thumb{ position:absolute; top:0; bottom:0; left:0; width:0; z-index:0; pointer-events:none;" +
      " background:var(--mint); transition:transform .22s cubic-bezier(.4,0,.2,1), width .22s cubic-bezier(.4,0,.2,1); border-radius:inherit; }" +
      ".ez-auth-tabs button{ position:relative; z-index:1; flex:1; font-family:var(--font-mono); font-size:11.5px; font-weight:700;" +
      " padding:9px 8px; background:transparent; border:none; color:var(--muted); cursor:pointer; transition:color .15s; white-space:nowrap; }" +
      ".ez-auth-tabs button:hover{ color:var(--ice); }" +
      ".ez-auth-tabs button.active{ color:var(--mint-text); }" +
      ".ez-auth-tabs button.active:hover{ color:var(--mint-text); }" +
      ".ez-auth-field{ display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }" +
      ".ez-auth-field span{ font-family:var(--font-mono); font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); }" +
      ".ez-auth-field input{ width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--hairline);" +
      " background:var(--panel-raised); color:var(--ice); font-family:var(--font-body); font-size:14px; outline:none; transition:border-color .15s; }" +
      ".ez-auth-field input:focus{ border-color:var(--phosphor-dim); }" +
      ".ez-auth-error{ margin:-4px 0 14px; font-size:12.5px; color:#ef5a5a; }" +
      ".ez-auth-error[hidden]{ display:none; }" +
      ".ez-auth-submit{ width:100%; font-family:var(--font-display); font-weight:600; font-size:14px; padding:11px 16px;" +
      " border-radius:10px; border:1px solid var(--mint); background:var(--mint); color:var(--mint-text); cursor:pointer;" +
      " transition:filter .15s, opacity .15s; }" +
      ".ez-auth-submit:hover{ filter:brightness(1.08); }" +
      ".ez-auth-submit:disabled{ opacity:0.6; cursor:default; filter:none; }" +
      ".ez-auth-hint{ margin:16px 0 0; font-size:11.5px; color:var(--muted-dim); line-height:1.5; text-align:center; }";
    document.head.appendChild(style);
  }

  // ---------- Sign in / create account modal (built once, shared across mounts) ----------
  function ensureModal() {
    if (modalBuilt) return;
    modalBuilt = true;
    ensureStyles();

    var overlay = document.createElement("div");
    overlay.className = "ez-auth-overlay";
    overlay.hidden = true;
    overlay.innerHTML = "" +
      '<div class="ez-auth-modal" role="dialog" aria-modal="true" aria-label="Sign in or create an account">' +
        '<button type="button" class="ez-auth-close" aria-label="Close">&times;</button>' +
        '<p class="ez-auth-eyebrow">Account</p>' +
        '<div class="ez-auth-tabs">' +
          '<span class="seg-thumb" aria-hidden="true"></span>' +
          '<button type="button" class="active" data-tab="login">Sign In</button>' +
          '<button type="button" data-tab="signup">Create Account</button>' +
        "</div>" +
        '<form novalidate>' +
          '<label class="ez-auth-field"><span>Username</span>' +
            '<input type="text" class="ez-auth-username" autocomplete="username" maxlength="20" /></label>' +
          '<label class="ez-auth-field"><span>Password</span>' +
            '<input type="password" class="ez-auth-password" autocomplete="current-password" maxlength="72" /></label>' +
          '<p class="ez-auth-error" hidden></p>' +
          '<button type="submit" class="ez-auth-submit">Sign In</button>' +
        "</form>" +
        '<p class="ez-auth-hint">Not real security &mdash; just enough to sync your data across devices.</p>' +
      "</div>";
    document.body.appendChild(overlay);

    var tabsEl = overlay.querySelector(".ez-auth-tabs");
    var formEl = overlay.querySelector("form");
    var usernameInput = overlay.querySelector(".ez-auth-username");
    var passwordInput = overlay.querySelector(".ez-auth-password");
    var errorEl = overlay.querySelector(".ez-auth-error");
    var submitBtn = overlay.querySelector(".ez-auth-submit");
    var mode = "login";

    function layoutTabThumb(skipTransition) {
      var thumb = tabsEl.querySelector(".seg-thumb");
      var active = tabsEl.querySelector("button.active");
      if (!thumb || !active) return;
      if (skipTransition) thumb.style.transition = "none";
      thumb.style.width = active.offsetWidth + "px";
      thumb.style.transform = "translateX(" + active.offsetLeft + "px)";
      if (skipTransition) {
        thumb.offsetHeight;
        thumb.style.transition = "";
      }
    }

    function updateFormForMode() {
      submitBtn.textContent = mode === "signup" ? "Create Account" : "Sign In";
      passwordInput.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
    }

    tabsEl.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      mode = btn.getAttribute("data-tab");
      tabsEl.querySelectorAll("button[data-tab]").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      layoutTabThumb();
      errorEl.hidden = true;
      updateFormForMode();
    });

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      var username = usernameInput.value.trim();
      var password = passwordInput.value;
      errorEl.hidden = true;
      submitBtn.disabled = true;
      var originalLabel = submitBtn.textContent;
      submitBtn.textContent = mode === "signup" ? "Creating…" : "Signing in…";
      var action = mode === "signup" ? signup : login;
      action(username, password).then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        closeModal();
        formEl.reset();
        if (mountedContainer) renderWidget(mountedContainer);
      }).catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        errorEl.textContent = err.message || "Something went wrong.";
        errorEl.hidden = false;
      });
    });

    overlay.querySelector(".ez-auth-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeModal();
    });

    function closeModal() { overlay.hidden = true; }

    modalEls = {
      overlay: overlay,
      tabsEl: tabsEl,
      usernameInput: usernameInput,
      errorEl: errorEl,
      formEl: formEl,
      layoutTabThumb: layoutTabThumb,
      updateFormForMode: updateFormForMode,
      closeModal: closeModal,
      setMode: function (next) {
        mode = next;
        tabsEl.querySelectorAll("button[data-tab]").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-tab") === mode);
        });
        updateFormForMode();
      },
    };
  }

  function openModal(initialMode) {
    ensureModal();
    modalEls.setMode(initialMode || "login");
    modalEls.errorEl.hidden = true;
    modalEls.formEl.reset();
    modalEls.overlay.hidden = false;
    modalEls.layoutTabThumb(true);
    setTimeout(function () { modalEls.usernameInput.focus(); }, 30);
  }

  // ---------- Topbar widget ----------
  var globalClickWired = false;
  function ensureGlobalClickHandler() {
    if (globalClickWired) return;
    globalClickWired = true;
    document.addEventListener("click", function (e) {
      var menu = document.querySelector(".ez-auth-menu");
      if (!menu || menu.hidden) return;
      if (!e.target.closest(".ez-auth-pill")) menu.hidden = true;
    });
  }

  function renderWidget(container) {
    if (isLoggedIn()) {
      container.innerHTML = "" +
        '<div class="ez-auth-pill">' +
          '<button type="button" class="ez-auth-user">' +
            '<span>@' + escapeHtml(getUsername()) + "</span>" +
            '<span class="ez-auth-caret" aria-hidden="true">&#9662;</span>' +
          "</button>" +
          '<div class="ez-auth-menu" hidden>' +
            '<button type="button" class="ez-auth-signout">Sign out</button>' +
          "</div>" +
        "</div>";
      var userBtn = container.querySelector(".ez-auth-user");
      var menu = container.querySelector(".ez-auth-menu");
      userBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      container.querySelector(".ez-auth-signout").addEventListener("click", function () {
        menu.hidden = true;
        logout().then(function () { renderWidget(container); });
      });
    } else {
      container.innerHTML = '<button type="button" class="ez-auth-btn">Sign In</button>';
      container.querySelector(".ez-auth-btn").addEventListener("click", function () {
        openModal("login");
      });
    }
  }

  function mountWidget(containerOrId) {
    var container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return;
    ensureStyles();
    ensureGlobalClickHandler();
    mountedContainer = container;
    renderWidget(container);
  }

  window.addEventListener("storage", function (e) {
    if (e.key !== TOKEN_KEY && e.key !== USERNAME_KEY) return;
    emitChange();
    if (mountedContainer) renderWidget(mountedContainer);
  });

  window.EZAuth = {
    getToken: getToken,
    getUsername: getUsername,
    isLoggedIn: isLoggedIn,
    signup: signup,
    login: login,
    logout: logout,
    fetchData: fetchData,
    saveData: saveData,
    onChange: onChange,
    mountWidget: mountWidget,
  };

  var autoContainer = document.getElementById("authWidget");
  if (autoContainer) mountWidget(autoContainer);
})();
