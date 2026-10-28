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
//                                      googleId?, appleId?, verifiedEmail?,
//                                      mergedInto? (see handleOAuthLink),
//                                      pro? (see Billing below) }
//   session:<token>               -> lowercased username   (TTL'd)
//   data:<lowercased username>    -> { backtest, cockpit, journal, updatedAt }
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
//
// Trade screenshots live in a separate R2 bucket (binding "IMAGES"), one
// object per image at key "<lowercased username>/<id>", NOT in KV — they're
// binary and can be a few hundred KB each, which would blow past KV's
// per-account data budget fast if bundled into the same JSON blob as
// backtest/cockpit/journal. An <img> tag can't send an Authorization header,
// so GET /images/:id takes the session token as a query param (?t=) instead
// of a Bearer header — same session token as everywhere else, just handed to
// the browser's own image loader instead of fetch(). Until IMAGES is bound,
// the image endpoints respond 501 rather than pretending to work.

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tradovate-Token",
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
function pendingOauthKey(token) { return "oauthPending:" + token; }

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

async function usernameForToken(token, env) {
  if (!token) return null;
  var username = await env.ACCOUNTS.get(sessionKey(token));
  return username || null;
}
async function requireSession(request, env) {
  var auth = request.headers.get("Authorization") || "";
  var m = auth.match(/^Bearer\s+(.+)$/i);
  return usernameForToken(m ? m[1] : null, env);
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

  if (!lookupUsername) {
    // Brand-new identity: don't create the account yet — let the person
    // choose their own username first (see handleOAuthComplete) instead of
    // silently handing them a random trader_xxxxx one. The verified identity
    // is stashed behind a short-lived pending token rather than re-sending
    // the ID token on the follow-up call, since Google/Apple ID tokens are
    // effectively single-use and may already be stale by then.
    var pendingToken = randomToken();
    var suggested = await provisionUsername(env);
    await env.ACCOUNTS.put(pendingOauthKey(pendingToken), JSON.stringify({
      provider: provider,
      subjectId: subjectId,
      email: payload.email || null,
    }), { expirationTtl: 600 });
    return json({ needsUsername: true, pendingToken: pendingToken, suggestedUsername: suggested, email: payload.email || null });
  }

  var raw = await env.ACCOUNTS.get(userKey(lookupUsername));
  var record = raw ? JSON.parse(raw) : null;
  if (!record) return json({ error: "Account not found." }, 404);
  // Apple only includes the email claim on a person's very first
  // authorization — don't overwrite a previously-captured one with nothing.
  if (payload.email && record.verifiedEmail !== payload.email) {
    record.verifiedEmail = payload.email;
    await env.ACCOUNTS.put(userKey(record.username), JSON.stringify(record));
  }

  var token = randomToken();
  await env.ACCOUNTS.put(sessionKey(token), record.username.toLowerCase(), { expirationTtl: SESSION_TTL_SECONDS });
  return json({ token: token, username: record.username });
}

// Finishes a brand-new Google/Apple signup once the person has picked a
// username for the pending identity handleOAuth stashed above.
async function handleOAuthComplete(request, env) {
  var body = await readJson(request);
  if (!body || !body.pendingToken) return json({ error: "Missing pendingToken." }, 400);
  var username = String(body.username || "").trim();
  if (!USERNAME_RE.test(username)) {
    return json({ error: "Username must be 3-20 characters: letters, numbers, underscore." }, 400);
  }

  var pendingRaw = await env.ACCOUNTS.get(pendingOauthKey(body.pendingToken));
  if (!pendingRaw) return json({ error: "This sign-in has expired — please try again." }, 400);
  var pending = JSON.parse(pendingRaw);

  var existing = await env.ACCOUNTS.get(userKey(username));
  if (existing) return json({ error: "That username is already taken." }, 409);

  var cfg = OAUTH_PROVIDERS[pending.provider];
  var record = { username: username, salt: null, hash: null, createdAt: new Date().toISOString() };
  record[cfg.idField] = pending.subjectId;
  if (pending.email) record.verifiedEmail = pending.email;

  await env.ACCOUNTS.put(userKey(username), JSON.stringify(record));
  await env.ACCOUNTS.put(oauthKey(pending.provider, pending.subjectId), username.toLowerCase());
  await env.ACCOUNTS.delete(pendingOauthKey(body.pendingToken));

  var token = randomToken();
  await env.ACCOUNTS.put(sessionKey(token), username.toLowerCase(), { expirationTtl: SESSION_TTL_SECONDS });
  return json({ token: token, username: username });
}

