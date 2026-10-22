# TRP Router — BUILD REPORT

**Branch:** `trp-router/build` · **Updated:** 2026-10-22 (relay live)

## Mainnet

| | |
|--|--|
| **router** | `5723t-oaaaa-aaaao-bbquq-cai` |
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` |
| **relay** | `https://trp-router-relay.floridaman.workers.dev/infer` |
| **POST/GET API** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 (POST chat verified) |
| **UI** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |

After router wasm upgrade: `bash scripts/post-upgrade-mainnet.sh` then `node scripts/set-vault-from-env.mjs`

---

## Relay (R1 + R2) ✅

- Worker + **sqlite** Durable Object (`new_sqlite_classes` on free plan).
- Direct relay smoke (2026-10-22):

```bash
curl -sS -X POST "https://trp-router-relay.floridaman.workers.dev/infer" \
  -H "Authorization: Bearer <RELAY_SHARED_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"groq","model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"Say exactly: relay-ok"}],"idempotency_key":"direct-smoke-1"}'
```

```json
{"ok":true,"content":"relay-ok","upstream_calls":1}
```

Canister vault: `set_relay_config` via `scripts/set-vault-from-env.mjs` (`RELAY_URL` + `RELAY_SHARED_SECRET` in owner `.env` only — not committed).

**Wrangler note:** use OAuth (`wrangler login`) and `unset CLOUDFLARE_API_TOKEN` before deploy — the Workers AI token in `.env` lacks Workers script permissions.

---

## Public curl — off-chain chat (consensus fixed) ✅

Base: `https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1`

### Groq

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/groq/openai/gpt-oss-20b","stream":false,"messages":[{"role":"user","content":"Say exactly: groq-ok"}]}'
```

```json
{"id":"trp-chat","object":"chat.completion","model":"trp/groq/openai/gpt-oss-20b","choices":[{"index":0,"message":{"role":"assistant","content":"groq-ok"},"finish_reason":"stop"}]}
```

### Cloudflare LLM

**InferCoordinator fix (2026-10-22):** 120s TTL (memory + DO storage), in-flight promise before upstream, identical serialized JSON for all waiters/stragglers.

**10 consecutive public curls** — `trp/cf/@cf/meta/llama-3.2-1b-instruct` (2026-10-22, all HTTP 200, **0** consensus failures):

```bash
BASE="https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1"
for i in $(seq 1 10); do
  curl -sS -X POST "${BASE}/chat/completions" -H "Content-Type: application/json" \
    -d "{\"model\":\"trp/cf/@cf/meta/llama-3.2-1b-instruct\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: run-${i}\"}]}"
done
```

| Run | Outcome |
|-----|---------|
| 1–6 | OK (`choices` present, assistant content returned) |
| 7 | OK (`content`: `lala`) |
| 8 | OK (`content`: `Run`) |
| 9 | OK (`content`: `run`) |
| 10 | OK (`content`: `Run.`) |

**`trp/cf/@cf/meta/llama-3.1-8b-instruct`:** **not** in `/v1/models` (intentionally omitted). Direct curl → `{"error":"unknown or unsupported chat model: trp/cf/@cf/meta/llama-3.1-8b-instruct"}` — not advertised as callable.

Example single-shot:

```json
{"id":"trp-chat","object":"chat.completion","model":"trp/cf/@cf/meta/llama-3.2-1b-instruct","choices":[{"index":0,"message":{"role":"assistant","content":"I'm ready to respond."},"finish_reason":"stop"}]}
```

### Claude (platform Anthropic key on relay)

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/claude-haiku-5-5","stream":false,"messages":[{"role":"user","content":"Reply with exactly: claude-ok"}]}'
```

```json
{"id":"trp-chat","object":"chat.completion","model":"trp/claude-haiku-5-5","choices":[{"index":0,"message":{"role":"assistant","content":"claude-ok"},"finish_reason":"stop"}]}
```

No `No consensus could be reached` on these runs (2026-10-22).

---

## Blob URLs (R3) ✅

`router_url` → `https://5y35h-dyaaa-aaaao-bbqua-cai.raw.icp0.io/blob/<hash>` — curl returns image bytes (200).

---

## Catalog (R4)

18 smoke-listed models on `/v1/models`.

Payments: `PAYMENTS_ENABLED=false`.
