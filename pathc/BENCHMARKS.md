# Path C benchmarks

**Important:** Rows marked **host** are **not** IC replica measurements. On-chain rows are from **local pocket-ic** (`uxrrr-q7777-77774-qaaaq-cai`), honest staging — no fabricated PNG.

## Run configuration (pinned)

| Parameter | Value |
|-----------|--------|
| Model | `Green-Sky/SD-Turbo-GGUF` → `sd_turbo-f16-q8_0.gguf` |
| Model SHA-256 | `d50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580` |
| VAE decode | TAESD `madebyollin/taesd` → `taesd.safetensors` |
| TAESD SHA-256 | `db169d69145ec4ff064e49d99c95fa05d3eb04ee453de35824a6d0f325513549` |
| sd.cpp commit | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` |
| Host resolution | 256×256 |
| **On-chain target** | **64×64**, 1 step, CPU RNG |
| CFG | 1.0 |
| Seed (on-chain attempts) | 4242 |
| Host RNG | `--rng cpu` |

## Host reference (sd-cli, Apple M1, Metal ggml)

| stage | instructions | update-calls | cycles | wall-clock |
|-------|----------------|--------------|--------|------------|
| text-encode (CLIP) | — | — | — | **0.97 s** |
| denoise step (1) | — | — | — | **0.40 s** |
| VAE decode (TAESD) | — | — | — | **0.62 s** |
| **TOTAL / image** | — | — | — | **2.00 s** (logged) / **6.03 s** (`/usr/bin/time` 2nd run) |

Host determinism (CPU RNG): SHA-256 `8e6df8abca06799dd5fcbc49f9e03b1e4580b27beda95d7d2ede8dad680589d0` — `tmp/reference-cpu-0.png`.

## On-chain (local replica, 2026-10-22)

**Wasm (inference build):** `d2a12a10c2d260ce7bad2563c87763988f45cf22eccd03a57737b578e02f6871`  
**Weights storage:** chunked `upload_*_chunk` → WASI VFS `model.gguf` / `taesd.safetensors` (full **2 023 745 376** + **9 793 292** bytes confirmed via `weights_bytes_loaded` / VFS stat after code upgrade). Not yet `ic0` stable memory.

| stage | resolution | instructions | update-calls | cycles | wall-clock |
|-------|------------|--------------|--------------|--------|------------|
| upload (GGUF chunks) | — | ~low per chunk | **~1 065** | — | ~22 min total |
| **load (`step(0)` / `new_sd_ctx`)** | — | **≥ 40 × 10⁹ (trap)** | 1 | — | **~28–35 s** then IC reject |
| CLIP encode | 64×64 | — | — | — | — |
| denoise step (1) | 64×64 | — | — | — | — |
| TAESD decode | 64×64 | — | — | — | — |
| **TOTAL / image** | 64×64 | — | — | — | **Not run** |

**Load failure (exact):** `Canister exceeded the limit of 40000000000 instructions for single message execution` on `step(0)` after `begin(64×64, seed 4242)`. Settings: `enable_mmap=true`, `eager_load=false`, `disable_prefetch=true`, `n_threads=1`, CPU RNG.

**Interpretation:** Almost all of the 40B budget is spent **reading/parsing/mmapping the 2 GB q8_0 GGUF and building runner state** inside `StableDiffusionGGML::init` → `apply_model_update` → `build_runners` — not 64×64 compute. Denoise/TAESD were never reached.

**Cycles:** icpp exposes `performance_counter(Instructions)` only; per-message **cycles** are not read in-canister. Local reject occurs at the subnet **Production** instruction cap (40B/update).

**Determinism (on-chain):** **Not run** — no successful `generate_image`.

**Milestone PNG:** **`tmp/onchain-0.png` does not exist** (blocked at load).

Scaffold: single-byte `upload_weights_chunk` ≈ **1 221** instructions (earlier smoke).

## Mainnet (C6)

**Skipped.**

## Next engineering step (required for milestone)

Instruction-bounded **resumable tensor load** across many `step(0)` updates (onicai-style), or a smaller pinned GGUF for pipeline proof while keeping SD-Turbo as the production target.