// Attaches a Google/Apple identity to the ALREADY SIGNED-IN account instead
// of signing in as (or creating) a separate one — e.g. someone who first
// made a username/password account wants "Sign in with Google" to resolve
// to that same account next time, not a brand-new one.
async function handleOAuthLink(request, env, provider) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);

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
  var existingOwner = await env.ACCOUNTS.get(indexKey);
  var movedFrom = null;
  if (existingOwner && existingOwner !== username.toLowerCase()) {
    // Signing in with Google before linking it makes a second account
    // (handleOAuthComplete). If that account has no password, this Google
    // sign-in is its only key, and the person holding it just proved it's
    // theirs: move the link here and bring that account's trades along.
    // An account with a password is someone's own login; leave it alone.
    var otherRaw = await env.ACCOUNTS.get(userKey(existingOwner));
    var other = otherRaw ? JSON.parse(otherRaw) : null;
    if (other && other.hash) {
      return json({ error: "That " + (provider === "google" ? "Google" : "Apple") + " account is already linked to a different EZPayouts account." }, 409);
    }
    if (other) {
      await moveSyncedData(env, other.username, username);
      delete other[cfg.idField];
      other.mergedInto = username.toLowerCase();
      await env.ACCOUNTS.put(userKey(other.username), JSON.stringify(other));
      movedFrom = other.username;
    }
  }

  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Account not found." }, 404);
  var record = JSON.parse(raw);
  record[cfg.idField] = subjectId;
  if (payload.email) record.verifiedEmail = payload.email;
  await env.ACCOUNTS.put(userKey(username), JSON.stringify(record));
  await env.ACCOUNTS.put(indexKey, username.toLowerCase());

  return json({
    ok: true,
    username: record.username,
    verifiedEmail: record.verifiedEmail || null,
    hasGoogle: !!record.googleId,
    hasApple: !!record.appleId,
    movedFrom: movedFrom,
  });
}

