# TRP Router — BUILD REPORT

**Branch:** `trp-router/build` · **Updated:** 2026-10-22

## Mainnet IDs & URLs

| | |
|--|--|
| **router** | `5723t-oaaaa-aaaao-bbquq-cai` |
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` |
| **llama (beta)** | `5ryw3-vqaaa-aaaao-bbqvq-cai` |
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **POST API** | https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1 |
| **GET API** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |
| **MCP stub** | GET/POST https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/mcp |

After every router wasm upgrade: `bash scripts/post-upgrade-mainnet.sh` then `node scripts/set-vault-from-env.mjs` (vault keys are not stable across upgrades today).

---

## W1 — Public HTTP POST ✅

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-qwen-0.5b","stream":false,"messages":[{"role":"user","content":"Say hi in 3 words"}]}'
```

```json
{"id":"trp-chat","object":"chat.completion","model":"trp/onchain-qwen-0.5b","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"on_chain_update_calls":2}
```

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/image-standard","prompt":"gold raven icon minimal","size":"512x512"}'
```

→ `"provider":"pollinations-flux"`, `"url":"/blob/<sha256>"`.

---

## W2 — Catalog + vault ✅ (listing); Groq/CF chat ⚠️

```bash
curl -sS "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/models" | jq '.data | length'
```

**43** models (Groq ids aligned to key’s `/v1/models` list: `openai/gpt-oss-20b`, etc.).

Vault loader fixed: `node scripts/set-vault-from-env.mjs` (single-quoted Candid — no shell quote breaks).

**Groq / Cloudflare / Anthropic HTTPS chat from the canister:** vault keys load, but **replica consensus** often fails on non-deterministic LLM bodies (`SysTransient No consensus`). On-chain chat + Pollinations image + on-chain raven-art **do** work. Off-chain LLM outcalls need a follow-up (deterministic proxy or response normalization) — not curl-proven end-to-end yet.

---

## W3 — Claude BYOK ⚠️

Catalog ids map to Anthropic API model strings (e.g. `trp/claude-haiku-5-5` → `claude-3-5-haiku-20241022`). Vault `ANTHROPIC_API_KEY` loaded via script.

Same **consensus** caveat as Groq when calling from the canister; BYOK per-caller path unchanged.

---

## W5 — RAVEN on-chain ✅ (art + chat)

**Chat** — header `X-TRP-On-Chain: true`:

```bash
curl -sS -D - -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-raven-chat","stream":false,"messages":[{"role":"user","content":"Who are you? One sentence."}]}'
```

**Art** — procedural compositor (`raven-onchain-compositor`):

```bash
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"model":"trp/onchain-raven-art","prompt":"midnight raven test","size":"512x512"}'
```

→ `/blob/31edcb37dc66b3ff58c6b5a4ddb4774dbebbc39fb17f981599c72db4db05876e` (example).

Trait layer hunt: see `RAVEN-ART-LAYERS.md` (Sk8Punks = composites only; no layer PNGs in repo).

---

## W6 — Dashboard ✅

https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router — Dev quickstart + **MCP curl snippet**.

---

## W7 — MCP stub ✅

```bash
curl -sS "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/mcp"
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.icp0.io/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chat","arguments":{"model":"trp/onchain-qwen-0.5b","messages":[{"role":"user","content":"Hi"}]}}}'
```

→ `tools/list` + `tools/call` chat returns on-chain completion JSON.

---

## W8 — Swap UI ✅ (inert admin)

- `/ascension` — **88 : 00 : 00 : 00** placeholder countdown when inactive; swap panel disabled.
- `/admin` → **Ascension** tab — owner-only **Activate swap (inert)** button (disabled; no `activateSwap` called).

---

## W4 / W9 — STAGED

Video models not wired. Path C: `PATH-C-MEASURE.md`.

---

## Ops notes

- Topped **router** with **1.5T cycles** (was ~280B; deploy was failing IC0207).
- **`5ryw3-…` llama:** owner added 6T — on-chain inference working again.
- Re-run vault script after each router upgrade.

Payments: `PAYMENTS_ENABLED=false`.
