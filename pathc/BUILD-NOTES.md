# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-23  
**Verdict:** **P1 chunked graph engine landed** (wasm `6b6236b7…`). Local replica was restarted with `dfx start --clean`; **GGUF re-upload in progress** after cycle top-up. **Generate not re-benchmarked yet** on this replica.

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

## Ops (this session)

- **Wasm SHA256:** `6b6236b7b5a83816782629eff1900e6acfcf5382c8316a6df9a8473bb42eb290`
- **Canister (clean local):** `uxrrr-q7777-77774-qaaaq-cai` (see `.env.pathc`)
- **Upload:** use `models/sd_turbo-f16-q4_0.gguf`; deposit cycles before large upload (`dfx canister deposit-cycles … diffusion_canister`)
- **Upload resume:** `upload_model.mjs` resumes when `0 < weights_bytes_loaded < file size`

## Next (P2–P5)

1. Finish upload → 22× `step(0)` load → loop `step(1)` until `generate_done`.
2. Confirm CLIP completes across multiple updates (canister log: `PATHC graph pause` / `resume next_node=`).
3. If image noise: flip EPS ↔ V in denoiser build (ICP SD2 path).
4. Fill `BENCHMARKS.md` with measured calls/instructions; dual-run SHA-256.

## Commands

```bash
TERM=xterm-256color dfx start
bash pathc/scripts/build-icpp.sh
TERM=xterm-256color dfx deploy diffusion_canister --yes
dfx canister deposit-cycles 50_000_000_000_000 diffusion_canister
DFX_IDENTITY=ic_deploy_plain node pathc/scripts/upload_model.mjs models/sd_turbo-f16-q4_0.gguf
DFX_IDENTITY=ic_deploy_plain node pathc/scripts/onchain_generate.mjs
```
