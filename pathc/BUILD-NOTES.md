# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-23  
**Verdict:** **P1 chunked graph + P2 resume continuity** (wasm `f4535ee1…`). **Do not** `dfx start --clean` or re-upload unless `weights_bytes_loaded==0`. Deploy with **`dfx canister install --mode upgrade`**. On-chain generate re-running after resume fix (commit `f8299fa`).

## P1 — `run_graph_chunked` (general engine)

| Piece | Location |
|-------|----------|
| Budget | `kPathcInferInstrBudget = 35×10⁹` in `pathc_icp_hooks.h` |
| Eval slice | `pathc_icp_graph_eval_callback`: one node per batch; pause after node if budget exceeded |
| API | `pathc_icp_run_graph_chunked(backend, graph, state)` wraps `sd_backend_graph_compute_with_eval_callback` |
| Scheduler | `ggml-backend.cpp` sched eval: resume node, `ABORTED` on pause |
| Persistence | `GraphEndGuard` + skip `runner_end` / `ConditionerRunnerEndOnExit` on pause |
| Phases | `PathcGenPhase` in `pathc_icp_gen.*`; `image.cpp` sets Condition → Denoise after embed stash |
| CLIP traps | `conditioner.hpp` returns empty on pause instead of assert |

**Removed:** debug hook that forced `step(1)` return after every successful CLIP (was blocking same-call denoise).

## P2 — resume continuity (IC0502 on 2nd step(1))

| Piece | Behavior |
|-------|----------|
| `pathc_generate_image_step` | If `pathc_icp_peek_suspended_runner()` → **only** `pathc_resume_paused_compute()` (no full pipeline) |
| `GGMLRunner` | On infer pause: keep `graph_active_` + `compute_ctx`; register runner in hooks |
| Condition snapshot | `pathc_icp_gen_save_in_condition` before CLIP; `pathc_generate_image_continue` after graph completes |
| Sched pause | `pathc_root_graph` pointer (stable segment graph, not sched copy) |

## Ops (this session)

- **Wasm SHA256:** `6b6236b7b5a83816782629eff1900e6acfcf5382c8316a6df9a8473bb42eb290`
- **Canister (clean local):** `uxrrr-q7777-77774-qaaaq-cai` (see `.env.pathc`)
- **Upload:** use `models/sd_turbo-f16-q4_0.gguf`; deposit cycles before large upload (`dfx canister deposit-cycles … diffusion_canister`)
- **Upload resume:** `upload_model.mjs` resumes when `0 < weights_bytes_loaded < file size`

## Numerical correctness (2026-10-23)

| Check | Result |
|-------|--------|
| Host `sd-cli` 16×16, q4 GGUF, prompt/seed 4242, Euler **A**, eps | SHA `df89bcd7…` — structured image (~3.4k unique RGB) |
| Canister chunked (same nominal inputs) | SHA `aef78be4…` — flat brown (~726 unique RGB); **byte mismatch** |
| `debug_flags` bit0 **full_graph** (no chunking) | **IC0502** on first `step(1)` (~>40B) — chunking required at 16×16 |
| Stale global resume graph in `GGMLRunner::compute()` | Fixed (clear before new forward); **same** canister SHA → not sole cause |
| EPS ↔ V (`debug_flags` bit1) | Needs `pathc_invalidate_denoiser()` on `begin()` when flag changes (added); re-test after rebuild |

**Suspects (ordered):** (1) chunked sched resume + pending tensor handoff; (2) ICP q4 matmul / F16 conv vs host CPU; (3) wrong prediction (eps vs v) if invalidate fix changes output.

**Tools:** `scripts/compare_host_canister.sh`; `scripts/parity_harness.sh` (staged PATHCPAR1 embeds → UNet → decode); `begin.debug_flags`: bit0=full_graph, bit1=v_pred, bit3(8)=plain Euler, bit16=parity embeds, bit17=parity UNet step0.

## Next (P2–P5)

1. Re-test **v_pred** after denoiser invalidate + compare SHA to host `--prediction v` (`982c2cb3…`).
2. Optional: force F32 matmul at load (A/B) to isolate q4 WASM path.
3. Latent checksum hook before TAESD decode (host vs canister).
4. Dual-run SHA-256 determinism once image matches host.

## Commands

```bash
TERM=xterm-256color dfx start
bash pathc/scripts/build-icpp.sh
TERM=xterm-256color dfx deploy diffusion_canister --yes
dfx canister deposit-cycles 50_000_000_000_000 diffusion_canister
DFX_IDENTITY=ic_deploy_plain node pathc/scripts/upload_model.mjs models/sd_turbo-f16-q4_0.gguf
DFX_IDENTITY=ic_deploy_plain node pathc/scripts/onchain_generate.mjs
```
