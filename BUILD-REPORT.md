# TRP Router — BUILD REPORT

**Branch:** `trp-router/build`  
**Updated:** 2026-10-21 (post top-up + transform + P5 partial)  
**Identity:** `ic_deploy_plain` · **Cycles wallet:** `daf6l-jyaaa-aaaao-a4nba-cai`

## Mainnet canister IDs

| Canister | ID | Status |
|----------|-----|--------|
| **blob_store** | `5y35h-dyaaa-aaaao-bbqua-cai` | Live |
| **router_canister** | `5723t-oaaaa-aaaao-bbquq-cai` | Live — image + status |
| **http_transform** | `5wzqp-yiaaa-aaaao-bbqva-cai` | Deployed (unused; transform lives on router) |
| **llama_cpp_qwen25** | `5ryw3-vqaaa-aaaao-bbqvq-cai` | Wasm installed; **GGUF upload ~6% then cycles** |

## Live URLs

| Surface | URL |
|---------|-----|
| **UI (DRAFT)** | https://cnl2f-gqaaa-aaaao-a4ngq-cai.icp0.io/router |
| **API** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1 |
| **Status** | https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/status |
| **Image gen** | `POST …/v1/images/generations` via agent/`http_request_update` — **PASS** (Pollinations + on-chain `/blob/…`) |

## Fixes shipped (this session)

1. **HTTP outcall consensus:** in-canister `transform` query (strip headers) + **deterministic Pollinations seed** from prompt hash.
2. **Mainnet image smoke:** `node scripts/test-mainnet-image.mjs` → **200** + `/blob/<sha256>`.
3. **P5 started:** `llama_cpp_qwen25` on IC with `wasm_memory_limit` 3.75 GiB; upload interrupted — llama needs **≥0.4 TC** in-canister + wallet top-up to finish.

## Owner actions (finish P5)

1. **Top up** `daf6l-jyaaa-aaaao-a4nba-cai` by **≥0.5 TC** (wallet was empty again after llama create/upload).
2. ```bash
   cd trp-router && dfx identity use ic_deploy_plain
   dfx canister deposit-cycles 500_000_000_000 5ryw3-vqaaa-aaaao-bbqvq-cai --network ic
   DFX_NETWORK=ic node scripts/upload-gguf.mjs
   bash scripts/setup-llama-mainnet.sh
   node scripts/test-mainnet-chat.mjs
   ```
3. **Provider keys (optional):** copy `CLOUDFLARE_*` / `GEMINI_API_KEY` into `trp-router/.env` (gitignored), run `node scripts/wire-mainnet-router.mjs`.
4. **Legal:** DRAFT copy on `/router` before public launch.

## Local (unchanged)

P1/P2 pass; M3 on Pocket IC.

See `VERSIONS.md`, `MAINNET-SIZING.md`.