// ---------- Moving one account's synced trades into another ----------
// Used when a Google link moves off a Google-only account (above). The
// journal and Backtest log are merged the way the site's sync merges two
// devices (sync.js): items both have keep the newer edit (`_u`), anything
// only one has is kept, and deletions either recorded still apply. The
// source account's copy is left as it was.
function newerItem(a, b) { return (a._u || 0) >= (b._u || 0) ? a : b; }
function unionById(into, from, tomb, mergeBoth) {
  var out = [];
  var fromMap = {};
  (from || []).forEach(function (x) { if (x && x.id) fromMap[x.id] = x; });
  var used = {};
  function alive(item) { return !tomb[item.id] || (item._u || 0) > tomb[item.id]; }
  (into || []).forEach(function (x) {
    if (!x || !x.id) return;
    used[x.id] = true;
    var m = fromMap[x.id] ? (mergeBoth ? mergeBoth(x, fromMap[x.id]) : newerItem(x, fromMap[x.id])) : x;
    if (alive(m)) out.push(m);
  });
  (from || []).forEach(function (x) {
    if (x && x.id && !used[x.id] && alive(x)) out.push(x);
  });
  return out;
}
function unionTombstones(a, b) {
  var out = {};
  [a, b].forEach(function (t) {
    if (!t || typeof t !== "object") return;
    Object.keys(t).forEach(function (id) { if (!out[id] || t[id] > out[id]) out[id] = t[id]; });
  });
  return out;
}
function journalShape(j) {
  if (!j || typeof j !== "object") return null;
  if (Array.isArray(j.accounts)) return j;
  if (Array.isArray(j.trades)) return { accounts: [{ id: "acc_default", name: "Main", trades: j.trades }], activeAccountId: "acc_default" };
  return null;
}
function backtestShape(b) {
  if (Array.isArray(b)) return { strategies: [{ id: "s1", name: "Strategy 1" }], activeId: "s1", entriesByStrategy: { s1: b } };
  return b && typeof b === "object" && b.entriesByStrategy ? b : null;
}
function mergeJournal(into, from) {
  into = journalShape(into); from = journalShape(from);
  if (!from) return into;
  if (!into) return from;
  var tomb = unionTombstones(into.tombstones, from.tombstones);
  var accounts = unionById(into.accounts, from.accounts, tomb, function (a, b) {
    var out = Object.assign({}, newerItem(a, b));
    out.trades = unionById(a.trades, b.trades, tomb);
    if (Array.isArray(a.strategies) || Array.isArray(b.strategies)) out.strategies = unionById(a.strategies, b.strategies, tomb);
    return out;
  });
  return { accounts: accounts, activeAccountId: into.activeAccountId || from.activeAccountId || null, tombstones: tomb };
}
function mergeBacktest(into, from) {
  into = backtestShape(into); from = backtestShape(from);
  if (!from) return into;
  if (!into) return from;
  var tomb = unionTombstones(into.tombstones, from.tombstones);
  var strategies = unionById(into.strategies, from.strategies, tomb);
  var entriesByStrategy = {};
  strategies.forEach(function (s) {
    entriesByStrategy[s.id] = unionById((into.entriesByStrategy || {})[s.id], (from.entriesByStrategy || {})[s.id], tomb);
  });
  return { strategies: strategies, activeId: into.activeId || from.activeId || null, entriesByStrategy: entriesByStrategy, tombstones: tomb };
}
async function moveSyncedData(env, fromUsername, intoUsername) {
  var fromRaw = await env.ACCOUNTS.get(dataKey(fromUsername));
  if (!fromRaw) return;
  var from = JSON.parse(fromRaw);
  var intoRaw = await env.ACCOUNTS.get(dataKey(intoUsername));
  var into = intoRaw ? JSON.parse(intoRaw) : {};
  var next = {
    backtest: mergeBacktest(into.backtest, from.backtest),
    cockpit: into.cockpit || from.cockpit || null,
    journal: mergeJournal(into.journal, from.journal),
    updatedAt: new Date().toISOString(),
  };
  await env.ACCOUNTS.put(dataKey(intoUsername), JSON.stringify(next));
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
    pro: proActive(record.pro),
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

// Sanity cap on the combined synced data (KV allows 25MB per value). 500KB
// was hit by journals with a few broker CSV imports, and the rejected
// uploads meant trades silently stopped syncing.
var MAX_DATA_BYTES = 5000000;

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

// ---------- Trade screenshot storage (R2) ----------
var IMAGE_ID_RE = "rimg_[a-f0-9]{32}";
var MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB — the client already compresses to well under this
var ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function imageObjectKey(username, id) { return username.toLowerCase() + "/" + id; }

async function handleImageUpload(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.IMAGES) return json({ error: "Image sync isn't configured on the server yet." }, 501);

  var contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (ALLOWED_IMAGE_TYPES.indexOf(contentType) === -1) {
    return json({ error: "Unsupported image type." }, 400);
  }
  var buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: "Empty upload." }, 400);
  if (buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image too large (max 2MB)." }, 413);

  var id = "rimg_" + crypto.randomUUID().replace(/-/g, "");
  await env.IMAGES.put(imageObjectKey(username, id), buf, { httpMetadata: { contentType: contentType } });
  return json({ id: id });
}

