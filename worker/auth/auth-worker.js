// Cloudflare Worker backing account sign-up / sign-in and per-account data
// sync (Backtest trade log + the Lucid cockpit's selected plan/size) so a
// person can log in on a different device and pick up where they left off.
//
// This is a hobby-site login, not a banking one: passwords are hashed
// (PBKDF2, salted) rather than stored in plaintext, but there's no email
// verification, password reset, or rate limiting. Good enough to keep
// casual snooping out and to key each person's synced data to an account.
//
// Storage: a single KV namespace (binding "ACCOUNTS") holds four kinds of
// keys —
//   user:<lowercased username>    -> { username, salt, hash, createdAt,
//                                      googleId?, appleId?, verifiedEmail? }
//   session:<token>               -> lowercased username   (TTL'd)
//   data:<lowercased username>    -> { backtest, cockpit, updatedAt }
//   oauth:<provider>:<subjectId>  -> lowercased username
//       (provider is "google" or "apple"; subjectId is that provider's
//       stable user id, the JWT's `sub` claim — this index is how a
//       returning Google/Apple sign-in is matched back to an account
//       without ever storing anything the provider didn't itself vouch for)
//
// salt/hash are null for an account that has only ever signed in via
// Google/Apple — handleLogin and handleChangePassword both guard for that.
//
// OAuth sign-in (handleOAuth below) verifies the provider's ID token
// entirely with public keys (each provider's published JWKS) — no client
// secret involved, so GOOGLE_CLIENT_ID/APPLE_CLIENT_ID (set as plain wrangler
// vars, see wrangler.toml) are the only server-side configuration needed.
// Until they're set, handleOAuth responds 501 rather than pretending to work.

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
function oauthKey(provider, subjectId) { return "oauth:" + provider + ":" + subjectId; }

// ---------- OAuth ID token verification (Google / Apple) ----------
// Both providers hand the client a signed JWT ("ID token") after the user
// authenticates with them directly — this worker never sees a Google/Apple
// password. Verifying it is pure public-key crypto: fetch the provider's
// published JWKS, check the RS256 signature, then check issuer/audience/
// expiry. No client secret is needed for this (that's only required for the
// authorization-code flow, which this site doesn't use).

function base64UrlToBytes(b64url) {
  var b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function base64UrlToJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

var jwksCache = Object.create(null); // url -> { keys, fetchedAt }
var JWKS_CACHE_MS = 60 * 60 * 1000;
async function fetchJwks(url) {
  var cached = jwksCache[url];
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_MS) return cached.keys;
  var res = await fetch(url);
  if (!res.ok) throw new Error("Could not fetch signing keys.");
  var data = await res.json();
  jwksCache[url] = { keys: data.keys || [], fetchedAt: Date.now() };
  return jwksCache[url].keys;
}

async function verifyIdToken(idToken, opts) {
  var parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed token.");
  var header = base64UrlToJson(parts[0]);
  var payload = base64UrlToJson(parts[1]);
  var signature = base64UrlToBytes(parts[2]);
  var signedData = new TextEncoder().encode(parts[0] + "." + parts[1]);

  if (header.alg !== "RS256") throw new Error("Unsupported signing algorithm.");
  var keys = await fetchJwks(opts.jwksUrl);
  var jwk = keys.filter(function (k) { return k.kid === header.kid; })[0];
  if (!jwk) throw new Error("Unknown signing key.");

  var cryptoKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  var valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!valid) throw new Error("Invalid token signature.");

  var now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error("Token expired.");
  if (opts.issuers.indexOf(payload.iss) === -1) throw new Error("Unexpected issuer.");
  if (payload.aud !== opts.audience) throw new Error("Unexpected audience.");
  if (!payload.sub) throw new Error("Token missing subject.");

  return payload;
}

var OAUTH_PROVIDERS = {
  google: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    idField: "googleId",
  },
  apple: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    idField: "appleId",
  },
};

// trader_<6 random lowercase/digit chars> — short, URL-safe, and already
// matches USERNAME_RE, so a brand-new Google/Apple sign-in gets a working
// account without ever prompting for a username up front.
var USERNAME_SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomUsernameSuffix(length) {
  var bytes = crypto.getRandomValues(new Uint8Array(length));
  var out = "";
  for (var i = 0; i < length; i++) out += USERNAME_SUFFIX_CHARS[bytes[i] % USERNAME_SUFFIX_CHARS.length];
  return out;
}
async function provisionUsername(env) {
  for (var attempt = 0; attempt < 8; attempt++) {
    var candidate = "trader_" + randomUsernameSuffix(attempt < 4 ? 6 : 9);
    if (!(await env.ACCOUNTS.get(userKey(candidate)))) return candidate;
  }
  throw new Error("Could not allocate a username.");
}

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
  if (!record.hash || !record.salt) {
    return json({ error: "This account signs in with Google or Apple — use that button instead." }, 401);
  }
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

