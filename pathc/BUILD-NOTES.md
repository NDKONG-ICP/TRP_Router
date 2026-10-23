# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-23  
**Verdict:** **Load GO** (22× `step(0)`, 1192/1192, `load_done=true`). **Generate IN PROGRESS** — resumable graph + embed/sample split landed; **first `step(1)` still hits 40B/update** during CLIP/text-encode (before embed stash). **No `tmp/onchain-0.png` yet.**

## Done (2026-10-23)

| Item | Status |
|------|--------|
| Resumable load | q4 GGUF native quant + small-tensor F32 dequant; conv weights **F16 at load** (P1) |
| `step(1)` API | `generate_done` in Candid; driver loops `step(1)` until done |
| Graph slicing | `sd_set_backend_eval_callback` + per-node budget (`kPathcInferInstrBudget`); resume node index in `pathc_icp_hooks` |
| Embed/sample split | After CLIP+latents, stash in `pathc_icp_gen` and return partial update before UNet |
| Wasm (latest local) | `2451ab9e1e4850d44fb9a8f94633ed84b0dc1b33b6b5b6709ee651bcb88c163e` (see `VERSIONS.md`) |

## Current blocker (exact)

```
step(1) → generate_image → prepare_image_generation_embeds (CLIP)
Reject: Canister exceeded the limit of 40000000000 instructions for single message execution
```

Observed: canister log shows `PATHC generate_image 64x64 seed=4242` then reject **before** embed stash / denoise. Instruction-bounded graph eval does not yet split CLIP into sub-40B updates (likely single large matmul nodes and/or scheduler path).

**Fix direction:**

1. Resumable **conditioner / CLIP** forward (separate phase + cursor, or chunked text tokens).
2. Confirm eval callback on all runner paths (scheduler hook added in `ggml_runner.cpp`).
3. Optional: measure one CLIP forward instruction count on replica after (1).

## Mainnet (P5)

**Gated.** Run `dfx wallet balance --network ic` before deploy. Do not fabricate mainnet cycles. Report exact top-up if wallet cannot cover ~3.75 GB wasm memory + ~1.7 GB model upload + generation.

## Ops

- **dfx:** `TERM=xterm-256color` for install/deploy.
- **Local cycles:** fabricate on `diffusion_canister` only.
- **Redeploy:** wasm upgrade clears inference state; **VFS weights retained** — re-run 22-step load after upgrade.

## Commands

```bash
TERM=xterm-256color script -q /dev/null bash -c 'cd pathc && dfx start'
bash pathc/scripts/build-icpp.sh
TERM=xterm-256color dfx canister install diffusion_canister --mode upgrade --wasm build/diffusion_canister.wasm --yes
DFX_IDENTITY=ic_deploy_plain node pathc/scripts/onchain_generate.mjs
```
