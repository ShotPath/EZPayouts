// EZPayouts <-> Tradovate backend proxy (Cloudflare Worker)
//
// Why this exists: Tradovate's API requires exchanging your Tradovate username +
// password for an access token, and that exchange (and the token afterward) can't
// safely happen in the browser — anyone viewing the page's network traffic or
// source could read it. This Worker does that exchange server-side, stores only
// the resulting token (never your password) in Workers KV keyed by a random
// session id, and hands the browser an httpOnly cookie pointing at that session.
//
// KNOWN UNKNOWNS — verify these against a real login before trusting the numbers:
//   - Tradovate may require "device approval" the first time a new device (this
//     Worker) logs in to your account. If /api/login fails with a device-approval
//     style error, check the Tradovate desktop/mobile app for an approval prompt.
//   - The exact field name for account cash balance (assumed "cashBalance" below)
//     and how to compute real per-fill dollar P&L are marked NOTE below — Tradovate's
//     response shape needs to be inspected from a real call and this adjusted.

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
  return `ezp_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=3300`;
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
      cid: Number(env.TRADOVATE_CID),
      sec: env.TRADOVATE_SEC,
      deviceId: crypto.randomUUID(),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.accessToken) {
    // NOTE: "p-ticket" style responses typically mean Tradovate wants this new
    // device approved from inside the Tradovate app first — surface that plainly
    // instead of a generic failure so it's actionable.
    const message = data["p-ticket"]
      ? "Tradovate needs this login approved as a new device — open the Tradovate app, approve it, then try connecting again."
      : data.errorText || "Tradovate rejected that username/password.";
    throw new Error(message);
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

function dayKey(ms, tz = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
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
      { expirationTtl: 3300 } // just under Tradovate's ~80 minute access token life
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
    const cashBalances = await tradovateGet(
      session.base,
      session.accessToken,
      "/v1/cashBalance/list"
    );
    const fills = await tradovateGet(
      session.base,
      session.accessToken,
      "/v1/fill/list"
    );

    // NOTE: using the first account only for now. If you trade more than one
    // account on this login, this needs an account picker — ping me once you
    // see how /v1/account/list actually comes back and we'll add it.
    const account = accounts?.[0] || null;
    const balanceRow = cashBalances?.find((b) => b.accountId === account?.id);

    // NOTE: grouping fills by NY trading day so "days traded" and per-day counts
    // are real. Turning this into real per-day DOLLAR P&L (not just fill counts)
    // needs each fill's realized P&L or a matched buy/sell pair per contract —
    // that requires seeing a real /v1/fill/list response to confirm field names,
    // so treat dailyFillCounts below as a placeholder until we do that pass.
    const byDay = {};
    for (const f of fills || []) {
      const key = dayKey(new Date(f.timestamp).getTime());
      byDay[key] = (byDay[key] || 0) + 1;
    }
    const days = Object.keys(byDay).sort();

    return new Response(
      JSON.stringify({
        ok: true,
        accountName: account?.name || null,
        balance: balanceRow?.cashBalance ?? null, // NOTE: verify this field name
        daysTraded: days.length,
        dailyFillCounts: byDay,
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
