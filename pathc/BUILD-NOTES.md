# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-22 (C3 upload done, C4 load blocked)  
**Verdict:** **C2 GO** (wasm links + deploy). **C4 NO-GO** — `step(0)` `new_sd_ctx` on 2 GB q8_0 exceeds **40B instructions/update** on local replica. **No `onchain-0.png`.**

## Done

| Item | Status |
|------|--------|
| icpp wasm | Links ~36 MB; universal `icp_preamble.h`; Candid exports |
| Local canister | `uxrrr-q7777-77774-qaaaq-cai` |
| Full weights on canister | **2 023 745 376** B GGUF + TAESD via `node pathc/scripts/upload_model.mjs` (resume + cycle fabricate) |
| VFS survives **code upgrade** | Verified: after `dfx deploy` upgrade, `weights_bytes_loaded` = 2 023 745 376 without re-upload |
| Step split | `step(0)` load, `step(1)` generate; scripts default **64×64** |
| Commits | Phase A, C2, step-split (`86eaeac`) |

## Storage (honest)

- Uploads land on **WASI VFS** files (`model.gguf`, `taesd.safetensors`), not yet **`ic0` stable memory** / `gguf_init_from_buffer` from stable.
- **`pathc_refresh_vfs_sizes()`** syncs byte counters from VFS after upgrade.

## Blocker (exact)

```
step(0) → new_sd_ctx → StableDiffusionGGML::init → apply_model_update → build_runners
Reject: Canister exceeded the limit of 40000000000 instructions for single message execution
```

Tried: `enable_mmap=true`, `eager_load=false`, `disable_prefetch=true`. Still traps before context is ready.

**Fix direction:** Vendor patch (see `patches/vendor-icp.md`) — resumable `ModelManager` tensor load with instruction budget per update; persist loader cursor in canister stable memory between `step(0)` calls.

## Ops

- **dfx in Cursor:** `TERM=dumb` panics dfx → use `pathc/scripts/dfx.sh` or `TERM=xterm-256color script -q /dev/null bash -c '… dfx …'`.
- **Cycles:** `dfx ledger fabricate-cycles --t … --canister diffusion_canister` (local only).
- **Minimize redeploys:** prefer wasm upgrade only; VFS weights retained in current PoC.

## Commands

```bash
# Replica (keep running)
TERM=xterm-256color script -q /dev/null bash -c 'cd pathc && dfx start'

# Upload (resume-aware)
node pathc/scripts/upload_model.mjs

# Inference (blocked at load today)
PATHC_WIDTH=64 PATHC_HEIGHT=64 node pathc/scripts/onchain_generate.mjs
```
