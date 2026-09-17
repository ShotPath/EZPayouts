// Pulls recent US economic-calendar releases from Financial Modeling Prep,
// keeps only the events that actually move index futures, and merges them
// into news/data.json in the shape the News page already expects:
//   { id, title, timestamp, major, summary }
//
// Requires FMP_API_KEY in the environment (set as a GitHub Actions secret).
// Free-tier FMP account: https://site.financialmodelingprep.com/register

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.FMP_API_KEY;
if (!API_KEY) {
  console.error("Missing FMP_API_KEY environment variable.");
  process.exit(1);
}

const DATA_PATH = path.join(__dirname, "..", "..", "news", "data.json");
const MAX_ITEMS = 25;

// Event-name substrings worth showing on a futures-trader news feed.
// FMP's "event" field names vary slightly release to release, so this
// matches loosely (case-insensitive substring) rather than exact strings.
const RELEVANT_EVENT_KEYWORDS = [
  "CPI",
  "PPI",
  "Nonfarm Payrolls",
  "Non-Farm Payrolls",
  "Unemployment Rate",
  "Initial Jobless Claims",
  "Continuing Jobless Claims",
  "FOMC",
  "Fed Interest Rate",
  "Federal Funds Rate",
  "Fed Chair",
  "GDP",
  "Retail Sales",
  "ISM Manufacturing",
  "ISM Services",
  "ISM Non-Manufacturing",
  "PCE Price Index",
  "Core PCE",
  "Consumer Confidence",
  "Michigan Consumer Sentiment",
  "Durable Goods",
  "Housing Starts",
  "Building Permits",
];

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function isRelevant(eventName) {
  var name = (eventName || "").toLowerCase();
  return RELEVANT_EVENT_KEYWORDS.some(function (kw) {
    return name.indexOf(kw.toLowerCase()) !== -1;
  });
}

function isUsEvent(e) {
  var country = (e.country || "").toUpperCase();
  return country === "US" || country === "USA" || country === "USD";
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// FMP retired /api/v3/economic_calendar for non-legacy accounts (cutoff Aug 31,
// 2025) in favor of a new /stable/ route, but their docs site blocks
// automated fetches so the exact route name couldn't be confirmed ahead of
// time. Try the candidates in order and use whichever first returns a real
// array; whichever one wins gets logged so the list can be trimmed later.
var CANDIDATE_PATHS = [
  "stable/economics-calendar",
  "stable/economic-calendar",
  "stable/economic_calendar",
  "api/v3/economic_calendar",
];

async function fetchCalendar(from, to) {
  var lastError = null;
  for (var i = 0; i < CANDIDATE_PATHS.length; i++) {
    var routePath = CANDIDATE_PATHS[i];
    var url =
      "https://financialmodelingprep.com/" +
      routePath +
      "?from=" +
      fmtDate(from) +
      "&to=" +
      fmtDate(to) +
      "&apikey=" +
      API_KEY;
    var res = await fetch(url);
    var bodyText = await res.text();
    if (res.ok) {
      var parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        parsed = null;
      }
      if (Array.isArray(parsed)) {
        console.log("Using economic calendar route: " + routePath);
        return parsed;
      }
      lastError = "Route " + routePath + " returned OK but not an array: " + bodyText.slice(0, 300);
    } else {
      lastError = "Route " + routePath + " failed (" + res.status + "): " + bodyText.slice(0, 300);
    }
    console.log(lastError);
  }
  throw new Error("No working economic calendar route found. Last error: " + lastError);
}

async function main() {
  var to = new Date();
  var from = new Date(to.getTime() - 4 * 24 * 60 * 60 * 1000); // look back 4 days
  var events = await fetchCalendar(from, to);

  // First-run visibility: log a couple of raw events so field names can be
  // double-checked against what this script assumes below.
  console.log("Sample raw events:", JSON.stringify(events.slice(0, 2), null, 2));

  var relevant = events.filter(function (e) {
    return isUsEvent(e) && isRelevant(e.event);
  });

  var released = relevant.filter(function (e) {
    return e.actual !== null && e.actual !== undefined && e.actual !== "";
  });

  var newItems = released.map(function (e) {
    var actual = toNumberOrNull(e.actual);
    var estimate = toNumberOrNull(e.estimate);
    var previous = toNumberOrNull(e.previous);
    var unit = e.unit || "";
    var impact = (e.impact || "").toLowerCase();
    var isMajor = impact === "high";

    var actualStr = actual === null ? String(e.actual) : actual + unit;
    var estimateStr = estimate === null ? "n/a" : estimate + unit;
    var previousStr = previous === null ? "n/a" : previous + unit;

    return {
      id: e.event + "-" + e.date,
      title: e.event + ": " + actualStr + " (forecast " + estimateStr + ", prior " + previousStr + ")",
      timestamp: new Date(e.date).toISOString(),
      major: isMajor,
      summary:
        "Actual came in at " +
        actualStr +
        " vs. a forecast of " +
        estimateStr +
        " and a prior reading of " +
        previousStr +
        ".",
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
  console.log("Wrote " + merged.length + " items to " + DATA_PATH + " (" + newItems.length + " new/updated this run).");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
