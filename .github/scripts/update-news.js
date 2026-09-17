// Pulls recent market-news headlines from a couple of free RSS feeds (no
// API key, no subscription — verified working directly before shipping
// this) and merges them into news/data.json in the shape the News page
// already expects: { id, title, timestamp, major, summary }
//
// "Major" isn't a real impact rating (RSS headlines don't carry one) —
// it's a keyword match against the title. Less precise than a true
// economic-calendar impact level, but costs nothing and needs no signup.

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "..", "news", "data.json");
const MAX_ITEMS = 25;

// Both verified live and free (no key) before this script was written.
// WSJ's markets RSS was tried too but its feed turned out to be frozen
// (stale content over a year old) so it was dropped.
const FEEDS = [
  "https://www.investing.com/rss/news.rss",
  "https://feeds.content.dowjones.io/public/rss/mw_topstories",
];

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

// Word-boundary matching, not plain substring: a plain indexOf() match on
// "war" also fires inside "forward guidance", "warehouse", "toward" etc,
// and "oil" inside "boil"/"spoil"/"turmoil" — false positives that would
// have mislabeled a lot of ordinary headlines as major.
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
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2019;/g, "’")
    .replace(/&#8217;/g, "’");
  s = s.replace(/<[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function parseRss(xml) {
  var items = [];
  var blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  blocks.forEach(function (block) {
    var title = cleanText(extractTag(block, "title"));
    var pubDate = extractTag(block, "pubDate").trim();
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
    });
    if (!res.ok) {
      console.log("Feed failed (" + res.status + "): " + url);
      return [];
    }
    var xml = await res.text();
    var items = parseRss(xml);
    console.log("Fetched " + items.length + " items from " + url);
    return items;
  } catch (err) {
    console.log("Feed error for " + url + ": " + err.message);
    return [];
  }
}

async function main() {
  var allItems = [];
  for (var i = 0; i < FEEDS.length; i++) {
    var items = await fetchFeed(FEEDS[i]);
    allItems = allItems.concat(items);
  }

  var newItems = allItems.map(function (item) {
    return {
      id: item.link || item.title + "-" + item.timestamp,
      title: item.title,
      timestamp: item.timestamp,
      major: isMajorTitle(item.title),
      summary: item.summary,
    };
  });

  var existing = [];
  try {
    var raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (Array.isArray(raw)) existing = raw;
  } catch (err) {
    existing = [];
  }

  var byKey = new Map();
  existing.forEach(function (item) {
    byKey.set(item.id || item.title, item);
  });
  newItems.forEach(function (item) {
    byKey.set(item.id, item);
  });

  var merged = Array.from(byKey.values())
    .sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    })
    .slice(0, MAX_ITEMS);

  fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    "Wrote " + merged.length + " items to " + DATA_PATH + " (" + newItems.length + " fetched this run)."
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
