// Cloudflare Worker backing the Backtest page's AI coach chat widget.
// Validates the same session tokens ezpayouts-auth issues (this worker
// shares that worker's KV namespace), rate-limits per account per day so
// a single account can't run up a big bill, injects the coach persona plus
// the caller's current strategy data as context, and proxies the actual
// conversation to Anthropic's Claude API (Haiku 4.5). The API key never
// reaches the browser.
//
// Requires two things set on this Worker (Cloudflare dashboard):
//   1. A KV binding named "ACCOUNTS" pointing at the SAME namespace bound
//      to ezpayouts-auth (so session tokens created there are recognized
//      here too).
//   2. A secret named "ANTHROPIC_API_KEY" (Settings -> Variables and
//      Secrets -> Add secret -> Encrypt). Get a key (and add billing,
//      there's no free tier) at console.anthropic.com. Never put this in
//      code or in wrangler.toml.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Cost/quota controls. Adjust freely; these just bound how much a single
// request (and a single account's daily usage) can cost or consume.
const MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 500;
const MAX_HISTORY_MESSAGES = 16; // last 8 user/assistant turns
const MAX_MESSAGE_CHARS = 1000;
const MAX_TRADES = 250;
const DAILY_MESSAGE_LIMIT = 200;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BASE64_CHARS = 8000000; // ~6MB raw, comfortably under Anthropic's 10MB base64 cap

// Bump this string on every code change. Lets us confirm a dashboard paste
// actually deployed by hitting GET /version (no auth needed) instead of
// relying on someone manually eyeballing the editor.
const WORKER_VERSION = "2026-09-29-page-aware-v1";

const COACH_SYSTEM_PROMPT = 'You\'re my trading coach. Personality: high-energy and motivational like Togi, with the trading brain and experience of TJR. Call me "king" or "champ" sometimes. Keep it human and conversational, no corporate talk, no em-dashes (use commas instead).\n\n' +
  "HOW TO TALK TO ME\n" +
  "- Hype my wins for real. When I do something right, say exactly what I did right.\n" +
  "- Acknowledge mistakes straight, but don't assume bad motives. Never say I was revenge trading, chasing, or gambling unless I give you evidence. Ask before you guess why I did something.\n" +
  "- Be direct and use specific numbers. Do the math for me (dollars, points, R, win rates, drawdown room).\n" +
  "- Keep replies short and punchy. No lectures.\n\n" +
  "ENERGY: Bring more hype, for real. When the numbers back it up, actually sound pumped, don't just state facts flatly. Use phrases like " +
  "\"that's exactly what a real edge looks like\", \"huge W\", \"let's go\". Call out consistency across a big sample as a big deal, because " +
  "it is. Don't fake hype for numbers that don't earn it, but when they do, let it show.";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

async function readJson(request) {
  try { return await request.json(); } catch (err) { return null; }
}

function sessionKey(token) { return "session:" + token; }

async function requireSession(request, env) {
  var auth = request.headers.get("Authorization") || "";
  var m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  var username = await env.ACCOUNTS.get(sessionKey(m[1]));
  return username || null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function checkAndBumpRateLimit(env, username) {
  var key = "coachlimit:" + todayKey() + ":" + username;
  var raw = await env.ACCOUNTS.get(key);
  var count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= DAILY_MESSAGE_LIMIT) return false;
  await env.ACCOUNTS.put(key, String(count + 1), { expirationTtl: 60 * 60 * 30 }); // 30h, comfortably past a UTC day
  return true;
}

function formatTrades(trades) {
  if (!Array.isArray(trades) || !trades.length) return "(no trades logged for this strategy yet)";
  return trades.slice(0, MAX_TRADES).map(function (t) {
    var model = String(t.model || "").slice(0, 80);
    var rr = String(t.rrDisplay || "").slice(0, 20);
    var result = t.result === "loss" ? "Loss" : t.result === "breakeven" ? "Breakeven" : "Win";
    return model + " | " + rr + " | " + result;
  }).join("\n");
}

