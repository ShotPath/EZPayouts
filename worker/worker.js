// EZPayouts <-> Tradovate backend proxy (Cloudflare Worker)
//
// Why this exists: Tradovate's API requires exchanging your Tradovate username +
// password for an access token, and that exchange (and the token afterward) can't
// safely happen in the browser — anyone viewing the page's network traffic or
// source could read it. This Worker does that exchange server-side, stores only
// the resulting token (never your password) in Workers KV keyed by a random
// session id, and hands the browser an httpOnly cookie pointing at that session.
//
// Endpoint shapes below are verified against Tradovate's own OpenAPI spec
// (not guessed): /auth/accesstokenrequest, /account/list,
// /cashBalance/getcashbalancesnapshot, /cashBalanceLog/ldeps. Still untested
// against an actual live login, so the first real connect may surface something
// to fix — see worker/README.md.

function corsHeaders(origin, allowedOrigin) {
  const allow = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function setSessionCookie(sessionId) {
  return `ezp_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=5100`;
}

function clearSessionCookie() {
  return `ezp_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

async function tradovateAuth(env, { username, password, environment }) {
  const base =
    environment === "demo"
      ? "https://demo.tradovateapi.com"
      : "https://live.tradovateapi.com";

  const res = await fetch(`${base}/v1/auth/accesstokenrequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: username,
      password: password,
      appId: "EZPayouts",
      appVersion: "1.0",
      // cid is a string per Tradovate's own schema (AccessTokenRequest) — do not
      // coerce to a number, that's a documented API footgun.
      cid: env.TRADOVATE_CID,
      sec: env.TRADOVATE_SEC,
      deviceId: crypto.randomUUID(),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.errorText || !data.accessToken) {
    throw new Error(data.errorText || "Tradovate rejected that username/password.");
  }

  return { base, ...data };
}

async function tradovateGet(base, token, path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Tradovate request to ${path} failed (${res.status}).`);
  }
  return res.json();
}

async function tradovatePost(base, token, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Tradovate request to ${path} failed (${res.status}).`);
  }
  return res.json();
}

// Tradovate's CashBalanceLog entries carry a tradeDate {year, month, day} —
// Tradovate's own trading-day boundary, so no timezone math needed here.
function tradeDateKey(tradeDate) {
  if (!tradeDate) return null;
  var m = String(tradeDate.month).padStart(2, "0");
  var d = String(tradeDate.day).padStart(2, "0");
  return tradeDate.year + "-" + m + "-" + d;
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const { username, password, environment } = body;

  if (!username || !password) {
    return new Response(
      JSON.stringify({ error: "Username and password are required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const auth = await tradovateAuth(env, { username, password, environment });
    const sessionId = crypto.randomUUID();

    await env.SESSIONS.put(
      sessionId,
      JSON.stringify({
        accessToken: auth.accessToken,
        base: auth.base,
        userId: auth.userId,
        name: auth.name,
      }),
      { expirationTtl: 5100 } // just under Tradovate's documented 90 minute access token life
    );

    return new Response(JSON.stringify({ ok: true, name: auth.name || null }), {
      status: 200,
      headers: {
        "Set-Cookie": setSessionCookie(sessionId),
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleSummary(request, env) {
  const sessionId = getCookie(request, "ezp_session");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Not connected." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = await env.SESSIONS.get(sessionId);
  if (!raw) {
    return new Response(
      JSON.stringify({ error: "Session expired — reconnect." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  const session = JSON.parse(raw);

  try {
    const accounts = await tradovateGet(
      session.base,
      session.accessToken,
      "/v1/account/list"
    );

    // NOTE: using the first account only for now. If you trade more than one
    // account on this login, this needs an account picker — ping me once you
    // see how /v1/account/list actually comes back and we'll add it.
    const account = accounts?.[0] || null;
    if (!account) {
      return new Response(
        JSON.stringify({ error: "No Tradovate account found on this login." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const snapshot = await tradovatePost(
      session.base,
      session.accessToken,
      "/v1/cashBalance/getcashbalancesnapshot",
      { accountId: account.id }
    );
    if (snapshot.errorText) throw new Error(snapshot.errorText);

    const logs = await tradovateGet(
      session.base,
      session.accessToken,
      "/v1/cashBalanceLog/ldeps?masterids=" + account.id
    );

    // Real per-day dollar P&L, straight from Tradovate's own cash ledger deltas
    // (trades, commissions, fees — everything that actually moved the balance)
    // grouped by Tradovate's own tradeDate, not fills we'd have to price ourselves.
    const byDay = {};
    for (const entry of logs || []) {
      const key = tradeDateKey(entry.tradeDate);
      if (!key) continue;
      byDay[key] = (byDay[key] || 0) + (entry.delta || 0);
    }
    const days = Object.keys(byDay).sort();
    let bestDay = 0;
    for (const key of days) {
      if (byDay[key] > bestDay) bestDay = byDay[key];
    }

    return new Response(
      JSON.stringify({
        ok: true,
        accountName: account.name || null,
        balance: snapshot.netLiq ?? null,
        daysTraded: days.length,
        bestDay: bestDay,
        dailyPnl: byDay,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleLogout(request, env) {
  const sessionId = getCookie(request, "ezp_session");
  if (sessionId) await env.SESSIONS.delete(sessionId);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Set-Cookie": clearSessionCookie(),
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response;
    if (url.pathname === "/api/login" && request.method === "POST") {
      response = await handleLogin(request, env);
    } else if (url.pathname === "/api/summary" && request.method === "GET") {
      response = await handleSummary(request, env);
    } else if (url.pathname === "/api/logout" && request.method === "POST") {
      response = await handleLogout(request, env);
    } else {
      response = new Response("Not found", { status: 404 });
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
