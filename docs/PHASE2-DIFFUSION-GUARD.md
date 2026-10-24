# Phase 2 — diffusion drain guard (decision)

## Options

| | **(a) Upgrade `7chv3`** | **(b) Fresh prod diffusion canister** |
|---|-------------------------|----------------------------------------|
| Model on-chain | Already loaded (~1.73 GB GGUF + TAESD) | Re-upload + resume load (~TC + time) |
| Wasm | Install inspect-guard build (`9cdc608c…`) + router in allowlist | Same guard in initial install |
| Controllers | II + `ic_deploy` today; add `gqkko` via II mgmt if needed for headless ops | Set `gqkko` + II at create |
| Risk | Short upgrade window; no data loss if upgrade succeeds | Longest path; highest cycle cost |
| Verification | Anonymous `step(1)` → ingress reject (`IC0406`) | Same |

**Choice: (a) upgrade `7chv3`.** The proven model and deterministic PNG live there; guard + allowlist is a wasm-only change. Cost is one controlled upgrade (II/`ic_deploy`) plus adding `5723t…` (router) to `pathc_inspect.cpp` (done in tree).

## Meter + router

- `trp_meter`: `begin_job(principal, tier)` → reserve / free quota → `settle_job` / `release_job`.
- Router: when `set_trp_meter` is configured, image path uses meter instead of router-only `image_quota`.
- Playground free tier remains **10/day** via meter `init_meter(10, …)` global TC faucet cap.

## Deploy order (mainnet, headless where possible)

1. `dfx deploy trp_meter` → `init_meter(10, 100)` → `set_router(5723t…)`.
2. `dfx deploy router_canister` → `set_trp_meter(<meter id>)`.
3. Upgrade `7chv3` wasm (inspect guard + router allowlist) — **requires II or `ic_deploy` controller**, not `gqkko` alone unless re-added as controller.
4. Verify anonymous direct `step` rejected; router `raven-diffusion` still 200.