function fmtSigned(n) {
  var s = n.toFixed(2).replace(/\.00$/, "");
  return (n > 0 ? "+" : "") + s + "R";
}

function batchWinRate(arr) {
  var w = 0, l = 0;
  arr.forEach(function (t) {
    if (t.result === "win") w++;
    else if (t.result === "loss") l++;
  });
  var d = w + l;
  return d ? ((w / d) * 100).toFixed(1) + "%" : "n/a";
}

// The model is bad at doing this math itself from a raw trade list (users
// kept having to correct it), so compute the real numbers here and hand
// them over as ground truth instead of asking the AI to add it all up.
function computeStats(trades) {
  if (!Array.isArray(trades) || !trades.length) return "(no trades logged yet, so no stats to report)";
  var wins = 0, losses = 0, breakevens = 0, netR = 0;
  trades.forEach(function (t) {
    var rr = typeof t.rrMultiple === "number" && isFinite(t.rrMultiple) ? t.rrMultiple : 0;
    if (t.result === "win") { wins++; netR += rr; }
    else if (t.result === "loss") { losses++; netR -= 1; }
    else { breakevens++; }
  });
  var total = trades.length;
  var decided = wins + losses;
  var winRate = decided ? ((wins / decided) * 100).toFixed(1) + "%" : "n/a (no decided trades yet)";
  var avgR = fmtSigned(netR / total);

  // Trades arrive most-recent-first; reverse to chronological order for
  // streaks and the batch-consistency split.
  var chrono = trades.slice().reverse();
  var decidedChrono = chrono.filter(function (t) { return t.result === "win" || t.result === "loss"; });

  var longestWinStreak = 0, longestLossStreak = 0, curWinStreak = 0, curLossStreak = 0;
  decidedChrono.forEach(function (t) {
    if (t.result === "win") { curWinStreak++; curLossStreak = 0; if (curWinStreak > longestWinStreak) longestWinStreak = curWinStreak; }
    else { curLossStreak++; curWinStreak = 0; if (curLossStreak > longestLossStreak) longestLossStreak = curLossStreak; }
  });

  var lines = [
    "Total trades: " + total,
    "Wins: " + wins,
    "Losses: " + losses,
    "Breakevens: " + breakevens,
    "Win rate (wins / (wins + losses), breakevens excluded): " + winRate,
    "Net R: " + fmtSigned(netR),
    "Average R per trade: " + avgR,
    "Longest winning streak: " + longestWinStreak + " in a row",
    "Longest losing streak: " + longestLossStreak + " in a row",
  ];

  // Only worth showing once there's a real sample on each side.
  if (total >= 10) {
    var half = Math.floor(chrono.length / 2);
    lines.push(
      "First half of trades (oldest " + half + ") win rate: " + batchWinRate(chrono.slice(0, half)),
      "Second half of trades (most recent " + (chrono.length - half) + ") win rate: " + batchWinRate(chrono.slice(half))
    );
  }

  return lines.join("\n");
}

// Defensive backstop in case a reply still comes back with markdown syntax
// (### headers, **bold**, * bullets), which just shows as literal symbols
// in a plain chat bubble.
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^[*-]\s+/gm, "- ")
    .trim();
}

// Claude's Messages API already uses "user"/"assistant" roles with plain
// string content, matching the shape the browser sends, so no remapping
// is needed here (unlike Gemini, which used "model" and a parts array).
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(); })
    .slice(-MAX_HISTORY_MESSAGES)
    .map(function (m) { return { role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }; });
}

const RETRYABLE_STATUSES = { 429: true, 500: true, 529: true };

// Shared by /chat and /analyze: posts to the Messages API, and if Claude is
// rate limited or briefly overloaded, retries once instead of surfacing it.
async function callClaudeWithRetry(env, requestBody) {
  var payload = JSON.stringify(requestBody);
  async function attempt() {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: payload,
    });
  }
  var res = await attempt();
  if (RETRYABLE_STATUSES[res.status]) {
    var retryAfter = res.headers.get("retry-after");
    var delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 5000) : 600;
    await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    res = await attempt();
  }
  return res;
}

