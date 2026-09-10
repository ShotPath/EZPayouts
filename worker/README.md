# EZPayouts Tradovate backend

Small Cloudflare Worker that handles the Tradovate login exchange and data
pull server-side, so your Tradovate password never touches the browser or
gets stored anywhere. The cockpit's frontend talks to this Worker, not to
Tradovate directly.

## What you need first

1. **A free Cloudflare account** — cloudflare.com/sign-up (no credit card).
2. **Tradovate API access** — per Tradovate's own API docs, this needs a LIVE
   account with more than $1,000 in equity, a subscription to "API Access,"
   and an API Key generated from your account. That generates a client id
   (`cid`) and secret (`sec`) that identify EZPayouts as an application
   talking to Tradovate's API — separate from your Tradovate login, which
   you enter per-connection in the cockpit itself, never stored here.
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
try connecting from the cockpit. If the first login fails, the error message
comes straight from Tradovate's API (their `errorText` field) — screenshot it
and we'll adjust the Worker.

The `/api/summary` logic (balance, days traded, best day) is built against
Tradovate's own published OpenAPI spec — `/account/list`,
`/cashBalance/getcashbalancesnapshot` for current balance (`netLiq`), and
`/cashBalanceLog/ldeps` for real per-day dollar P&L (summing each entry's
`delta`, grouped by Tradovate's own `tradeDate`) — so the field names are
verified, not guessed. It's still never been run against a live account
end-to-end, so treat the first real connection as a test run.

## What this does and doesn't store

- Your Tradovate **password is never stored** — it's sent once to Tradovate's
  own login endpoint and discarded immediately after.
- The **access token** Tradovate issues back is stored server-side in
  Workers KV, keyed by a random session id, and expires automatically in
  ~85 minutes (just under Tradovate's documented 90-minute token lifetime).
  Your browser only holds that random session id, in an httpOnly cookie it
  can't read or leak via JavaScript.
- Closing the "Disconnect" option in the cockpit (or the session simply
  expiring) deletes that stored token.