// Authenticated via ?t=<session token> instead of a Bearer header — an
// <img src> can't set custom headers, so the token has to ride in the URL.
// Same session token as the rest of the app; it's just handed to the
// browser's own image loader here instead of to fetch().
async function handleImageGet(request, env, id) {
  if (!env.IMAGES) return json({ error: "Image sync isn't configured on the server yet." }, 501);
  var url = new URL(request.url);
  var username = await usernameForToken(url.searchParams.get("t"), env);
  if (!username) return json({ error: "Not signed in." }, 401);

  var object = await env.IMAGES.get(imageObjectKey(username, id));
  if (!object) return json({ error: "Not found." }, 404);
  var headers = Object.assign({
    "Content-Type": (object.httpMetadata && object.httpMetadata.contentType) || "application/octet-stream",
    "Cache-Control": "private, max-age=86400",
  }, CORS_HEADERS);
  return new Response(object.body, { headers: headers });
}

async function handleImageDelete(request, env, id) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.IMAGES) return json({ error: "Image sync isn't configured on the server yet." }, 501);
  await env.IMAGES.delete(imageObjectKey(username, id));
  return json({ ok: true });
}


// ---------- Billing (EZPayouts Pro, through Stripe) ----------
// Pro unlocks the rest of the Chart Skins extension. Paying happens on
// Stripe's own Checkout page; Stripe then tells this worker (its webhook)
// and the account's record keeps
//   pro: { status, periodEnd, plan, customer, subscription, cancelAtPeriodEnd }
// Settings (wrangler.toml / secrets): STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET (secrets), STRIPE_PRICE_MONTH and STRIPE_PRICE_YEAR
// (the two prices' IDs), SITE_ORIGIN. Until the key is set, /billing/*
// responds 501 rather than pretending to work.
const PRO_GRACE_SECONDS = 60 * 60 * 24 * 3; // a late renewal keeps Pro for 3 days

function siteOrigin(env) { return env.SITE_ORIGIN || "https://ezpayouts.xyz"; }

async function stripe(env, method, path, params) {
  var body = params ? new URLSearchParams(params).toString() : undefined;
  var res = await fetch("https://api.stripe.com/v1/" + path + (method === "GET" && body ? "?" + body : ""), {
    method: method,
    headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2025-03-31.basil" },
    body: method === "GET" ? undefined : body,
  });
  var out = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error((out.error && out.error.message) || ("Stripe " + res.status));
  return out;
}

function proActive(pro) {
  if (!pro) return false;
  var live = pro.status === "active" || pro.status === "trialing" || pro.status === "past_due";
  return live && (pro.periodEnd || 0) + PRO_GRACE_SECONDS > Date.now() / 1000;
}
function proView(pro) {
  return {
    pro: proActive(pro),
    status: pro ? pro.status : null,
    plan: pro ? pro.plan : null,
    periodEnd: pro ? pro.periodEnd : null,
    cancelAtPeriodEnd: !!(pro && pro.cancelAtPeriodEnd),
  };
}

async function handleBillingCheckout(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments aren't set up on the server yet." }, 501);
  var body = (await readJson(request)) || {};
  var price = body.plan === "year" ? env.STRIPE_PRICE_YEAR : env.STRIPE_PRICE_MONTH;
  if (!price) return json({ error: "That plan isn't set up yet." }, 501);
  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Not signed in." }, 401);
  var record = JSON.parse(raw);
  if (proActive(record.pro)) return json({ error: "You already have Pro." }, 409);
  var params = {
    "mode": "subscription",
    "managed_payments[enabled]": "true", // Stripe is the seller of record and handles sales tax / VAT
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "client_reference_id": record.username,
    "subscription_data[metadata][username]": record.username.toLowerCase(),
    "allow_promotion_codes": "true",
    "success_url": siteOrigin(env) + "/pro/?paid=1",
    "cancel_url": siteOrigin(env) + "/pro/",
  };
  if (record.pro && record.pro.customer) params.customer = record.pro.customer;
  else if (record.verifiedEmail) params.customer_email = record.verifiedEmail;
  try {
    var session = await stripe(env, "POST", "checkout/sessions", params);
    return json({ url: session.url });
  } catch (err) {
    return json({ error: "Couldn't start checkout: " + err.message }, 502);
  }
}

