// Risk Management, on trader.tradovate.com: passes the popup's requests to
// tv-hook.js (in the page, where Tradovate's sign-in is) and the answers
// back.
(function () {
  "use strict";
  var waiting = {}, seq = 0;
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (e.source !== window || !m || m.__ez !== "risk-res" || !waiting[m.id]) return;
    waiting[m.id](m);
    delete waiting[m.id];
  });
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "ez-risk" || sender.id !== chrome.runtime.id) return;
    var id = "r" + (++seq) + "-" + Date.now();
    var timer = setTimeout(function () {
      if (!waiting[id]) return;
      delete waiting[id];
      sendResponse({ ok: false, error: "timeout" });
    }, 20000);
    waiting[id] = function (m) {
      clearTimeout(timer);
      sendResponse({ ok: m.ok, data: m.data, error: m.error, status: m.status });
    };
    window.postMessage({ __ez: "risk-req", id: id, op: msg.op, method: msg.method, path: msg.path, body: msg.body }, location.origin);
    return true;
  });
})();
