// Cloudflare Worker backing the Economic Calendar page. Proxies a free,
// widely-used (unofficial) ForexFactory calendar JSON feed and adds CORS so
// the browser can fetch it directly. That feed only covers the CURRENT
// week — there's no free "last week"/"next week" variant — so the page
// always shows this week only.
//
// The upstream feed rate-limits Cloudflare Workers traffic specifically
// (it's a common free scrape target, so the shared Workers subrequest pool
// gets throttled harder than ordinary browser traffic) — a request that
// works fine from a plain curl can still come back 429 from here. Retrying
// helps a little, but the real fix is durability: every successful fetch is
// saved to KV (binding "ACCOUNTS", shared with ezpayouts-auth — this worker
// only ever touches its own "calendar:lastGood" key in it) as a global,
// cross-colo fallback. Cloudflare's own edge cache (caches.default) is
// per-colo, so it doesn't help two requests that land in different data
// centers; KV does.

const UPSTREAM_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const KV_KEY = "calendar:lastGood";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const UPSTREAM_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.forexfactory.com/calendar",
};

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

function dataResponse(body, extraHeaders) {
  return new Response(body, {
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS, extraHeaders || {}),
  });
}

// Retries a couple of times on 429/5xx, honoring Retry-After when the
// origin sends one, since each attempt can land on a different Cloudflare
// colo/IP and the rate limit isn't uniform across all of them.
async function fetchUpstream() {
  var attempts = 3;
  var upstream = null;
  for (var i = 0; i < attempts; i++) {
    try {
      upstream = await fetch(UPSTREAM_URL, { headers: UPSTREAM_HEADERS, cf: { cacheTtl: 600, cacheEverything: true } });
    } catch (err) {
      upstream = null;
    }
    if (upstream && upstream.ok) return upstream;
    if (upstream && upstream.status !== 429 && upstream.status < 500) return upstream; // non-retryable
    if (i < attempts - 1) {
      var retryAfterHeader = upstream ? upstream.headers.get("retry-after") : null;
      var delayMs = retryAfterHeader ? Math.min(parseInt(retryAfterHeader, 10) * 1000, 4000) : 500 * (i + 1);
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
  }
  return upstream;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (!env.ACCOUNTS) {
      return errorResponse("Server misconfigured: missing ACCOUNTS KV binding.", 500);
    }

    var cache = caches.default;
    var cacheKey = new Request(new URL(request.url).origin + "/calendar-feed", request);
    var cached = await cache.match(cacheKey);
    if (cached) return cached;

    var upstream = await fetchUpstream();

    if (upstream && upstream.ok) {
      var body = await upstream.text();
      ctx.waitUntil(env.ACCOUNTS.put(KV_KEY, JSON.stringify({ body: body, fetchedAt: new Date().toISOString() })));
      // 10-minute per-colo edge cache on top of the KV fallback: most page
      // loads that land on the same colo as a recent successful fetch never
      // touch upstream (or even KV) at all.
      var response = dataResponse(body, { "Cache-Control": "public, max-age=600" });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Upstream failed (rate limited or otherwise) — fall back to the last
    // successful fetch from ANY colo, however old, rather than an error.
    // Stale calendar data is far more useful than none.
    var fallbackRaw = await env.ACCOUNTS.get(KV_KEY);
    if (fallbackRaw) {
      try {
        var fallback = JSON.parse(fallbackRaw);
        if (fallback && typeof fallback.body === "string") {
          return dataResponse(fallback.body, { "Cache-Control": "no-store", "X-Calendar-Fallback": "stale", "X-Calendar-Fetched-At": fallback.fetchedAt || "" });
        }
      } catch (err) {}
    }

    var upstreamBody = upstream ? await upstream.text().catch(function () { return ""; }) : "";
    var upstreamStatus = upstream ? upstream.status : "network error";
    return errorResponse(
      "Calendar feed unavailable (upstream " + upstreamStatus + "), and no cached fallback yet. " + upstreamBody.slice(0, 200),
      502
    );
  },
};
