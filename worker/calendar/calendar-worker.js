// Cloudflare Worker backing the Economic Calendar page. Proxies a free,
// widely-used (unofficial) ForexFactory calendar JSON feed and adds CORS so
// the browser can fetch it directly. That feed only covers the CURRENT
// week — there's no free "last week"/"next week" variant — so the page
// always shows this week only.
//
// No API key, no persistent storage: just a passthrough with a short edge
// cache so a burst of page loads doesn't turn into a burst of upstream hits.

const UPSTREAM_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    var cache = caches.default;
    var cacheKey = new Request(new URL(request.url).origin + "/calendar-feed", request);
    var cached = await cache.match(cacheKey);
    if (cached) return cached;

    var UPSTREAM_HEADERS = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.forexfactory.com/calendar",
    };

    // The upstream feed is a popular free scrape target, and it rate-limits
    // the shared Cloudflare Workers subrequest pool much more aggressively
    // than ordinary browser traffic — a single 429 here is often really "some
    // other Worker used up the shared quota a moment ago," not us. Retry a
    // couple of times (honoring Retry-After when the origin sends one)
    // before giving up, since each attempt can land on a different Cloudflare
    // colo/IP.
    var upstream;
    var attempts = 3;
    for (var i = 0; i < attempts; i++) {
      try {
        upstream = await fetch(UPSTREAM_URL, { headers: UPSTREAM_HEADERS, cf: { cacheTtl: 600, cacheEverything: true } });
      } catch (err) {
        upstream = null;
      }
      if (upstream && upstream.ok) break;
      if (upstream && upstream.status !== 429 && upstream.status < 500) break; // non-retryable client error
      if (i < attempts - 1) {
        var retryAfterHeader = upstream ? upstream.headers.get("retry-after") : null;
        var delayMs = retryAfterHeader ? Math.min(parseInt(retryAfterHeader, 10) * 1000, 4000) : 500 * (i + 1);
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
      }
    }

    if (!upstream || !upstream.ok) {
      var upstreamBody = upstream ? await upstream.text().catch(function () { return ""; }) : "";
      var upstreamStatus = upstream ? upstream.status : "network error";
      return errorResponse(
        "Calendar feed unavailable (upstream " + upstreamStatus + " after " + attempts + " attempts). " + upstreamBody.slice(0, 200),
        502
      );
    }

    var body = await upstream.text();
    var response = new Response(body, {
      headers: Object.assign(
        // 10-minute edge cache: this data doesn't need to be fresher than
        // that, and it means most page loads never touch upstream at all,
        // which is the real fix for the shared rate limit above.
        { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
        CORS_HEADERS
      ),
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
