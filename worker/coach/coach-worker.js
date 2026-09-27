// Cloudflare Worker backing the Backtest page's AI coach chat widget.
// Validates the same session tokens ezpayouts-auth issues (this worker
// shares that worker's KV namespace), rate-limits per account per day so
// a single account can't blow past Google's free-tier limits, injects the
// coach persona plus the caller's current strategy data as context, and
// proxies the actual conversation to Google's Gemini API. The API key
// never reaches the browser.
//
// Requires two things set on this Worker (Cloudflare dashboard):
//   1. A KV binding named "ACCOUNTS" pointing at the SAME namespace bound
//      to ezpayouts-auth (so session tokens created there are recognized
//      here too).
//   2. A secret named "GEMINI_API_KEY" (Settings -> Variables and Secrets
//      -> Add secret -> Encrypt) with a free API key from
//      aistudio.google.com/apikey. Never put this in code or in
//      wrangler.toml.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Cost/quota controls. Adjust freely; these just bound how much a single
// request (and a single account's daily usage) can cost or consume against
// Gemini's free-tier rate limits.
const MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 500;
const MAX_HISTORY_MESSAGES = 16; // last 8 user/assistant turns
const MAX_MESSAGE_CHARS = 1000;
const MAX_TRADES = 250;
const DAILY_MESSAGE_LIMIT = 40;

const COACH_SYSTEM_PROMPT = 'You\'re my trading coach. Personality: high-energy and motivational like Togi, with the trading brain and experience of TJR. Call me "king" or "champ" sometimes. Keep it human and conversational, no corporate talk, no em-dashes (use commas instead).\n\n' +
  "HOW TO TALK TO ME\n" +
  "- Hype my wins for real. When I do something right, say exactly what I did right.\n" +
  "- Acknowledge mistakes straight, but don't assume bad motives. Never say I was revenge trading, chasing, or gambling unless I give you evidence. Ask before you guess why I did something.\n" +
  "- Be direct and use specific numbers. Do the math for me (dollars, points, R, win rates, drawdown room).\n" +
  "- Keep replies short and punchy. No lectures.";

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

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(); })
    .slice(-MAX_HISTORY_MESSAGES)
    .map(function (m) { return { role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }; });
}

// Gemini uses "user" / "model" roles and a {parts:[{text}]} content shape,
// unlike the "user" / "assistant" + plain-string shape everything else
// here (and the browser side) uses.
function toGeminiContents(messages) {
  return messages.map(function (m) {
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
}

async function handleChat(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.GEMINI_API_KEY) return json({ error: "Server misconfigured: missing GEMINI_API_KEY secret." }, 500);

  var allowed = await checkAndBumpRateLimit(env, username);
  if (!allowed) return json({ error: "You've hit today's chat limit. Come back tomorrow, champ." }, 429);

  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);

  var messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Bad request." }, 400);
  }

  var strategyName = String(body.strategyName || "this strategy").slice(0, 60);
  var tradesText = formatTrades(body.trades);
  var system = COACH_SYSTEM_PROMPT +
    "\n\nHere is the trader's real, current backtest data for the strategy \"" + strategyName + "\" " +
    "(Model | Risk:Reward | Result), most recent first. Use only these real trades for any math, " +
    "counts, or win rate. Don't invent trades that aren't listed here:\n\n" + tradesText;

  var geminiRes;
  try {
    geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toGeminiContents(messages),
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
      }
    );
  } catch (err) {
    return json({ error: "Couldn't reach the AI right now. Try again in a bit." }, 502);
  }

  if (!geminiRes.ok) {
    var errText = await geminiRes.text().catch(function () { return ""; });
    return json({ error: "AI request failed (" + geminiRes.status + ").", detail: errText.slice(0, 300) }, 502);
  }

  var data = await geminiRes.json();
  var reply = "";
  var candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
    reply = candidate.content.parts.map(function (p) { return p.text || ""; }).join("").trim();
  }
  if (!reply) return json({ error: "The AI didn't return a reply. Try again." }, 502);

  return json({ reply: reply });
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

    if (path === "/chat" && request.method === "POST") return handleChat(request, env);

    return json({ error: "Not found." }, 404);
  },
};
