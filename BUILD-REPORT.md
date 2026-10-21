# TRP Router — BUILD REPORT

**Branch:** `trp-router/build`  
**Date:** 2026-10-21 (updated after wallet top-up)  
**Identity:** `ic_deploy_plain` · **Cycles wallet:** `daf6l-jyaaa-aaaao-a4nba-cai`

## Launch day summary (P1–P7)

| Step | Status | Notes |
|------|--------|--------|
| **P1** on-chain chat polish | **PASS (local)** | Router SSE proof clean (no HelloHello / im_end leak). |
| **P2** mock tokenomics | **PASS (local)** | M5/M6 mock scripts. |
| **P3** mainnet sizing | **DONE** | `MAINNET-SIZING.md` |
| **P4** gateway mainnet | **LIVE (beta gap)** | **blob_store + router_canister** on IC; `/v1/status` OK on **raw** domain; **image POST** hits HTTP outcall **consensus** without transform (503) — fix next. |
| **P5** onicai mainnet | **STAGED** | Wallet ~**5.9 TC** after top-up — feasible when prioritized; not run in this step. |
| **P6** flagship UI | **LIVE** | `/router` wired to `5723t-…`; uses `.raw.icp0.io` for API (certification beta). |
| **P7** report | **this file** | |

## Mainnet canister IDs

| Canister | ID | Status |
|----------|-----|--------|
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` | Running |
| **router_canister** | `5723t-oaaaa-aaaao-bbquq-cai` | Running; wired to blob_store |
| **llama_cpp_qwen25** | — | Staged (local only) |

## Live URLs

| Surface | URL |
|---------|-----|
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **API base (beta)** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |
| **Status (GET)** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/status |
| **Certified icp0.io** | Query cert not wired yet — use **raw** or agent `http_request_update` |

## Mainnet smoke (2026-10-21)

- `init_router(5y35h-…)` ✅
- Controllers: Plug / OISY / II / Deployer ✅
- `GET /v1/status` on raw ✅ (providers healthy, `payments_enabled=false`, `onchain_models_ready=false`)
- `POST /v1/images/generations` via agent ❌ **503** — `No consensus could be reached` on Pollinations/HTTP outcall (`transform: None`). Local replica OK; mainnet needs **HTTP transform** (or deterministic provider path + keys).

Script: `node scripts/test-mainnet-image.mjs`

## Owner actions (remaining)

1. **Optional:** Cloudflare + Gemini keys → `set_provider_keys` on router (may improve provider path).
2. **Engineering:** Add IC HTTP **transform** for image outcalls (P4 follow-up).
3. **Legal:** DRAFT copy on `/router` before broad public push.
4. **P5:** Deploy `llama_cpp_qwen25` + GGUF when ready (cycles available).

## Honest gaps

- Mainnet image gen blocked on outcall consensus until transform.
- Browser `fetch` POST to public HTTP may not hit `http_request_update` — playground may need agent path or fix.
- Payments off (`PAYMENTS_ENABLED=false`).

See `VERSIONS.md`, `MAINNET-SIZING.md`.
