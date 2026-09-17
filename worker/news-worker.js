// Cloudflare Worker backing the News page (news/index.html polls this URL
// directly every 15s). Fetches and parses a handful of RSS feeds live on
// every request instead of relying on a scheduled batch job, so headlines
// show up within seconds instead of after a fixed refresh interval.
//
// No persistent storage (KV/D1) on purpose: each request just re-fetches
// and re-parses the feeds fresh. The four sources together always return
// enough recent items (~50-60 combined) to fill the 25-item cap, so there's
// nothing to "remember" between requests.

const MAX_ITEMS = 25;

const FEEDS = [
  "https://www.investing.com/rss/news.rss",
  "https://feeds.content.dowjones.io/public/rss/mw_bulletins",
  "https://www.federalreserve.gov/feeds/press_all.xml",
  "https://www.federalreserve.gov/feeds/speeches.xml",
];

const FED_CHAIR_LASTNAME = "Warsh";

function isFedChairItem(item) {
  var titleStartsWithChair = new RegExp("^" + FED_CHAIR_LASTNAME + "\\s*,", "i").test(item.title || "");
  var linkHasChairSlug = new RegExp("/speech/" + FED_CHAIR_LASTNAME.toLowerCase(), "i").test(item.link || "");
  return titleStartsWithChair || linkHasChairSlug;
}

const MAJOR_KEYWORDS = [
  "fomc",
  "federal reserve",
  "fed chair",
  "rate hike",
  "rate cut",
  "fed hike",
  "fed cut",
  "interest rate decision",
  "rate decision",
  "cpi",
  "inflation",
  "ppi",
  "jobs report",
  "nonfarm payrolls",
  "non-farm payrolls",
  "unemployment rate",
  "recession",
  "gdp",
  "war",
  "invasion",
  "missile",
  "nuclear",
  "emergency",
  "crisis",
  "crash",
  "plunge",
  "tumble",
  "surge",
  "soar",
  "spike",
  "halted",
  "circuit breaker",
  "bankruptcy",
  "bankrupt",
  "default",
  "downgrade",
  "sanctions",
  "ceasefire",
  "shutdown",
  "oil",
  "crude",
  "opec",
  "brent",
  "wti",
  "barrel",
  "pipeline",
  "refinery",
  "strait of hormuz",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

var MAJOR_REGEX = new RegExp("\\b(" + MAJOR_KEYWORDS.map(escapeRegex).join("|") + ")\\b", "i");

function isMajorTitle(title) {
  return MAJOR_REGEX.test(title || "");
}

function extractTag(block, tag) {
  var m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return m ? m[1] : "";
}

function cleanText(s) {
  if (!s) return "";
  var cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) s = cdata[1];
  s = s
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCodePoint(parseInt(dec, 10)); });
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  s = s.replace(/<[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function parseRss(xml) {
  var items = [];
  var blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  blocks.forEach(function (block) {
    var title = cleanText(extractTag(block, "title"));
    var pubDate = cleanText(extractTag(block, "pubDate"));
    var link = cleanText(extractTag(block, "link"));
    var description = cleanText(extractTag(block, "description"));
    if (!title || !pubDate) return;
    var d = new Date(pubDate);
    if (isNaN(d.getTime())) return;
    items.push({
      title: title,
      timestamp: d.toISOString(),
      link: link,
      summary: description.slice(0, 220),
    });
  });
  return items;
}

async function fetchFeed(url) {
  try {
    var res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EZPayoutsNewsBot/1.0)" },
      cf: { cacheTtl: 5, cacheEverything: true },
    });
    if (!res.ok) return [];
    var xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    return [];
  }
}

async function buildFeed() {
  var results = await Promise.all(FEEDS.map(fetchFeed));
  var allItems = [].concat.apply([], results);

  var byKey = new Map();
  allItems.forEach(function (item) {
    var withFlags = {
      id: item.link || item.title + "-" + item.timestamp,
      title: item.title,
      timestamp: item.timestamp,
      major: isMajorTitle(item.title) || isFedChairItem(item),
      summary: item.summary,
    };
    byKey.set(withFlags.id, withFlags);
  });

  return Array.from(byKey.values())
    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })
    .slice(0, MAX_ITEMS);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Edge-cache the assembled JSON for a short window so a burst of page
    // loads doesn't turn into a burst of requests against the upstream RSS
    // feeds (one of them already 403'd us once under repeated hits).
    var cache = caches.default;
    var cacheKey = new Request(new URL(request.url).origin + "/news-feed", request);
    var cached = await cache.match(cacheKey);
    if (cached) return cached;

    var items = await buildFeed();
    var body = JSON.stringify(items);
    var response = new Response(body, {
      headers: Object.assign(
        {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=5",
        },
        CORS_HEADERS
      ),
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
