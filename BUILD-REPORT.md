# TRP Router — BUILD REPORT

**Branch:** `trp-router/build`  
**Updated:** 2026-10-21 — **mainnet beta complete**  
**Identity:** `ic_deploy_plain` · **Cycles wallet:** `daf6l-jyaaa-aaaao-a4nba-cai`

## Mainnet canister IDs

| Canister | ID | Status |
|----------|-----|--------|
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` | Live |
| **router_canister** | `5723t-oaaaa-aaaao-bbquq-cai` | Live |
| **llama_cpp_qwen25** | `5ryw3-vqaaa-aaaao-bbqvq-cai` | **Live (BETA)** — Qwen2.5-0.5B q8_0 loaded |
| **http_transform** | `5wzqp-yiaaa-aaaao-bbqva-cai` | Unused (transform on router) |

## Live URLs

| Surface | URL |
|---------|-----|
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **API** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |
| **On-chain chat (BETA)** | `POST …/v1/chat/completions` + `X-TRP-On-Chain: true` · model `trp/onchain-qwen-0.5b` |
| **Image gen** | `POST …/v1/images/generations` → on-chain `/blob/<sha256>` |

## Mainnet smoke (verified)

| Test | Result |
|------|--------|
| `node scripts/test-mainnet-image.mjs` | **PASS** (Pollinations + blob) |
| `node scripts/test-mainnet-chat.mjs` | **PASS** — e.g. `"Hello, how can I help you today?"` |
| `GET /v1/status` | `onchain_models_ready=true`, `payments_enabled=false` |

**GGUF:** sha256 `ca59ca7f…` · 675_710_816 bytes · onicai wasm **v0.22.0** (see `VERSIONS.md`).

## Staged / owner optional

- **TRP payments:** `PAYMENTS_ENABLED=false` — UI shows “coming at token launch.”
- **Provider keys:** no `trp-router/.env` on deploy host — add Cloudflare/Gemini + `node scripts/wire-mainnet-router.mjs`.
- **Legal:** DRAFT banners on `/router` before broad public push.
- **Cycles:** top up `5ryw3-…` (llama) if inference/upload traps; wallet balance varies after upload.

## Local

P1/P2/M1–M6 mock tests on Pocket IC unchanged.

See `MAINNET-SIZING.md`.
