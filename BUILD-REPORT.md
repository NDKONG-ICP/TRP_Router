# TRP Router — BUILD REPORT

**Branch:** `trp-router/build`  
**Date:** 2026-10-21  
**Identity:** `ic_deploy_plain`

## Launch day summary (P1–P7)

| Step | Status | Notes |
|------|--------|--------|
| **P1** on-chain chat polish | **PASS (local)** | `onchain.rs`: Qwen template, no ingest echo, stop at im_end/endoftext; `tmp/onchain-proof.txt` via router SSE — e.g. `"Hello, how can I help you today?"` (2 update calls). |
| **P2** mock tokenomics | **PASS (local)** | `PAYMENTS_ENABLED=false`; `test-m5-mock.mjs` + `test-m6-mock.mjs` (oracle fail-closed, stake, BYOK, holder). |
| **P3** mainnet sizing | **DONE** | See `MAINNET-SIZING.md`. Post–blob deploy wallet **0.278 TC** → **NO-GO** for onicai P5 without top-up. |
| **P4** gateway mainnet | **PARTIAL** | **blob_store LIVE**; **router_canister STAGED** (wallet below 500B create fee). |
| **P5** onicai mainnet | **STAGED** | Blocked on cycles (P3 NO-GO). |
| **P6** flagship UI | **LIVE** | `/router` on `raven_frontend` (obsidian/gold, DRAFT banners). Playground awaits router canister id. |
| **P7** report | **this file** | Owner actions below. |

## Mainnet canister IDs

| Canister | ID | Status |
|----------|-----|--------|
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` | Running; controllers = Plug / OISY / II / Deployer |
| **router_canister** | — | **Not created** — see cycles |
| **llama_cpp_qwen25** | — | Staged (local only) |

## Live URLs

| Surface | URL |
|---------|-----|
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **OpenAI-compatible API** | **Pending** — `https://<router>.icp0.io/v1` after P4 router deploy |
| **On-chain blobs** | Via router `/blob/<id>` once router is wired to `5y35h-…` |

## Local replica (unchanged)

- **dfx 0.29.2**, shared Pocket IC `127.0.0.1:8000`.
- M1–M4, M3 on-chain chat, M5/M6 mock tests pass after deploy.

## Milestones (local)

| Milestone | Status |
|-----------|--------|
| M1 blob_store | PASS |
| M2 router + images | PASS |
| M3 onicai | PASS |
| M4 moderation | PASS |
| M5 payments | STAGED (`PAYMENTS_ENABLED=false`; mock logic proven) |
| M6 stake/BYOK/holder | STAGED (dev endpoints proven) |

## P4 deploy notes (actual cycles)

- Created `blob_store` with **600B** cycles; install needed **~227B** more → deposited **300B** (total ~399B in-canister after install).
- Wallet fell from **1.178 TC → 0.278 TC**.
- **router_canister** create failed: wallet canister **out of cycles** (needs **≥500B** create fee + install buffer on top of remaining **278B**).

## Owner actions (required)

1. **Top up deploy wallet** by **≥0.55 TC** (target **≥0.85 TC** on wallet before router + optional onicai). Agent will **not** buy/convert cycles.
2. Re-run (owner or agent after top-up):
   ```bash
   cd trp-router && dfx identity use ic_deploy_plain
   dfx deploy router_canister --network ic --yes --with-cycles 900_000_000_000
   dfx canister call router_canister init_router "(principal \"5y35h-dyaaa-aaaao-bbqua-cai\")" --network ic
   bash scripts/set-mainnet-controllers.sh ic
   ```
3. Smoke: `POST https://<router>.icp0.io/v1/images/generations` → Pollinations + `/blob/<id>`.
4. Set `REACT_APP_TRP_ROUTER_CANISTER_ID` in frontend `.env.production`, rebuild, `dfx deploy raven_frontend --network ic --no-asset-upgrade --yes`.
5. **Optional:** Cloudflare + Gemini keys → `set_provider_keys` on router (vault only).
6. **Legal:** DRAFT UI strings on `/router` before public announcement.
7. **P5 (if wallet allows after P4):** onicai + GGUF upload per `README-qwen2.5.md`; label **BETA** everywhere.

## UI home choice

**`/router` route on `raven_frontend`** — same Ascension aesthetic, one deploy pipeline, no second asset canister.

## Honest gaps

- Gateway API not on mainnet until router canister is funded.
- Payments remain off (`PAYMENTS_ENABLED=false`).
- Reproducible onicai wasm from pin `5fa3091` still blocked locally; **v0.22.0** prebuilt in use.

See `VERSIONS.md`, `MAINNET-SIZING.md`.
