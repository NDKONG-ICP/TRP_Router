# Path C benchmarks

**Important:** On-chain rows are from the **local replica** (`uqqxf-5h777-77774-qaaaa-cai`) — measured values only; no fabricated PNG.

## Run configuration (pinned)

| Parameter | Value |
|-----------|--------|
| Model | `sd_turbo-f16-q4_0.gguf` |
| Model SHA-256 | `9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5` |
| Weights bytes (VFS) | **1 734 945 536** |
| sd.cpp commit | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` |
| **Wasm (2026-10-23)** | `8fefcdb8c20879a7b32d38cf079bfc9b23505211f2575f2d2e6249a5d536d723` |
| On-chain target | **16×16 first** (scale to 64×64 after E2E), 1 step, CPU RNG, CFG 1.0, seed **4242** |

### ICP weight policy

- **2-D matmul weights:** native **q4** in params (`ggml_mul_mat` dequant).
- **1-D / ≤1 048 576 elts:** **F32 at load** (bias, norm, etc.).
- **Conv (≥3-D):** **F16 at load** (P1 precast; no per-forward `ggml_cast` on conv kernels).

## Host reference (sd-cli, Apple M1, Metal)

| stage | wall-clock |
|-------|------------|
| CLIP encode | **0.97 s** |
| denoise (1 step) | **0.40 s** |
| TAESD decode | **0.62 s** |
| **TOTAL** | **~2.0 s** logged |

Host determinism (CPU RNG): SHA-256 `8e6df8abca06799dd5fcbc49f9e03b1e4580b27beda95d7d2ede8dad680589d0` — `tmp/reference-cpu-0.png`.

## On-chain local (2026-10-23)

| stage | instructions | update-calls | notes |
|-------|----------------|--------------|--------|
| **load `step(0)`** | **≈ 1.615×10¹¹** total; max **≈ 8.06×10⁹**/call | **22** | `load_done=true`, **1192/1192** eager params |
| **generate `step(1)` (16×16)** | **≈ 1.89×10¹¹** total | **7** | `generate_done=true`; CLIP→Denoise→Decode handoffs |
| **PNG (16×16, seed 4242)** | — | — | **`tmp/onchain-0.png`**, SHA-256 `aef78be40f35e4b56d70c69de15d262754e9e26422077b1cc01568094c43bc8d` |

**Determinism:** run2 optional (`PATHC_SKIP_RUN2=1` on first E2E).

**Milestone:** **First fully on-chain 16×16 PNG** (2026-10-23, local replica).

## Mainnet

**STAGED (P5 gated).** Wallet balance not verified in this session (`dfx wallet balance --network ic` failed with ColorOutOfRange — re-run with `TERM=xterm-256color`). Do not deploy until local image + cycle budget confirmed.

## Next engineering

1. Instruction-bounded **CLIP / conditioner** across `step(1)` calls.
2. Measure **single UNet forward** instructions (P1 sizing) once CLIP completes.
3. Local PNG + determinism (P3–P4), then mainnet (P5).

### On-chain run 2026-10-23 (16×16)

| phase | instructions (sum) | graph node slices (sum) | timing rows |
|-------|-------------------:|------------------------:|------------:|
| load_model_partial | ≈ 1.61×10¹¹ | — | 21 |
| load_model_done | ≈ 4.6×10⁷ | — | 1 |
| generate_partial_condition | ≈ 7.06×10¹⁰ | **882** | 2 |
| generate_partial_denoise | ≈ 8.65×10¹⁰ | **2105** | 3 |
| generate_partial_decode | ≈ 1.32×10¹⁰ | **1381** | 1 |
| clip+denoise+taesd (final step) | ≈ 2.50×10¹⁰ | **724** | 1 |
| png_encode | ≈ 9.4×10⁶ | 0 | 1 |

- **load** `step(0)` update calls: **22**
- **generate** `step(1)` update calls: **7**
- PNG bytes: **7913**, SHA-256: `aef78be40f35e4b56d70c69de15d262754e9e26422077b1cc01568094c43bc8d`

*(Graph node slices = eval-callback node batches per partial timing row; `update_calls` field in `last_timings`.)*

### On-chain run 2026-10-23 (16×16)

| phase | instructions (sum) | graph node slices (sum) | step(1) or step(0) updates |
|-------|-------------------:|------------------------:|-----------------------------:|
| clip+denoise+taesd | 24981241491 | 1 | 1 |
| generate_partial_condition | 70605596391 | 882 | 2 |
| generate_partial_decode | 13155089998 | 0 | 1 |
| generate_partial_denoise | 80137675487 | 2105 | 3 |
| load_model_done | 45841754 | 1 | 1 |
| load_model_partial | 161355514328 | 21 | 21 |
| png_encode | 9361111 | 1 | 1 |

- **load** `step(0)` update calls: **22**
- **generate** `step(1)` update calls: **7**
- PNG bytes: **7913**, SHA-256: `aef78be40f35e4b56d70c69de15d262754e9e26422077b1cc01568094c43bc8d`

### On-chain run 2026-10-23 (16×16)

| phase | instructions (sum) | graph node slices (sum) | step(1) or step(0) updates |
|-------|-------------------:|------------------------:|-----------------------------:|
| clip+denoise+taesd | 24982553276 | 1 | 1 |
| generate_partial_decode | 13155040927 | 0 | 1 |
| generate_partial_denoise | 73357442510 | 2105 | 3 |
| png_encode | 9358714 | 1 | 1 |

- **load** `step(0)` update calls: **1**
- **generate** `step(1)` update calls: **5**
- PNG bytes: **7913**, SHA-256: `aef78be40f35e4b56d70c69de15d262754e9e26422077b1cc01568094c43bc8d`

### On-chain run 2026-10-23 (16×16)

| phase | instructions (sum) | graph node slices (sum) | step(1) or step(0) updates |
|-------|-------------------:|------------------------:|-----------------------------:|
| clip+denoise+taesd | 24982459200 | 1 | 1 |
| generate_partial_decode | 13154706389 | 0 | 1 |
| generate_partial_denoise | 73358459542 | 2105 | 3 |
| png_encode | 9359119 | 1 | 1 |

- **load** `step(0)` update calls: **1**
- **generate** `step(1)` update calls: **5**
- PNG bytes: **7913**, SHA-256: `aef78be40f35e4b56d70c69de15d262754e9e26422077b1cc01568094c43bc8d`

### Pending wasm (2026-10-23) — CLIP livelock + parity queries

- **WASM SHA-256:** `ca3a06caafbfb7a7103c77ca3e8d805523b96c695169395ddd1c041446f6e843`
- **Fix:** checkpoint ggml resume cursor after every successful eval batch (`pathc_icp_checkpoint_graph_progress`), not only on budget pause — avoids replay at CLIP node ~884 when ~89 nodes/run finish inside 35B without pausing.
- **Sampler default:** plain **Euler** (`euler_ancestral=false`; `debug_flags` bit **8** = Euler A for A/B).
- **Parity:** `parity_status` / `get_parity_blob`; host tool `build-native/bin/pathc-parity` via `./scripts/build-parity-host.sh`. Canister fetch after CLIP: `./scripts/parity_canister_after_clip.sh` (`debug_flags=65536` = bit16 embeds only).
- **Deploy:** `dfx canister install --mode upgrade --wasm build/diffusion_canister.wasm` when no generate loop is running; restart `onchain_generate.mjs` and confirm logs advance past `resume_paused_compute node=884`.
- **Host embeds reference:** native CLIP still aborts on `f32`/`q8_0` CPU binary ops with this GGUF (WASM path differs); `./scripts/parity_harness.sh embeds` blocked until host quant path matches canister or reference is captured on-chain first.