async function handleBillingPortal(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments aren't set up on the server yet." }, 501);
  var raw = await env.ACCOUNTS.get(userKey(username));
  var record = raw ? JSON.parse(raw) : null;
  if (!record || !record.pro || !record.pro.customer) return json({ error: "No subscription on this account." }, 404);
  try {
    var portal = await stripe(env, "POST", "billing_portal/sessions", { customer: record.pro.customer, return_url: siteOrigin(env) + "/pro/" });
    return json({ url: portal.url });
  } catch (err) {
    return json({ error: "Couldn't open billing: " + err.message }, 502);
  }
}

async function handleBillingStatus(request, env) {
  var username = await requireSession(request, env);
  if (!username) return json({ error: "Not signed in." }, 401);
  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return json({ error: "Not signed in." }, 401);
  var record = JSON.parse(raw);
  return json(Object.assign({ username: record.username }, proView(record.pro)));
}

// Stripe signs each webhook: "t=<time>,v1=<HMAC-SHA256 of '<time>.<body>'>".
async function verifyStripeSignature(env, header, payload) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  var parts = {};
  header.split(",").forEach(function (kv) {
    var i = kv.indexOf("=");
    if (i > 0) (parts[kv.slice(0, i)] = parts[kv.slice(0, i)] || []).push(kv.slice(i + 1));
  });
  var t = parts.t && parts.t[0];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + payload)));
  var hex = Array.from(mac, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  return (parts.v1 || []).some(function (sig) {
    if (sig.length !== hex.length) return false;
    var diff = 0;
    for (var i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  });
}

async function saveSubscription(env, username, sub) {
  if (!username || !sub) return;
  var raw = await env.ACCOUNTS.get(userKey(username));
  if (!raw) return;
  var record = JSON.parse(raw);
  // A leftover old subscription ending mustn't switch off a newer one.
  var live = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  if (!live && record.pro && record.pro.subscription && record.pro.subscription !== sub.id && proActive(record.pro)) return;
  var item = sub.items && sub.items.data && sub.items.data[0];
  var priceId = item && item.price && item.price.id;
  var periodEnd = sub.current_period_end || (item && item.current_period_end) || 0;
  record.pro = {
    status: sub.status,
    periodEnd: periodEnd,
    plan: priceId === env.STRIPE_PRICE_YEAR ? "year" : "month",
    customer: typeof sub.customer === "string" ? sub.customer : (sub.customer && sub.customer.id),
    subscription: sub.id,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };
  await env.ACCOUNTS.put(userKey(username), JSON.stringify(record));
}

async function handleBillingWebhook(request, env) {
  var payload = await request.text();
  if (!(await verifyStripeSignature(env, request.headers.get("Stripe-Signature"), payload))) {
    return json({ error: "Bad signature." }, 400);
  }
  var event;
  try { event = JSON.parse(payload); } catch (err) { return json({ error: "Bad request." }, 400); }
  var obj = event.data && event.data.object;
  try {
    if (event.type === "checkout.session.completed" && obj && obj.subscription) {
      var sub = await stripe(env, "GET", "subscriptions/" + obj.subscription);
      await saveSubscription(env, obj.client_reference_id || (sub.metadata && sub.metadata.username), sub);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type) && obj) {
      // Events can arrive out of order, so save the subscription as it is now, not as the event saw it.
      var current = await stripe(env, "GET", "subscriptions/" + obj.id);
      await saveSubscription(env, (current.metadata && current.metadata.username) || (obj.metadata && obj.metadata.username), current);
    }
  } catch (err) {
    return json({ error: err.message }, 500); // Stripe retries
  }
  return json({ received: true });
}


