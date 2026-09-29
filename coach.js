// Shared AI coach chat widget: a floating button + panel available on every
// page. Included as a plain <script src="/coach.js"> after account.js (it
// needs EZAuth for sign-in gating). No build step, same pattern as
// nav.js/account.js.
//
// Each page can optionally define window.EZPageContext(), a function
// returning { pageName: string, data: any } describing what's currently on
// screen — the coach sends this fresh with every message so it can answer
// questions about whatever the person is actually looking at. Pages that
// don't define it just get a generic "browsing the X page" context.
(function () {
  "use strict";

  var COACH_API_BASE = window.EZ_COACH_BASE || "https://ezpayouts-coach.ezpayouts.workers.dev";

  function ensureStyles() {
    if (document.getElementById("ezCoachStyles")) return;
    var style = document.createElement("style");
    style.id = "ezCoachStyles";
    style.textContent = "" +
      ".coach-fab{ position:fixed; right:20px; bottom:20px; z-index:150;" +
      " display:inline-flex; align-items:center; gap:8px;" +
      " padding:12px 18px; border-radius:999px; border:1px solid var(--mint);" +
      " background:var(--mint); color:var(--mint-text); font-family:var(--font-display); font-weight:700; font-size:14px;" +
      " cursor:pointer; box-shadow:0 16px 40px -14px var(--phosphor-glow); transition:filter .15s, transform .15s; }" +
      ".coach-fab:hover{ filter:brightness(1.06); transform:translateY(-2px); }" +

      ".coach-panel{ position:fixed; right:20px; bottom:90px; z-index:150;" +
      " width:min(360px, calc(100vw - 40px)); height:min(520px, calc(100vh - 140px));" +
      " display:flex; flex-direction:column;" +
      " background:var(--panel); border:1px solid var(--hairline-bright); border-radius:18px;" +
      " box-shadow:0 24px 60px -20px rgba(0,0,0,0.6); overflow:hidden; }" +
      ".coach-panel[hidden]{ display:none; }" +

      ".coach-header{ display:flex; align-items:center; justify-content:space-between;" +
      " padding:14px 16px; border-bottom:1px solid var(--hairline); background:var(--panel-raised); flex:none; }" +
      ".coach-header-title{ font-family:var(--font-display); font-weight:700; font-size:14px; color:var(--ice); display:flex; align-items:center; gap:8px; }" +
      ".coach-header-dot{ width:7px; height:7px; border-radius:50%; background:var(--phosphor); box-shadow:0 0 8px 2px var(--phosphor-glow); flex:none; }" +
      ".coach-close{ background:transparent; border:none; color:var(--muted); font-size:20px; line-height:1; cursor:pointer; padding:4px; transition:color .15s; }" +
      ".coach-close:hover{ color:var(--ice); }" +

      ".coach-messages{ flex:1; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:10px; }" +
      ".coach-messages[hidden]{ display:none; }" +
      ".coach-msg{ max-width:85%; padding:9px 12px; border-radius:14px; font-size:13.5px; line-height:1.5; white-space:pre-wrap; overflow-wrap:break-word; }" +
      ".coach-msg.bot{ align-self:flex-start; background:var(--panel-raised); border:1px solid var(--hairline-bright); color:var(--ice); border-bottom-left-radius:4px; }" +
      ".coach-msg.user{ align-self:flex-end; background:var(--mint); color:var(--mint-text); border-bottom-right-radius:4px; font-weight:500; }" +
      ".coach-msg.error{ align-self:center; background:rgba(239,90,90,0.12); border:1px solid var(--red,#ef5a5a); color:var(--red,#ef5a5a); font-family:var(--font-mono); font-size:12px; text-align:center; }" +
      ".coach-msg.typing{ align-self:flex-start; background:var(--panel-raised); border:1px solid var(--hairline-bright); color:var(--muted); font-family:var(--font-mono); font-size:12px; }" +

      ".coach-gate{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; text-align:center; }" +
      ".coach-gate[hidden]{ display:none; }" +
      ".coach-gate p{ margin:0; color:var(--muted); font-size:13.5px; line-height:1.6; }" +
      ".coach-gate-btn{ font-family:var(--font-display); font-weight:600; font-size:13.5px; padding:10px 20px;" +
      " border-radius:10px; border:1px solid var(--mint); background:var(--mint); color:var(--mint-text); cursor:pointer; transition:filter .15s; }" +
      ".coach-gate-btn:hover{ filter:brightness(1.06); }" +

      ".coach-input-row{ display:flex; gap:8px; padding:12px; border-top:1px solid var(--hairline); flex:none; }" +
      ".coach-input-row[hidden]{ display:none; }" +
      ".coach-input{ flex:1; padding:10px 12px; border-radius:10px; border:1px solid var(--hairline);" +
      " background:var(--panel-raised); color:var(--ice); font-family:var(--font-body); font-size:13.5px; outline:none;" +
      " resize:none; transition:border-color .15s; }" +
      ".coach-input:focus{ border-color:var(--phosphor-dim); }" +
      ".coach-send{ font-family:var(--font-display); font-weight:700; font-size:13px; padding:0 16px;" +
      " border-radius:10px; border:1px solid var(--mint); background:var(--mint); color:var(--mint-text); cursor:pointer;" +
      " flex:none; transition:filter .15s, opacity .15s; }" +
      ".coach-send:disabled{ opacity:0.4; cursor:default; filter:none; }" +

      "@media (max-width:480px){" +
      "  .coach-panel{ right:12px; bottom:78px; width:calc(100vw - 24px); height:min(70vh, 560px); }" +
      "  .coach-fab{ right:12px; bottom:12px; padding:11px 16px; font-size:13px; }" +
      "}";
    document.head.appendChild(style);
  }

  function buildDom() {
    var fab = document.createElement("button");
    fab.className = "coach-fab";
    fab.id = "coachFab";
    fab.type = "button";
    fab.innerHTML = '<span aria-hidden="true">&#128172;</span> Coach';

    var panel = document.createElement("div");
    panel.className = "coach-panel";
    panel.id = "coachPanel";
    panel.hidden = true;
    panel.innerHTML = "" +
      '<div class="coach-header">' +
        '<span class="coach-header-title"><span class="coach-header-dot" aria-hidden="true"></span> Trading Coach</span>' +
        '<button class="coach-close" id="coachCloseBtn" type="button" aria-label="Close">&times;</button>' +
      "</div>" +
      '<div class="coach-gate" id="coachGate">' +
        "<p>Sign in to get honest, personal feedback from your AI coach.</p>" +
        '<button class="coach-gate-btn" id="coachSignInBtn" type="button">Sign In</button>' +
      "</div>" +
      '<div class="coach-messages" id="coachMessages" hidden></div>' +
      '<div class="coach-input-row" id="coachInputRow" hidden>' +
        '<textarea class="coach-input" id="coachInput" rows="1" placeholder="Ask your coach..." maxlength="1000"></textarea>' +
        '<button class="coach-send" id="coachSendBtn" type="button" disabled>Send</button>' +
      "</div>";

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  function getPageContext() {
    if (typeof window.EZPageContext === "function") {
      try {
        var ctx = window.EZPageContext();
        if (ctx && typeof ctx === "object") return ctx;
      } catch (err) {}
    }
    return { pageName: document.title || "this page", data: null };
  }

  function init() {
    ensureStyles();
    buildDom();

    var fab = document.getElementById("coachFab");
    var panel = document.getElementById("coachPanel");
    var closeBtn = document.getElementById("coachCloseBtn");
    var gate = document.getElementById("coachGate");
    var signInBtn = document.getElementById("coachSignInBtn");
    var messagesEl = document.getElementById("coachMessages");
    var inputRow = document.getElementById("coachInputRow");
    var input = document.getElementById("coachInput");
    var sendBtn = document.getElementById("coachSendBtn");

    var history = [];
    var sending = false;
    var greeted = false;
    var lastErrorWasLunch = false;
    var LUNCH_FOLLOWUPS = [
      { re: /\bwhy\b/i, reply: "Because bro is lowkey a fat ass, but don't tell him I said anything." },
      { re: /\b(get|got|grab|grabbed|taco|bell|lunch|order)\b/i, reply: "They got a 5 layer burrito and a baja blast." }
    ];

    function pushMessage(role, text) {
      var el = document.createElement("div");
      el.className = "coach-msg " + role;
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function renderGateState() {
      var loggedIn = !!(window.EZAuth && EZAuth.isLoggedIn());
      gate.hidden = loggedIn;
      messagesEl.hidden = !loggedIn;
      inputRow.hidden = !loggedIn;
      if (loggedIn && !greeted) {
        greeted = true;
        pushMessage("bot", "What's good, champ. Ask me anything about what you're looking at here, or just say hey.");
      }
    }

    function openPanel() {
      panel.hidden = false;
      renderGateState();
      setTimeout(function () { if (!inputRow.hidden) input.focus(); }, 30);
    }
    function closePanel() { panel.hidden = true; }

    fab.addEventListener("click", function () {
      if (panel.hidden) openPanel(); else closePanel();
    });
    closeBtn.addEventListener("click", closePanel);
    signInBtn.addEventListener("click", function () {
      if (window.EZAuth) EZAuth.openSignIn();
    });

    if (window.EZAuth) {
      EZAuth.onChange(function (loggedIn) {
        if (!loggedIn) {
          history = [];
          greeted = false;
          lastErrorWasLunch = false;
          messagesEl.innerHTML = "";
        }
        renderGateState();
      });
    }

    function updateSendEnabled() {
      sendBtn.disabled = sending || !input.value.trim();
    }
    input.addEventListener("input", updateSendEnabled);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
      }
    });
    sendBtn.addEventListener("click", sendMessage);

    function sendMessage() {
      var text = input.value.trim();
      if (!text || sending) return;
      if (!window.EZAuth || !EZAuth.isLoggedIn()) { renderGateState(); return; }

      history.push({ role: "user", content: text });
      pushMessage("user", text);
      input.value = "";
      sending = true;
      updateSendEnabled();

      var lunchFollowup = null;
      if (lastErrorWasLunch) {
        lunchFollowup = LUNCH_FOLLOWUPS.filter(function (f) { return f.re.test(text); })[0] || null;
      }
      lastErrorWasLunch = false;

      if (lunchFollowup) {
        var followupTypingEl = pushMessage("bot typing", "thinking...");
        setTimeout(function () {
          followupTypingEl.remove();
          sending = false;
          history.push({ role: "assistant", content: lunchFollowup.reply });
          pushMessage("bot", lunchFollowup.reply);
          updateSendEnabled();
        }, 700);
        return;
      }

      var typingEl = pushMessage("bot typing", "thinking...");

      var ctx = getPageContext();
      var requestBody = JSON.stringify({
        messages: history,
        pageName: ctx.pageName,
        pageData: ctx.data,
      });

      // A 502 from the worker means the upstream AI call failed (rate limited,
      // overloaded, or briefly unreachable) rather than something wrong with
      // the request itself, so it's worth quietly retrying a few times before
      // making the user resend the same message by hand.
      var RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

      function attempt(attemptIndex) {
        fetch(COACH_API_BASE + "/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + EZAuth.getToken(),
          },
          body: requestBody,
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
        }).then(function (result) {
          if (!result.ok && result.status === 502 && attemptIndex < RETRY_DELAYS_MS.length) {
            setTimeout(function () { attempt(attemptIndex + 1); }, RETRY_DELAYS_MS[attemptIndex]);
            return;
          }
          typingEl.remove();
          sending = false;
          if (!result.ok) {
            pushMessage("error", (result.data && result.data.error) || "Something went wrong. Try again.");
            updateSendEnabled();
            return;
          }
          var reply = result.data.reply || "";
          history.push({ role: "assistant", content: reply });
          pushMessage("bot", reply);
          updateSendEnabled();
        }).catch(function () {
          if (attemptIndex < RETRY_DELAYS_MS.length) {
            setTimeout(function () { attempt(attemptIndex + 1); }, RETRY_DELAYS_MS[attemptIndex]);
            return;
          }
          typingEl.remove();
          sending = false;
          lastErrorWasLunch = true;
          pushMessage("error", "Sorry, the coach is on lunch and will be back in a minute... They went to Taco Bell.");
          updateSendEnabled();
        });
      }

      attempt(0);
    }

    renderGateState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
