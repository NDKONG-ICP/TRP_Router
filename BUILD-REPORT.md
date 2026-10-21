# TRP Router — BUILD REPORT

**Branch:** `trp-router/build` · **Updated:** 2026-10-21 (W1–W3 + W6 core)

## Mainnet IDs & URLs

| | |
|--|--|
| **router** | `5723t-oaaaa-aaaao-bbquq-cai` |
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` |
| **llama (beta)** | `5ryw3-vqaaa-aaaao-bbqvq-cai` |
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **POST API** | https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1 |
| **GET API** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |

After every router wasm upgrade run: `bash scripts/post-upgrade-mainnet.sh`

---

## W1 — Public HTTP POST (FIXED)

`http_request` returns `upgrade: true` for POST `/v1/chat/completions`, `/v1/images/generations`.

### Public curl proof — chat

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-qwen-0.5b","stream":false,"messages":[{"role":"user","content":"Say hi in 3 words"}]}'
```

Response (2026-10-21):

```json
{"id":"trp-chat","object":"chat.completion","model":"trp/onchain-qwen-0.5b","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"on_chain_update_calls":2}
```

### Public curl proof — image

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/image-standard","prompt":"gold raven icon minimal","size":"512x512"}'
```

Response includes `"provider":"pollinations-flux"` and `"url":"/blob/<sha256>"`.

---

## W2 — Catalog (41 models)

```bash
curl -sS "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/models" | jq '.data | length'
# 41
```

Groq / Cloudflare chat: **code live**; public curl requires vault keys (`scripts/set-vault-from-env.mjs` + `.env`). Without keys → 402 BYOK message.

Removed unloaded `trp/onchain-llama-3.2-1b` from catalog.

---

## W3 — Claude BYOK

Models: `trp/claude-opus-5-5`, `trp/claude-sonnet-5-5`, `trp/claude-haiku-5-5`, `trp/claude-fable-5-1`.

Without key:

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/claude-haiku-5-5","stream":false,"messages":[{"role":"user","content":"Hi"}]}'
# {"error":"BYOK required: attach Anthropic API key (0% fee)"}
```

With `ANTHROPIC_API_KEY` in vault: owner runs `node scripts/set-vault-from-env.mjs` then re-run curl for live Claude text.

---

## W4 — Video · **STAGED**

Not implemented this pass (stretch). No `trp/video-*` in catalog yet.

## W5 — RAVEN on-chain models

**W5b `trp/onchain-raven-chat`** — deployed (Raven system persona on Qwen engine). Catalog shows `owned_by: raven`.

Public curl (2026-10-21, after router upgrade):

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-raven-chat","stream":false,"messages":[{"role":"user","content":"Who are you?"}]}'
```

**Blocker:** `llama_cpp_qwen25` (`5ryw3-vqaaa-aaaao-bbqvq-cai`) returned **out of cycles** — owner must top up before on-chain chat (Qwen + Raven) works again. Earlier same session Qwen returned real completions before llama exhausted cycles.

**W5a `trp/onchain-raven-art`** — **STAGED** (no layered trait PNGs located in repo this pass; compositor not shipped).

## W6 — Dashboard · **LIVE (beta)**

https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router — HTTP 200 (2026-10-21 deploy `--no-asset-upgrade`).

Model browser (live catalog from raw.icp0.io), playground (POST via icp0.io), status, DRAFT banners, amethyst/gold styling (`routerPage.css`). OpenAI SDK snippet uses certified POST base URL.

## W7 — MCP · **STAGED**

## W8 — Swap UI · **partial**

`/ascension` shows awaiting-activation copy; swap remains disabled (no `activateSwap`).

## W9 — Path C · **STAGED**

---

## Owner optional

- `trp-router/.env` + `node scripts/set-vault-from-env.mjs` for Groq/CF/Anthropic/Gemini.
- Legal review of DRAFT UI strings.
- Top up `5ryw3-…` if on-chain inference traps on cycles.

Payments: `PAYMENTS_ENABLED=false`.
