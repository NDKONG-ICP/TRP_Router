# TRP Router relay — deploy (owner)

Idempotent single-fetch relay for IC HTTPS outcall consensus. Keys live in Worker secrets, not the canister.

## One-time setup

```bash
cd trp-router/relay
npm install
wrangler login
```

Before deploy, if your shell sourced `trp-router/.env`, run `unset CLOUDFLARE_API_TOKEN` so Wrangler uses OAuth (the AI-only token lacks Workers script access).

## Secrets (production)

```bash
wrangler secret put RELAY_SHARED_SECRET   # same value as canister vault RELAY_SHARED_SECRET
wrangler secret put GROQ_API_KEY
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put GEMINI_API_KEY          # optional
wrangler secret put OPENROUTER_API_KEY      # optional
wrangler secret put ANTHROPIC_API_KEY       # optional platform key; BYOK passes through
```

## Deploy

```bash
wrangler deploy
```

Note the Worker URL (e.g. `https://trp-router-relay.<subdomain>.workers.dev`).

## Wire canister

In `trp-router/.env`:

```
RELAY_URL=https://trp-router-relay.<subdomain>.workers.dev/infer
RELAY_SHARED_SECRET=<same as wrangler secret>
```

Then:

```bash
node scripts/set-vault-from-env.mjs
```

## Local dev

Copy `.dev.vars.example` → `.dev.vars`, fill values, then:

```bash
npm run dev
```

## Coalescing proof

With relay deployed, run twice in parallel with the same body + idempotency_key; `wrangler tail` should show one `upstream_start` and one `coalesce_wait` (or multiple coalesce) per key.

## Direct smoke (before canister)

```bash
curl -sS -X POST "$RELAY_URL" \
  -H "Authorization: Bearer $RELAY_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"provider":"groq","model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"Say hi"}],"idempotency_key":"test-1"}'
```
