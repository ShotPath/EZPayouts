// Cloudflare Worker backing account sign-up / sign-in and per-account data
// sync (Backtest trade log + the Lucid cockpit's selected plan/size) so a
// person can log in on a different device and pick up where they left off.
//
// This is a hobby-site login, not a banking one: passwords are hashed
// (PBKDF2, salted) rather than stored in plaintext, but there's no email
// verification, password reset, or rate limiting. Good enough to keep
// casual snooping out and to key each person's synced data to an account.
//
// Storage: a single KV namespace (binding "ACCOUNTS") holds three kinds of
// keys —
//   user:<lowercased username>    -> { username, salt, hash, createdAt }
//   session:<token>               -> lowercased username   (TTL'd)
//   data:<lowercased username>    -> { backtest, cockpit, updatedAt }

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

function bytesToBase64(bytes) {
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function hashPassword(password, saltB64) {
  var enc = new TextEncoder();
  var keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  var saltBytes = Uint8Array.from(atob(saltB64), function (c) { return c.charCodeAt(0); });
  var bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function userKey(username) { return "user:" + username.toLowerCase(); }
function sessionKey(token) { return "session:" + token; }
function dataKey(username) { return "data:" + username.toLowerCase(); }

async function readJson(request) {
  try { return await request.json(); } catch (err) { return null; }
}

async function requireSession(request, env) {
  var auth = request.headers.get("Authorization") || "";
  var m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  var username = await env.ACCOUNTS.get(sessionKey(m[1]));
  return username || null;
}

async function handleSignup(request, env) {
  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);
  var username = String(body.username || "").trim();
  var password = String(body.password || "");

  if (!USERNAME_RE.test(username)) {
    return json({ error: "Username must be 3-20 characters: letters, numbers, underscore." }, 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: "Password must be at least " + MIN_PASSWORD_LENGTH + " characters." }, 400);
  }

  var existing = await env.ACCOUNTS.get(userKey(username));
  if (existing) return json({ error: "That username is already taken." }, 409);

  var saltBytes = crypto.getRandomValues(new Uint8Array(16));
  var salt = bytesToBase64(saltBytes);
  var hash = await hashPassword(password, salt);

  await env.ACCOUNTS.put(userKey(username), JSON.stringify({
    username: username,
    salt: salt,
    hash: hash,
    createdAt: new Date().toISOString(),
  }));

  var token = randomToken();
  await env.ACCOUNTS.put(sessionKey(token), username.toLowerCase(), { expirationTtl: SESSION_TTL_SECONDS });

  return json({ token: token, username: username });
}

async function handleLogin(request, env) {
  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);
  var username = String(body.username || "").trim();
  var password = String(body.password || "");

  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Incorrect username or password." }, 401);
  var record = JSON.parse(raw);
  var candidateHash = await hashPassword(password, record.salt);
  if (!timingSafeEqual(candidateHash, record.hash)) {
    return json({ error: "Incorrect username or password." }, 401);
  }

  var token = randomToken();
  await env.ACCOUNTS.put(sessionKey(token), username.toLowerCase(), { expirationTtl: SESSION_TTL_SECONDS });

  return json({ token: token, username: record.username });
}

async function handleLogout(request, env) {
  var auth = request.headers.get("Authorization") || "";
  var m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) await env.ACCOUNTS.delete(sessionKey(m[1]));
  return json({ ok: true });
}

async function handleMe(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Not signed in." }, 401);
  var record = JSON.parse(raw);
  return json({ username: record.username });
}

async function handleGetData(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var raw = await env.ACCOUNTS.get(dataKey(username));
  var data = raw ? JSON.parse(raw) : { backtest: [], cockpit: null, updatedAt: null };
  return json(data);
}

async function handlePutData(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);

  var raw = await env.ACCOUNTS.get(dataKey(username));
  var existing = raw ? JSON.parse(raw) : { backtest: [], cockpit: null };
  var next = {
    backtest: Array.isArray(body.backtest) ? body.backtest.slice(0, 500) : existing.backtest || [],
    cockpit: body.cockpit !== undefined ? body.cockpit : existing.cockpit || null,
    updatedAt: new Date().toISOString(),
  };
  await env.ACCOUNTS.put(dataKey(username), JSON.stringify(next));
  return json(next);
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

    if (path === "/signup" && request.method === "POST") return handleSignup(request, env);
    if (path === "/login" && request.method === "POST") return handleLogin(request, env);
    if (path === "/logout" && request.method === "POST") return handleLogout(request, env);
    if (path === "/me" && request.method === "GET") return handleMe(request, env);
    if (path === "/data" && request.method === "GET") return handleGetData(request, env);
    if (path === "/data" && request.method === "PUT") return handlePutData(request, env);

    return json({ error: "Not found." }, 404);
  },
};
