# TRP Router — BUILD REPORT

**Branch:** `trp-router/build` · **Updated:** 2026-10-22 (relay + blob fix)

## Mainnet

| | |
|--|--|
| **router** | `5723t-oaaaa-aaaao-bbquq-cai` |
| **POST** | https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1 |
| **GET** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |
| **UI** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |

Post-upgrade: `bash scripts/post-upgrade-mainnet.sh` then `node scripts/set-vault-from-env.mjs`

---

## R3 — Blob URL fix ✅

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/image-standard","prompt":"raven test blob url","size":"512x512"}'
```

Example `router_url` (points at **blob_store**, not localhost):

`https://5y35h-dyaaa-aaaao-bbqua-cai.raw.icp0.io/blob/6bcfe90d1f5f0d795fe2899b6c8aec922f47d91aa31a33fcffd8bc263f7187d3`

```bash
curl -sSL -o /dev/null -w "%{http_code} %{size_download}\n" \
  "https://5y35h-dyaaa-aaaao-bbqua-cai.raw.icp0.io/blob/6bcfe90d1f5f0d795fe2899b6c8aec922f47d91aa31a33fcffd8bc263f7187d3"
# 200 37323
```

Router `/blob/…` returns **302** to blob_store (fixes redirect loop).

---

## R4 — Catalog trim ✅

```bash
curl -sS "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/models" | jq '.data | length'
# 18 — on-chain + Pollinations + relay-listed Groq/CF/Claude/Gemini/OR only
```

Non–smoke-tested CF embed/TTS/whisper and deprecated Groq slugs removed.

---

## R5 — Claude ids ✅ (canister mapping)

| TRP id | Anthropic API model |
|--------|---------------------|
| `trp/claude-opus-5-5` | `claude-opus-5-5` |
| `trp/claude-sonnet-5-5` | `claude-sonnet-5-5` |
| `trp/claude-haiku-5-5` | `claude-haiku-5-5` |
| `trp/claude-fable-5-1` | `claude-fable-5-1` |

Public curl proof pending **relay deploy** (BYOK).

---

## R1 — Relay ⚠️ STAGED (built, not deployed)

- Code: `trp-router/relay/` (Worker + Durable Object + `standalone.mjs` fallback).
- **Blocker:** `wrangler deploy` with account API token → `No access to the specified resource` (token lacks Workers deploy). Owner: `wrangler login` or a Workers-capable token, then follow `relay/DEPLOY.md`.

Direct relay smoke (after deploy):

```bash
curl -sS -X POST "$RELAY_URL" \
  -H "Authorization: Bearer $RELAY_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"provider":"groq","model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"hi"}],"idempotency_key":"smoke-1"}'
```

---

## R2 — Canister → relay wiring ✅ (awaits RELAY_URL in vault)

Off-chain chat without relay:

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/groq/openai/gpt-oss-20b","stream":false,"messages":[{"role":"user","content":"hi"}]}'
```

```json
{"error":"off-chain chat requires relay (set RELAY_URL + RELAY_SHARED_SECRET in vault)"}
```

Add to `trp-router/.env`:

```
RELAY_URL=https://<worker-host>/infer
RELAY_SHARED_SECRET=<same as wrangler secret>
```

Then `node scripts/set-vault-from-env.mjs` and re-run Groq / CF / Claude public curls (expected: real completions, no consensus error).

**On-chain** (unchanged, no relay):

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-qwen-0.5b","stream":false,"messages":[{"role":"user","content":"Hi"}]}'
```

---

## Owner checklist (relay go-live)

1. Deploy Worker per `relay/DEPLOY.md` (or run `standalone.mjs` on a single VPS + HTTPS).
2. `wrangler secret put` provider keys + `RELAY_SHARED_SECRET`.
3. Set `RELAY_URL` + `RELAY_SHARED_SECRET` in `.env` → `node scripts/set-vault-from-env.mjs`.
4. Public curl Groq + CF + Claude; paste outputs here.

Payments: `PAYMENTS_ENABLED=false`.
