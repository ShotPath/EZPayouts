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
  function oauthGoogle(idToken) {
    return apiFetch("/oauth/google", { method: "POST", json: { idToken: idToken } })
      .then(function (data) {
        setSession(data.token, data.username);
        emitChange();
        return data;
      });
  }
  function oauthApple(idToken) {
    return apiFetch("/oauth/apple", { method: "POST", json: { idToken: idToken } })
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
  // ---------- Trade screenshot sync ----------
  // Uploads go straight through as the compressed JPEG blob the caller
  // already built (apiFetch always JSON-encodes, so this bypasses it and
  // talks to the API directly). imageUrl() is synchronous and just builds a
  // URL — no fetch happens here; the <img> tag the caller points at that URL
  // is what actually loads it, auth token riding along as a query param
  // since <img> can't send an Authorization header.
  function uploadImage(blob) {
    if (!isLoggedIn()) return Promise.reject(new Error("Not signed in."));
    var token = getToken();
    return fetch(API_BASE + "/images", {
      method: "POST",
      headers: { "Content-Type": blob.type || "image/jpeg", "Authorization": "Bearer " + token },
      body: blob,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "Upload failed.");
        return data; // { id }
      });
    });
  }
  function imageUrl(id) {
    var token = getToken();
    if (!id || !token || String(id).indexOf("rimg_") !== 0) return null;
    return API_BASE + "/images/" + encodeURIComponent(id) + "?t=" + encodeURIComponent(token);
  }
  function deleteRemoteImage(id) {
    if (!id || String(id).indexOf("rimg_") !== 0) return Promise.resolve();
    return apiFetch("/images/" + encodeURIComponent(id), { method: "DELETE" }).catch(function () {});
  }

  function changePassword(currentPassword, newPassword) {
    return apiFetch("/change-password", { method: "POST", json: { currentPassword: currentPassword, newPassword: newPassword } });
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
      ".ez-auth-avatar{ display:flex; align-items:center; justify-content:center; width:34px; height:34px; flex:none;" +
      " border-radius:50%; border:1px solid var(--hairline-bright); background:var(--mint); color:var(--mint-text);" +
      " font-family:var(--font-display); font-weight:700; font-size:14px; cursor:pointer; transition:filter .15s; }" +
      ".ez-auth-avatar:hover{ filter:brightness(1.08); }" +
      ".ez-auth-menu{ position:absolute; top:calc(100% + 8px); right:0; z-index:40; min-width:170px;" +
      " background:var(--panel-raised); border:1px solid var(--hairline-bright); border-radius:12px; overflow:hidden;" +
      " box-shadow:0 18px 36px -18px rgba(0,0,0,0.6); }" +
      ".ez-auth-menu[hidden]{ display:none; }" +
      ".ez-auth-menu-user{ padding:10px 14px 8px; font-family:var(--font-mono); font-size:11px; color:var(--muted);" +
      " border-bottom:1px solid var(--hairline); }" +
      ".ez-auth-menu-user strong{ display:block; color:var(--ice); font-size:12.5px; margin-top:2px; }" +
      ".ez-auth-menu-item{ display:block; width:100%; text-align:left; font-family:var(--font-mono); font-size:11.5px;" +
      " padding:10px 14px; background:transparent; border:none; color:var(--muted); cursor:pointer; transition:color .15s, background .15s; }" +
      ".ez-auth-menu-item:hover{ color:var(--ice); background:var(--panel); }" +
      ".ez-auth-menu-item.danger:hover{ color:#ef5a5a; background:rgba(239,90,90,0.08); }" +
      ".ez-auth-overlay{ position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center;" +
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
      ".ez-auth-hint{ margin:16px 0 0; font-size:11.5px; color:var(--muted-dim); line-height:1.5; text-align:center; }" +
      // ---------- OAuth block (Inked Japan++): deliberately its own fixed
      // dark/blue palette rather than the page's --mint/--phosphor theme
      // tokens, so Google/Apple sign-in reads as a distinct, consistent
      // "secure handshake" affordance on every page regardless of theme. ----------
      ".ez-auth-divider{ display:flex; align-items:center; gap:10px; margin:20px 0 14px; }" +
      ".ez-auth-divider::before, .ez-auth-divider::after{ content:\"\"; flex:1; height:1px; background:#1a223d; }" +
      ".ez-auth-divider span{ font-family:var(--font-mono); font-size:9.5px; font-weight:700; letter-spacing:0.14em;" +
      " text-transform:uppercase; color:#565d75; white-space:nowrap; }" +
      ".ez-auth-oauth-row{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }" +
      ".ez-auth-oauth-btn{ display:flex; align-items:center; justify-content:center; gap:9px;" +
      " padding:11px 10px; border-radius:12px; background:#090b12; border:1px solid #1a223d;" +
      " color:#eef1fb; font-family:var(--font-mono); font-size:12px; font-weight:600;" +
      " cursor:pointer; transition:border-color .15s, box-shadow .15s, transform .1s; }" +
      ".ez-auth-oauth-btn svg{ width:16px; height:16px; flex:none; }" +
      ".ez-auth-oauth-btn:hover{ border-color:#3262f6; box-shadow:0 0 0 1px rgba(50,98,246,0.35), 0 0 18px rgba(50,98,246,0.3); }" +
      ".ez-auth-oauth-btn:active{ transform:scale(0.98); }" +
      ".ez-auth-oauth-btn:disabled{ opacity:0.5; cursor:default; }" +
      ".ez-auth-oauth-btn:disabled:hover{ border-color:#1a223d; box-shadow:none; }" +
      ".ez-auth-security-note{ display:flex; gap:7px; margin:14px 0 0; padding:10px 12px; border-radius:10px;" +
      " background:rgba(50,98,246,0.06); border:1px solid #1a223d; font-size:10.5px; line-height:1.55; color:#8d94a6; }" +
      ".ez-auth-security-note span:first-child{ flex:none; }" +
      ".ez-auth-security-note span:last-child{ flex:1; min-width:0; }";
    document.head.appendChild(style);
  }

  // ---------- Google / Apple sign-in ----------
  // Both sign-in paths hand this page a provider-signed ID token (a JWT),
  // which is POSTed straight to /oauth/{google,apple} — the worker verifies
  // it against the provider's own public keys server-side before ever
  // trusting it (see verifyIdToken in auth-worker.js). This page never
  // handles a Google/Apple password, and the client ID isn't a secret
  // (it's sent openly in the auth request either way).
  var GOOGLE_CLIENT_ID = window.EZ_GOOGLE_CLIENT_ID || "590928448638-eqaif9bhks2o0j2foba3l7ks0if4odt3.apps.googleusercontent.com";
  var APPLE_CLIENT_ID = window.EZ_APPLE_CLIENT_ID || null;
  var GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
  var APPLE_SDK_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

  function randomOauthState() {
    try { return crypto.randomUUID().replace(/-/g, ""); } catch (err) { return String(Date.now()) + Math.random().toString(36).slice(2); }
  }

  function openOauthPopup(url) {
    var w = 460, h = 600;
    var left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    var top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    return window.open(url, "ezpayouts-oauth", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
  }

  // Google: a plain OAuth 2.0 implicit flow (response_type=id_token) —
  // no Google JS SDK needed, just a popup to Google's own auth screen and a
  // tiny same-origin callback page (oauth-callback.html) that hands the
  // resulting token back via postMessage. Gives full control over our own
  // button's styling instead of Google's fixed-look branded button widget.
  function startGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error("Google sign-in isn't set up yet."));
    var state = randomOauthState();
    var redirectUri = window.location.origin + "/oauth-callback.html";
    var authUrl = GOOGLE_AUTH_ENDPOINT + "?" + [
      "client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID),
      "redirect_uri=" + encodeURIComponent(redirectUri),
      "response_type=id_token",
      "scope=" + encodeURIComponent("openid email"),
      "nonce=" + encodeURIComponent(randomOauthState()),
      "state=" + encodeURIComponent(state),
    ].join("&");

    return new Promise(function (resolve, reject) {
      var popup = openOauthPopup(authUrl);
      if (!popup) { reject(new Error("Pop-up blocked — allow pop-ups for this site and try again.")); return; }
      var done = false;
      function cleanup() {
        window.removeEventListener("message", onMessage);
        clearInterval(poll);
      }
      function onMessage(e) {
        if (e.origin !== window.location.origin) return;
        var data = e.data;
        if (!data || data.source !== "ezpayouts-oauth-callback" || data.provider !== "google") return;
        done = true;
        cleanup();
        if (data.error) { reject(new Error(data.error)); return; }
        if (data.state !== state) { reject(new Error("Sign-in response didn't match — please try again.")); return; }
        if (!data.idToken) { reject(new Error("Google didn't return a sign-in token.")); return; }
        resolve(data.idToken);
      }
      window.addEventListener("message", onMessage);
      var poll = setInterval(function () {
        if (popup.closed) {
          cleanup();
          if (!done) reject(new Error("Sign-in was cancelled."));
        }
      }, 400);
    });
  }

  var appleSdkPromise = null;
  function loadAppleSdk() {
    if (appleSdkPromise) return appleSdkPromise;
    appleSdkPromise = new Promise(function (resolve, reject) {
      if (window.AppleID) { resolve(window.AppleID); return; }
      var script = document.createElement("script");
      script.src = APPLE_SDK_URL;
      script.async = true;
      script.onload = function () { resolve(window.AppleID); };
      script.onerror = function () { reject(new Error("Could not load Apple's sign-in library.")); };
      document.head.appendChild(script);
    });
    return appleSdkPromise;
  }

  // Apple: official "Sign in with Apple JS" — usePopup:true makes it manage
  // its own popup + postMessage handoff internally, so (unlike Google) no
  // custom callback page is needed on our end for this one.
  function startAppleSignIn() {
    if (!APPLE_CLIENT_ID) return Promise.reject(new Error("Apple sign-in isn't set up yet."));
    return loadAppleSdk().then(function (AppleID) {
      AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: "name email",
        redirectURI: window.location.origin + "/oauth-callback.html",
        state: randomOauthState(),
        usePopup: true,
      });
      return AppleID.auth.signIn();
    }).then(function (res) {
      var idToken = res && res.authorization && res.authorization.id_token;
      if (!idToken) throw new Error("Apple didn't return a sign-in token.");
      return idToken;
    });
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
        '<div class="ez-auth-divider"><span>&mdash;&mdash;&mdash; or continue with &mdash;&mdash;&mdash;</span></div>' +
        '<div class="ez-auth-oauth-row">' +
          '<button type="button" class="ez-auth-oauth-btn" data-provider="google">' +
            '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7a5.4 5.4 0 0 1 0-3.4V4.97H.95a9 9 0 0 0 0 8.06l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>' +
            "<span>Google</span>" +
          "</button>" +
          '<button type="button" class="ez-auth-oauth-btn" data-provider="apple">' +
            '<svg viewBox="0 0 17 20" aria-hidden="true" fill="#ffffff"><path d="M14.03 10.6c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.45-1.6-2.98-1.62-1.27-.13-2.48.75-3.12.75-.64 0-1.63-.73-2.68-.71-1.38.02-2.65.8-3.36 2.03-1.43 2.48-.37 6.16 1.03 8.18.68.98 1.5 2.09 2.57 2.05 1.03-.04 1.42-.67 2.67-.67 1.24 0 1.6.67 2.68.65 1.11-.02 1.82-1.01 2.5-2 .78-1.14 1.11-2.25 1.12-2.3-.02-.01-2.15-.83-2.17-3.26z"/><path d="M11.97 4.3c.57-.7.96-1.65.85-2.6-.82.03-1.83.55-2.42 1.24-.53.6-.99 1.58-.87 2.5.9.07 1.83-.46 2.44-1.14z"/></svg>' +
            "<span>Apple</span>" +
          "</button>" +
        "</div>" +
        '<p class="ez-auth-security-note"><span>🔒</span><span>Security Sync: Connecting your account via Google or Apple establishes a secure cryptographic token handshake, enabling automatic hardware 2FA and biometric protection layers.</span></p>' +
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

    var oauthButtons = overlay.querySelectorAll(".ez-auth-oauth-btn");
    oauthButtons.forEach(function (btn) {
      var provider = btn.getAttribute("data-provider");
      if (provider === "google" && !GOOGLE_CLIENT_ID) btn.disabled = true;
      if (provider === "apple" && !APPLE_CLIENT_ID) btn.disabled = true;
      btn.addEventListener("click", function () {
        errorEl.hidden = true;
        oauthButtons.forEach(function (b) { b.disabled = true; });
        var originalHtml = btn.innerHTML;
        btn.innerHTML = "<span>" + (provider === "google" ? "Connecting to Google…" : "Connecting to Apple…") + "</span>";
        var startFlow = provider === "google" ? startGoogleSignIn : startAppleSignIn;
        var exchangeToken = provider === "google" ? oauthGoogle : oauthApple;
        startFlow().then(exchangeToken).then(function () {
          closeModal();
          formEl.reset();
          if (mountedContainer) renderWidget(mountedContainer);
        }).catch(function (err) {
          errorEl.textContent = err.message || "Something went wrong.";
          errorEl.hidden = false;
        }).then(function () {
          oauthButtons.forEach(function (b) {
            var p = b.getAttribute("data-provider");
            b.disabled = (p === "google" && !GOOGLE_CLIENT_ID) || (p === "apple" && !APPLE_CLIENT_ID);
          });
          btn.innerHTML = originalHtml;
        });
      });
    });

    overlay.querySelector(".ez-auth-close").addEventListener("click", closeModal);
    var authMouseDownOnBackdrop = false;
    overlay.addEventListener("mousedown", function (e) { authMouseDownOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && authMouseDownOnBackdrop) closeModal();
      authMouseDownOnBackdrop = false;
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

  // ---------- Change password modal (built once, shared across mounts) ----------
  var cpModalBuilt = false;
  var cpModalEls = null;

  function ensureChangePasswordModal() {
    if (cpModalBuilt) return;
    cpModalBuilt = true;
    ensureStyles();

    var overlay = document.createElement("div");
    overlay.className = "ez-auth-overlay";
    overlay.hidden = true;
    overlay.innerHTML = "" +
      '<div class="ez-auth-modal" role="dialog" aria-modal="true" aria-label="Change password">' +
        '<button type="button" class="ez-auth-close" aria-label="Close">&times;</button>' +
        '<p class="ez-auth-eyebrow">Change Password</p>' +
        '<form novalidate>' +
          '<label class="ez-auth-field"><span>Current Password</span>' +
            '<input type="password" class="ez-cp-current" autocomplete="current-password" maxlength="72" /></label>' +
          '<label class="ez-auth-field"><span>New Password</span>' +
            '<input type="password" class="ez-cp-new" autocomplete="new-password" maxlength="72" /></label>' +
          '<label class="ez-auth-field"><span>Confirm New Password</span>' +
            '<input type="password" class="ez-cp-confirm" autocomplete="new-password" maxlength="72" /></label>' +
          '<p class="ez-auth-error" hidden></p>' +
          '<button type="submit" class="ez-auth-submit">Update Password</button>' +
        "</form>" +
      "</div>";
    document.body.appendChild(overlay);

    var formEl = overlay.querySelector("form");
    var currentInput = overlay.querySelector(".ez-cp-current");
    var newInput = overlay.querySelector(".ez-cp-new");
    var confirmInput = overlay.querySelector(".ez-cp-confirm");
    var errorEl = overlay.querySelector(".ez-auth-error");
    var submitBtn = overlay.querySelector(".ez-auth-submit");

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      if (newInput.value !== confirmInput.value) {
        errorEl.textContent = "New passwords don't match.";
        errorEl.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Updating…";
      changePassword(currentInput.value, newInput.value).then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Update Password";
        closeCpModal();
        formEl.reset();
      }).catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Update Password";
        errorEl.textContent = err.message || "Something went wrong.";
        errorEl.hidden = false;
      });
    });

    overlay.querySelector(".ez-auth-close").addEventListener("click", closeCpModal);
    var cpMouseDownOnBackdrop = false;
    overlay.addEventListener("mousedown", function (e) { cpMouseDownOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && cpMouseDownOnBackdrop) closeCpModal();
      cpMouseDownOnBackdrop = false;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeCpModal();
    });

    function closeCpModal() { overlay.hidden = true; }

    cpModalEls = { overlay: overlay, currentInput: currentInput, errorEl: errorEl, formEl: formEl };
  }

  function openChangePasswordModal() {
    ensureChangePasswordModal();
    cpModalEls.errorEl.hidden = true;
    cpModalEls.formEl.reset();
    cpModalEls.overlay.hidden = false;
    setTimeout(function () { cpModalEls.currentInput.focus(); }, 30);
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
      var username = getUsername() || "";
      var initial = username.slice(0, 1).toUpperCase() || "?";
      container.innerHTML = "" +
        '<div class="ez-auth-pill">' +
          '<button type="button" class="ez-auth-avatar" aria-label="Account menu">' + escapeHtml(initial) + "</button>" +
          '<div class="ez-auth-menu" hidden>' +
            '<div class="ez-auth-menu-user">Signed in as<strong>@' + escapeHtml(username) + "</strong></div>" +
            '<button type="button" class="ez-auth-menu-item" data-action="change-password">Change Password</button>' +
            '<button type="button" class="ez-auth-menu-item danger" data-action="sign-out">Sign out</button>' +
          "</div>" +
        "</div>";
      var avatarBtn = container.querySelector(".ez-auth-avatar");
      var menu = container.querySelector(".ez-auth-menu");
      avatarBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      menu.querySelector('[data-action="change-password"]').addEventListener("click", function () {
        menu.hidden = true;
        openChangePasswordModal();
      });
      menu.querySelector('[data-action="sign-out"]').addEventListener("click", function () {
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
    uploadImage: uploadImage,
    imageUrl: imageUrl,
    deleteRemoteImage: deleteRemoteImage,
    changePassword: changePassword,
    onChange: onChange,
    mountWidget: mountWidget,
    openSignIn: function () { openModal("login"); },
    openChangePassword: openChangePasswordModal,
  };

  var autoContainer = document.getElementById("authWidget");
  if (autoContainer) mountWidget(autoContainer);
})();