// ---------------------------------------------------------------------------
// Tradovate relay (the Risk page). Tradovate's API only answers browsers on
// its own approved sites, so the page's calls come through here and go
// straight on to Tradovate: nothing is stored or logged. Signed-in EZPayouts
// users only, and only the calls the Risk page makes: signing in, listing
// accounts, and reading/writing auto-liquidation and position limits.
// The page's own session rides in Authorization; Tradovate's token in
// X-Tradovate-Token.
const TRADOVATE_HOSTS = { live: "https://live.tradovateapi.com/v1/", demo: "https://demo.tradovateapi.com/v1/" };
const TRADOVATE_PATHS = [
  /^auth\/accesstokenrequest$/i,
  /^auth\/renewaccesstoken$/i,
  /^account\/list$/,
  /^userAccountAutoLiq\/(deps|create|update)$/,
  /^userAccountPositionLimit\/(deps|create|update)$/,
];

async function handleTradovate(request, env, rest) {
  var username = await requireSession(request, env);
  if (!username) return json({ errorText: "Sign in to EZPayouts first." }, 401);
  var m = /^(live|demo)\/(.+)$/.exec(rest);
  if (!m || !TRADOVATE_PATHS.some(function (re) { return re.test(m[2]); })) return json({ errorText: "Not allowed." }, 403);
  var url = new URL(request.url);
  var target = TRADOVATE_HOSTS[m[1]] + m[2] + url.search;
  var headers = { "Accept": "application/json" };
  var tv = request.headers.get("X-Tradovate-Token");
  if (tv) headers["Authorization"] = "Bearer " + tv;
  var init = { method: request.method, headers: headers };
  if (request.method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = await request.text();
  }
  try {
    var res = await fetch(target, init);
    var body = await res.text();
    return new Response(body || "{}", {
      status: res.status,
      headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, CORS_HEADERS),
    });
  } catch (err) {
    return json({ errorText: "Couldn't reach Tradovate. Try again in a moment." }, 502);
  }
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
    if (path === "/oauth/complete" && request.method === "POST") return handleOAuthComplete(request, env);
    if (path === "/oauth/google/link" && request.method === "POST") return handleOAuthLink(request, env, "google");
    if (path === "/oauth/apple/link" && request.method === "POST") return handleOAuthLink(request, env, "apple");
    if (path === "/logout" && request.method === "POST") return handleLogout(request, env);
    if (path === "/change-password" && request.method === "POST") return handleChangePassword(request, env);
    if (path === "/me" && request.method === "GET") return handleMe(request, env);
    if (path === "/data" && request.method === "GET") return handleGetData(request, env);
    if (path === "/data" && request.method === "PUT") return handlePutData(request, env);

    if (path.indexOf("/tradovate/") === 0 && (request.method === "GET" || request.method === "POST")) {
      return handleTradovate(request, env, path.slice("/tradovate/".length));
    }
    if (path === "/billing/checkout" && request.method === "POST") return handleBillingCheckout(request, env);
    if (path === "/billing/portal" && request.method === "POST") return handleBillingPortal(request, env);
    if (path === "/billing/status" && request.method === "GET") return handleBillingStatus(request, env);
    if (path === "/billing/webhook" && request.method === "POST") return handleBillingWebhook(request, env);

    if (path === "/images" && request.method === "POST") return handleImageUpload(request, env);
    var imageMatch = path.match(new RegExp("^/images/(" + IMAGE_ID_RE + ")$"));
    if (imageMatch && request.method === "GET") return handleImageGet(request, env, imageMatch[1]);
    if (imageMatch && request.method === "DELETE") return handleImageDelete(request, env, imageMatch[1]);

    return json({ error: "Not found." }, 404);
  },
};
