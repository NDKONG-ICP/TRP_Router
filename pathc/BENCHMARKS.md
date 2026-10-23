# Path C benchmarks

**Important:** On-chain rows are from the **local replica** (`uqqxf-5h777-77774-qaaaa-cai`) — measured values only; no fabricated PNG.

## Run configuration (pinned)

| Parameter | Value |
|-----------|--------|
| Model | `sd_turbo-f16-q4_0.gguf` |
| Model SHA-256 | `9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5` |
| Weights bytes (VFS) | **1 734 945 536** |
| sd.cpp commit | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` |
| **Wasm (2026-10-23)** | `26d1e545fb86d4a67b840d97e27ff460e93d66e8a084629350ac2aad1d50deb2` |
| On-chain target | **64×64**, 1 step, CPU RNG, CFG 1.0, seed **4242** |

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
| **CLIP / embeds `step(1)`** | **≥ 40×10⁹ (reject)** | 1+ (failed) | Blocks before embed stash; resumable CLIP TBD |
| **denoise forward (single)** | **Not measured** | — | Blocked at CLIP; P1 target once UNet reachable |
| **decode + PNG** | — | — | **Not run** |
| **TOTAL / image** | — | — | **Not completed** |

**Generate (P2):** `generate_done` wired; graph eval callback + node resume + embed/sample split implemented. First `step(1)` still exceeds **40B/update** during CLIP (see `BUILD-NOTES.md`).

**Determinism:** **Not run** — no PNG.

**Milestone:** **`tmp/onchain-0.png` does not exist.**

## Mainnet

**STAGED (P5 gated).** Wallet balance not verified in this session (`dfx wallet balance --network ic` failed with ColorOutOfRange — re-run with `TERM=xterm-256color`). Do not deploy until local image + cycle budget confirmed.

## Next engineering

1. Instruction-bounded **CLIP / conditioner** across `step(1)` calls.
2. Measure **single UNet forward** instructions (P1 sizing) once CLIP completes.
3. Local PNG + determinism (P3–P4), then mainnet (P5).
