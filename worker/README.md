# EZPayouts Tradovate backend

Small Cloudflare Worker that handles the Tradovate login exchange and data
pull server-side, so your Tradovate password never touches the browser or
gets stored anywhere. The cockpit's frontend talks to this Worker, not to
Tradovate directly.

## What you need first

1. **A free Cloudflare account** — cloudflare.com/sign-up (no credit card).
2. **Tradovate API credentials (cid/sec)** — check your Tradovate account for
   an "API Access" section (Settings → API Access, or similar — the exact
   location may have moved; search Tradovate's own help docs at
   api.tradovate.com if you can't find it). This generates a client id (`cid`)
   and secret (`sec`) that identify EZPayouts as an application talking to
   Tradovate's API. This is separate from your Tradovate login — you'll enter
   your username/password separately, per login, in the cockpit itself.
   If Tradovate's process asks for an app name, use "EZPayouts" to match
   what the Worker sends.

## One-time setup

```bash
npm install -g wrangler
cd worker
wrangler login          # opens a browser to authorize wrangler against your Cloudflare account
wrangler kv namespace create SESSIONS
```

That last command prints an `id = "..."` line — paste that id into
`wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

Then set your Tradovate app credentials as encrypted secrets (never committed
to the repo):

```bash
wrangler secret put TRADOVATE_CID
wrangler secret put TRADOVATE_SEC
```

## Deploy

```bash
wrangler deploy
```

This prints a URL like `https://ezpayouts-tradovate.<your-subdomain>.workers.dev`.
Copy that URL — it goes into `lucid/index.html` as `TRADOVATE_API_BASE` (search
for that constant near the bottom of the file's `<script>` and replace the
placeholder).

## After deploying

Redeploy the site (push to the repo as usual) with that URL filled in, then
try connecting from the cockpit. If the first login fails:

- **"needs approved as a new device"** — open the Tradovate app, look for a
  device-approval prompt, approve it, then try again from the cockpit.
- **Anything else** — the error message comes straight from Tradovate's API;
  screenshot it and we'll adjust the Worker. The account-summary math
  (`/api/summary` in `worker.js`) is a first pass built from Tradovate's
  documented shape without having tested against a live response, so the
  balance/day numbers may need a field-name fix once we see what a real
  account actually returns.

## What this does and doesn't store

- Your Tradovate **password is never stored** — it's sent once to Tradovate's
  own login endpoint and discarded immediately after.
- The **access token** Tradovate issues back is stored server-side in
  Workers KV, keyed by a random session id, and expires automatically in
  ~55 minutes (matching Tradovate's own token lifetime). Your browser only
  holds that random session id, in an httpOnly cookie it can't read or leak
  via JavaScript.
- Closing the "Disconnect" option in the cockpit (or the session simply
  expiring) deletes that stored token.
