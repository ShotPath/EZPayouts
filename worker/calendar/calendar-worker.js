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

    var upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.forexfactory.com/calendar",
        },
        cf: { cacheTtl: 60, cacheEverything: true },
      });
    } catch (err) {
      return errorResponse("Couldn't reach the calendar feed.", 502);
    }

    if (!upstream.ok) {
      var upstreamBody = await upstream.text().catch(function () { return ""; });
      return errorResponse(
        "Calendar feed unavailable (upstream " + upstream.status + "). " + upstreamBody.slice(0, 200),
        502
      );
    }

    var body = await upstream.text();
    var response = new Response(body, {
      headers: Object.assign(
        { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
        CORS_HEADERS
      ),
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