function claudeTextContent(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content
    .filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text || ""; })
    .join("")
    .trim();
}

var MAX_PAGE_DATA_CHARS = 4000;

// The coach is shared across every page (coach.js); each page hands over
// window.EZPageContext(), an arbitrary { pageName, data } snapshot of
// what's on screen. Backtest-shaped data (a trades array) gets the accurate
// pre-computed-stats treatment below, since the model is bad at that math
// from a raw list; anything else is just handed over as JSON, since we
// can't know its shape ahead of time.
function buildPageContext(pageName, pageData) {
  var name = String(pageName || "this page").slice(0, 60);

  if (pageData && typeof pageData === "object" && Array.isArray(pageData.trades)) {
    var strategyName = String(pageData.strategyName || "this strategy").slice(0, 60);
    var tradesText = formatTrades(pageData.trades);
    var statsText = computeStats(pageData.trades);
    return "\n\nThe trader is on the \"" + name + "\" page, looking at the strategy \"" + strategyName + "\".\n\n" +
      "Here is the full trade list (Model | Risk:Reward | Result), most recent first. This is only for " +
      "referencing or quoting specific individual trades by name. Don't invent trades that aren't listed here:\n\n" +
      tradesText +
      "\n\nHere are the trader's exact, already-computed stats for this same strategy, calculated by counting " +
      "the trade list above:\n\n" + statsText +
      "\n\nIMPORTANT: If asked anything about win count, loss count, breakeven count, total trades, win rate, " +
      "net R, average R, winning/losing streaks, or the first-half-vs-second-half consistency split, answer " +
      "using ONLY the numbers in the stats block directly above, exactly as given. Do not recount, re-tally, or " +
      "re-derive these numbers yourself by reading through the trade list, even to double check. You will get " +
      "them wrong if you try. The stats block is already correct, just report it.";
  }

  var dataText = "(nothing specific)";
  if (pageData !== null && pageData !== undefined) {
    try {
      dataText = JSON.stringify(pageData).slice(0, MAX_PAGE_DATA_CHARS);
    } catch (err) {
      dataText = "(couldn't read the page data)";
    }
  }
  return "\n\nThe trader is currently on the \"" + name + "\" page of the site. Here is exactly what's showing " +
    "on their screen right now, as JSON:\n\n" + dataText +
    "\n\nUse only this real information to answer questions about what they're looking at. Don't invent numbers " +
    "or details that aren't in this data.";
}

async function handleChat(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY secret." }, 500);

  var allowed = await checkAndBumpRateLimit(env, username);
  if (!allowed) return json({ error: "You've hit today's chat limit. Come back tomorrow, champ." }, 429);

  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);

  var messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Bad request." }, 400);
  }

  var system = COACH_SYSTEM_PROMPT +
    "\n\nFORMATTING: This reply is shown in a plain text chat bubble, not a document. " +
    "Never use markdown, no ### headers, no **bold**, no bullet lists with * or -. " +
    "Just write in plain conversational sentences or short lines separated by line breaks." +
    buildPageContext(body.pageName, body.pageData);

  var claudeRes;
  try {
    claudeRes = await callClaudeWithRetry(env, {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: system,
      messages: messages,
    });
  } catch (err) {
    return json({ error: "Couldn't reach the AI right now. Try again in a bit." }, 502);
  }

  if (!claudeRes.ok) {
    var errText = await claudeRes.text().catch(function () { return ""; });
    return json({ error: "AI request failed (" + claudeRes.status + ").", detail: errText.slice(0, 300) }, 502);
  }

  var reply = claudeTextContent(await claudeRes.json());
  if (!reply) return json({ error: "The AI didn't return a reply. Try again." }, 502);

  return json({ reply: stripMarkdown(reply) });
}