async function handleChangePassword(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);
  var currentPassword = String(body.currentPassword || "");
  var newPassword = String(body.newPassword || "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json({ error: "New password must be at least " + MIN_PASSWORD_LENGTH + " characters." }, 400);
  }

  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Account not found." }, 404);
  var record = JSON.parse(raw);
  // A Google/Apple-only account has no password yet — let it set one for
  // the first time without requiring a "current" password that never existed.
  if (record.hash && record.salt) {
    var candidateHash = await hashPassword(currentPassword, record.salt);
    if (!timingSafeEqual(candidateHash, record.hash)) {
      return json({ error: "Current password is incorrect." }, 401);
    }
  }

  var saltBytes = crypto.getRandomValues(new Uint8Array(16));
  record.salt = bytesToBase64(saltBytes);
  record.hash = await hashPassword(newPassword, record.salt);
  await env.ACCOUNTS.put(userKey(username), JSON.stringify(record));

  return json({ ok: true });
}

// Sign in (or, for a brand-new Google/Apple identity, silently create an
// account for) whoever the verified ID token says they are. `provider` is
// "google" or "apple" — see OAUTH_PROVIDERS above for each one's JWKS/issuer.
async function handleOAuth(request, env, provider) {
  var cfg = OAUTH_PROVIDERS[provider];
  var audience = provider === "google" ? env.GOOGLE_CLIENT_ID : env.APPLE_CLIENT_ID;
  if (!audience) {
    return json({ error: (provider === "google" ? "Google" : "Apple") + " sign-in isn't configured on the server yet." }, 501);
  }

  var body = await readJson(request);
  if (!body || !body.idToken) return json({ error: "Missing idToken." }, 400);

  var payload;
  try {
    payload = await verifyIdToken(body.idToken, { jwksUrl: cfg.jwksUrl, issuers: cfg.issuers, audience: audience });
  } catch (err) {
    return json({ error: "Could not verify " + provider + " sign-in (" + err.message + ")." }, 401);
  }

  var subjectId = payload.sub;
  var indexKey = oauthKey(provider, subjectId);
  var lookupUsername = await env.ACCOUNTS.get(indexKey); // lowercased, or null
  var record;

  if (!lookupUsername) {
    var newUsername = await provisionUsername(env);
    record = { username: newUsername, salt: null, hash: null, createdAt: new Date().toISOString() };
    record[cfg.idField] = subjectId;
    if (payload.email) record.verifiedEmail = payload.email;
    await env.ACCOUNTS.put(userKey(newUsername), JSON.stringify(record));
    await env.ACCOUNTS.put(indexKey, newUsername.toLowerCase());
  } else {
    var raw = await env.ACCOUNTS.get(userKey(lookupUsername));
    record = raw ? JSON.parse(raw) : null;
    if (!record) return json({ error: "Account not found." }, 404);
    // Apple only includes the email claim on a person's very first
    // authorization — don't overwrite a previously-captured one with nothing.
    if (payload.email && record.verifiedEmail !== payload.email) {
      record.verifiedEmail = payload.email;
      await env.ACCOUNTS.put(userKey(record.username), JSON.stringify(record));
    }
  }

  var token = randomToken();
  await env.ACCOUNTS.put(sessionKey(token), record.username.toLowerCase(), { expirationTtl: SESSION_TTL_SECONDS });
  return json({ token: token, username: record.username });
}

async function handleMe(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Not signed in." }, 401);
  var record = JSON.parse(raw);
  return json({
    username: record.username,
    verifiedEmail: record.verifiedEmail || null,
    hasGoogle: !!record.googleId,
    hasApple: !!record.appleId,
  });
}

// Every page-owned data field this worker stores per account. Opaque JSON
// values — this worker doesn't know or care about their internal shape,
// only that whatever a page sends up comes back unchanged. Keeps the
// frontend free to evolve its own data model without needing this worker
// redeployed every time (adding a new page's field here is the exception).
var DATA_FIELDS = ["backtest", "cockpit", "journal"];

async function handleGetData(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var raw = await env.ACCOUNTS.get(dataKey(username));
  var stored = raw ? JSON.parse(raw) : {};
  var data = {};
  DATA_FIELDS.forEach(function (field) { data[field] = stored[field] !== undefined ? stored[field] : null; });
  data.updatedAt = stored.updatedAt || null;
  return json(data);
}

var MAX_DATA_BYTES = 500000; // ~500KB combined; KV values can hold far more, this is just a sanity cap

async function handlePutData(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var body = await readJson(request);
  if (!body) return json({ error: "Bad request." }, 400);

  var raw = await env.ACCOUNTS.get(dataKey(username));
  var existing = raw ? JSON.parse(raw) : {};
  var next = {};
  DATA_FIELDS.forEach(function (field) {
    next[field] = body[field] !== undefined ? body[field] : (existing[field] !== undefined ? existing[field] : null);
  });
  next.updatedAt = new Date().toISOString();
  var serialized = JSON.stringify(next);
  if (serialized.length > MAX_DATA_BYTES) return json({ error: "Data too large to save." }, 413);
  await env.ACCOUNTS.put(dataKey(username), serialized);
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
    if (path === "/oauth/google" && request.method === "POST") return handleOAuth(request, env, "google");
    if (path === "/oauth/apple" && request.method === "POST") return handleOAuth(request, env, "apple");
    if (path === "/logout" && request.method === "POST") return handleLogout(request, env);
    if (path === "/change-password" && request.method === "POST") return handleChangePassword(request, env);
    if (path === "/me" && request.method === "GET") return handleMe(request, env);
    if (path === "/data" && request.method === "GET") return handleGetData(request, env);
    if (path === "/data" && request.method === "PUT") return handlePutData(request, env);

    return json({ error: "Not found." }, 404);
  },
};
