# TRP Router — mainnet sizing dry-run (P3)

**Date:** 2026-10-21 · **Identity checked:** `ic_deploy_plain`

## Wallet balance (observed)

| Source | Balance |
|--------|---------|
| `dfx wallet balance --network ic` | **1.178 TC** (trillion cycles) |
| `dfx cycles balance --network ic` (identity) | **0.022 TC** |

Deploys should draw from the **wallet** (not the bare identity balance).

## Gateway (P4) — blob_store + router_canister

| Item | Estimate |
|------|----------|
| Create + install (2 canisters, Rust wasm) | ~0.08–0.20 TC |
| HTTP outcall buffer (image gen) | ~0.05–0.15 TC per busy day (usage) |
| Recommended initial canister top-up (each) | ~0.10 TC |

**P4 decision: GO (pre-spend)** — well within 1.178 TC wallet.

**P4 observed (2026-10-21):** `blob_store` create+install consumed **~0.90 TC** from wallet (600B initial + 300B top-up for install). Wallet after blob: **0.278 TC** → **router create BLOCKED** (500B minimum create fee). **Owner top-up ≥0.55 TC** before router deploy.

## Onicai beta (P5) — llama_cpp_qwen25 + 675 MiB GGUF

| Item | Estimate |
|------|----------|
| Install ~8.7 MiB wasm + **3.75 GiB** wasm memory limit | ~0.25–0.60 TC install + memory reservation |
| GGUF upload (~338 × 2 MiB update calls) | ~0.15–0.40 TC (ingress + storage) |
| Load model + inference smoke | ~0.05–0.20 TC |
| **Operating buffer** (beta traffic) | ≥ **0.30 TC** recommended in-canister |

**Rough P5 total:** ~0.75–1.50 TC on top of gateway — **overlaps** remaining wallet if gateway already spent.

**P5 decision: CONDITIONAL GO** — wallet **1.178 TC** can likely cover **either** a lean gateway-first launch **or** gateway + onicai if deploys are sequential and uploads are not retried. **NO-GO** if you also need heavy parallel uploads or long beta traffic without a **≥0.5 TC** top-up after P4.

**Agent action:** Proceed with **P4 now**. Attempt **P5 only after P4 ids are recorded** and wallet balance is re-checked; **STOP** if wallet &lt; **0.85 TC** remaining (owner top-up — agent does not buy cycles).

## Instruction / memory notes (from onicai v0.22.0 + local Pocket IC)

- Qwen2.5-0.5B q8_0 ran locally without extra wasm memory bump on Pocket IC; **mainnet** should still set **`wasm_memory_limit = 4_026_531_840`** (3.75 GiB) per onicai README before load.
- Short prompts used **~2** `run_update` calls locally; expect slow, multi-call chat (beta).

## Owner-only

- Top up wallet if post-P4 balance &lt; 0.85 TC before P5.
- Provider keys (optional): Cloudflare + Gemini into router vault.
