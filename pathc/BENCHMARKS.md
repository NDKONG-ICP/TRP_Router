# Path C benchmarks

**Important:** Rows marked **host** are **not** IC replica measurements. On-chain columns are empty until C2 succeeds.

## Run configuration (pinned)

| Parameter | Value |
|-----------|--------|
| Model | `Green-Sky/SD-Turbo-GGUF` → `sd_turbo-f16-q8_0.gguf` |
| Model SHA-256 | `d50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580` |
| VAE decode | TAESD `madebyollin/taesd` → `taesd.safetensors` |
| TAESD SHA-256 | `db169d69145ec4ff064e49d99c95fa05d3eb04ee453de35824a6d0f325513549` |
| sd.cpp commit | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` |
| Resolution | 256×256 |
| Steps | 1 |
| CFG | 1.0 |
| Seed | 4242 |
| Prompt | `a black raven on a branch, silhouette, minimal` |
| Host RNG | `--rng cpu` (required for repeatability on Apple GPU backend) |

## Host reference (sd-cli, Apple M1, Metal ggml)

Wall-clock from sd.cpp logs on **second** run (Metal shaders warm):

| stage | instructions | update-calls | cycles | wall-clock |
|-------|----------------|--------------|--------|------------|
| text-encode (CLIP) | — | — | — | **0.97 s** |
| denoise step (1) | — | — | — | **0.40 s** |
| VAE decode (TAESD) | — | — | — | **0.62 s** |
| **TOTAL / image** | — | — | — | **2.00 s** (logged) / **6.03 s** (`/usr/bin/time` 2nd run) |

First run after Metal library compile: **~22 s** wall (`/usr/bin/time`), dominated by ggml Metal kernel compilation — not representative of steady-state IC.

## Determinism (host)

| Check | Result |
|-------|--------|
| Same seed, `--rng cpu`, two PNGs | **PASS** — SHA-256 `8e6df8abca06799dd5fcbc49f9e03b1e4580b27beda95d7d2ede8dad680589d0` both runs |
| Same seed, default GPU RNG, two PNGs | **FAIL** — different PNG hashes (Metal non-determinism) |
| On-chain (IC WASM) | **Not run** — C2 blocked |

Output artifact: `pathc/tmp/reference-cpu-0.png` (host only, **not** `onchain-0.png`).

## On-chain (local replica)

**2026-10-22:** icpp compile mostly passes; **wasm link blocked** (`once_flag` / libc++ `<locale>` — see `BUILD-NOTES.md`). No on-chain inference timings yet.

| stage | resolution | instructions | update-calls | cycles | wall-clock |
|-------|------------|--------------|--------------|--------|------------|
| CLIP encode | — | — | — | — | — |
| denoise step (1) | — | — | — | — | — |
| TAESD decode | — | — | — | — | — |
| **TOTAL / image** | — | — | — | — | — |

Rust `diffusion_canister`: inference API still C2 stub until C++ wasm is linked and deployed.

Scaffold (local replica, 4-byte chunk, not inference): `upload_weights_chunk` → **1,221 instructions**, 1 update call, 0 ms wall (dfx 0.29.2, 2026-10-22).

## Mainnet (C6)

**Skipped** — C4 not satisfied.

## Projection (explicit guess, not measured)

IC single-thread WASM without GPU: expect **orders of magnitude** slower than 2 s/image host Metal; cycle burn unknown until a single denoise step runs inside a canister update call.
