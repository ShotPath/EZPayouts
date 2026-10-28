// Risk Management, on trader.tradovate.com (runs in the page, at
// document_start). Tradovate's web app signs in and then talks to its API
// with an access token; this notes the latest one (from the socket's
// "authorize" frame, a request's Authorization header, or a sign-in reply)
// and which server it's for (live or demo). The popup then reads and
// changes the account's risk settings through tv-bridge.js, with that
// token, from this page (Tradovate's API accepts calls from its own site).
// Only the calls below are allowed: the account list, auto-liquidation
// limits and position limits. Nothing here can place or cancel an order.
(function () {
  "use strict";
  if (window.__ezRiskHook) return;
  window.__ezRiskHook = true;

  var API_HOST = /^https:\/\/(live|demo)\.tradovateapi\.com\//;
  var WS_HOST = /^wss:\/\/(live|demo)\.tradovateapi\.com\//;
  var ALLOWED = [
    /^account\/list$/,
    /^userAccountAutoLiq\/(deps\?masterid=\d+|create|update)$/,
    /^userAccountPositionLimit\/(deps\?masterid=\d+|create|update)$/,
  ];
  var auth = { token: null, env: null, at: 0 };

  function note(token, env) {
    if (!token || typeof token !== "string" || token.length < 20) return;
    auth.token = token; auth.env = env; auth.at = Date.now();
  }
  function envOf(url) {
    var m = API_HOST.exec(url) || WS_HOST.exec(url);
    return m ? m[1] : null;
  }

  // The trading socket's sign-in: "authorize\n<id>\n\n<token>".
  var origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string" && data.indexOf("authorize\n") === 0) {
        var env = envOf(this.url || "");
        if (env) note(data.split("\n\n").pop().trim(), env);
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  function bearer(h) { var m = /^Bearer\s+(.+)$/i.exec(h || ""); return m ? m[1] : null; }
  function headerOf(init, input) {
    try {
      var h = (init && init.headers) || (input && input.headers);
      if (!h) return null;
      if (typeof h.get === "function") return h.get("Authorization");
      if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) if (/^authorization$/i.test(h[i][0])) return h[i][1]; return null; }
      for (var k in h) if (/^authorization$/i.test(k)) return h[k];
    } catch (e) {}
    return null;
  }
  function noteReply(env, data) {
    if (data && data.accessToken) note(data.accessToken, env);
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var env = envOf(url);
    if (env) { try { note(bearer(headerOf(init, input)), env); } catch (e) {} }
    var p = origFetch.apply(this, arguments);
    if (env && /\/auth\/(accesstokenrequest|renewaccesstoken)/i.test(url)) {
      p.then(function (r) { r.clone().json().then(function (d) { noteReply(env, d); }, function () {}); }, function () {});
    }
    return p;
  };

  var XHR = XMLHttpRequest.prototype, origOpen = XHR.open, origSetHeader = XHR.setRequestHeader;
  XHR.open = function (method, url) {
    this.__ezEnv = envOf(String(url || ""));
    this.__ezAuthUrl = this.__ezEnv && /\/auth\/(accesstokenrequest|renewaccesstoken)/i.test(String(url));
    if (this.__ezAuthUrl) {
      var x = this;
      this.addEventListener("load", function () { try { noteReply(x.__ezEnv, JSON.parse(x.responseText)); } catch (e) {} });
    }
    return origOpen.apply(this, arguments);
  };
  XHR.setRequestHeader = function (name, value) {
    if (this.__ezEnv && /^authorization$/i.test(name)) note(bearer(value), this.__ezEnv);
    return origSetHeader.apply(this, arguments);
  };

  // ---------- Requests from the extension (tv-bridge.js) ----------
  function call(method, path, body) {
    if (!auth.token) return Promise.reject(new Error("not-signed-in"));
    if (!ALLOWED.some(function (re) { return re.test(path); })) return Promise.reject(new Error("not-allowed"));
    if (method !== "GET" && method !== "POST") return Promise.reject(new Error("not-allowed"));
    var headers = { "Authorization": "Bearer " + auth.token, "Accept": "application/json" };
    if (method === "POST") headers["Content-Type"] = "application/json";
    return origFetch.call(window, "https://" + auth.env + ".tradovateapi.com/v1/" + path, {
      method: method, headers: headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = null; try { data = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok || (data && data.errorText)) {
          var err = new Error((data && data.errorText) || ("http-" + r.status));
          err.status = r.status; throw err;
        }
        return data;
      });
    });
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (e.source !== window || !m || m.__ez !== "risk-req") return;
    var reply = function (ok, payload, status) {
      window.postMessage({ __ez: "risk-res", id: m.id, ok: ok, data: ok ? payload : undefined, error: ok ? undefined : payload, status: status }, location.origin);
    };
    if (m.op === "status") return reply(true, { signedIn: !!auth.token, env: auth.env });
    call(m.method, m.path, m.body).then(function (d) { reply(true, d); }, function (err) { reply(false, err.message, err.status || 0); });
  });
})();