// Screenshots come from a chart platform (e.g. TradingView) with entry/stop/
// target markup, not printed trade-history numbers, so the model has to
// interpret the visual setup rather than read exact figures off the image.
const ANALYZE_SYSTEM = "You analyze a single screenshot of a trading chart for a trader's backtest log. " +
  "Look at any markup on the chart (entry, stop loss, take profit lines or boxes, order blocks, fair value gaps, " +
  "trendlines, liquidity marks, breaker blocks, etc) and the visible price action.\n\n" +
  "Respond with ONLY a single JSON object, no markdown, no code fences, no extra text, in exactly this shape:\n" +
  "{\"model\":\"short descriptive setup name, 3-6 words\",\"rrDisplay\":\"risk:reward like 1:2, or a plain number " +
  "like 2, or empty string if you truly cannot tell\",\"result\":\"win, loss, breakeven, or unknown\",\"notes\":" +
  "\"one short sentence describing what you see\"}\n\n" +
  "Rules: If entry, stop, and target are all visibly marked, estimate rrDisplay from the marked distances. Only " +
  "set result to \"win\" or \"loss\" if the chart clearly shows price reaching the target or the stop after " +
  "entry. If the chart only shows the setup with no visible outcome, or you're not confident, use \"unknown\" " +
  "for result and leave rrDisplay empty rather than guessing. Never invent specific price levels or numbers you " +
  "can't actually see.";

async function handleAnalyze(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY secret." }, 500);

  var allowed = await checkAndBumpRateLimit(env, username);
  if (!allowed) return json({ error: "You've hit today's chat limit. Come back tomorrow, champ." }, 429);

  var body = await readJson(request);
  var image = body && body.image;
  if (!image || typeof image.data !== "string" || typeof image.mediaType !== "string") {
    return json({ error: "Bad request." }, 400);
  }
  if (ALLOWED_IMAGE_TYPES.indexOf(image.mediaType) === -1) {
    return json({ error: "Unsupported image type." }, 400);
  }
  if (image.data.length > MAX_IMAGE_BASE64_CHARS) {
    return json({ error: "Image too large. Try a smaller screenshot." }, 413);
  }

  var claudeRes;
  try {
    claudeRes = await callClaudeWithRetry(env, {
      model: MODEL,
      max_tokens: 300,
      system: ANALYZE_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: "Analyze this trade chart screenshot for my backtest log." },
        ],
      }],
    });
  } catch (err) {
    return json({ error: "Couldn't reach the AI right now. Try again in a bit." }, 502);
  }

  if (!claudeRes.ok) {
    var errText = await claudeRes.text().catch(function () { return ""; });
    return json({ error: "AI request failed (" + claudeRes.status + ").", detail: errText.slice(0, 300) }, 502);
  }

  var text = claudeTextContent(await claudeRes.json());
  var match = text.match(/\{[\s\S]*\}/);
  var parsed = null;
  if (match) {
    try { parsed = JSON.parse(match[0]); } catch (err) { parsed = null; }
  }
  if (!parsed) return json({ error: "Couldn't read that screenshot. Try a clearer one or fill it in manually." }, 502);

  return json({
    model: typeof parsed.model === "string" ? parsed.model.slice(0, 60) : "",
    rrDisplay: typeof parsed.rrDisplay === "string" ? parsed.rrDisplay.slice(0, 16) : "",
    result: ["win", "loss", "breakeven"].indexOf(parsed.result) !== -1 ? parsed.result : "unknown",
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "",
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (!env.ACCOUNTS) {
      return json({ error: "Server misconfigured: missing ACCOUNTS KV binding." }, 500);
    }

    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/version" && request.method === "GET") return json({ version: WORKER_VERSION });
    if (path === "/chat" && request.method === "POST") return handleChat(request, env);
    if (path === "/analyze" && request.method === "POST") return handleAnalyze(request, env);

    return json({ error: "Not found." }, 404);
  },
};
