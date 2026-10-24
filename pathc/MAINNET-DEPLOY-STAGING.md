# Path C — Mainnet Deploy (STAGED, not executed)

Status: **partial mainnet deploy (2026-10-24).** Canister `7chv3-5iaaa-aaaao-bbq3a-cai` created + wasm installed; GGUF upload **75.8%** then **IC0207 out of cycles** (wallet ~0.13 TC left). No load/generate/PNG on mainnet yet.
Everything below is prepared; nothing runs on `--network ic` until the prerequisites are met
AND you explicitly confirm (the script requires `CONFIRM_MAINNET=1`).

## What's proven (local) and ready to ship
- Fully on-chain diffusion, **deterministic** (two runs → byte-identical `bec2a6db…`), clean finish.
- WASM to deploy: `2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a` (38 MB).
- Model: `models/sd_turbo-f16-q4_0.gguf` (1,734,945,536 B, SHA `9ff4ce30…`) + TAESD (`db169d69…`).
- Measured per-image generate ≈ **189 B instructions / 7 update calls**; load ≈ 161 B / 22 calls.

## BLOCKER 1 — secure identity (must fix first)
`dfx` refuses `ic_deploy_plain` on mainnet: *"identity is not stored securely. Do not use it to
control a lot of cycles/ICP."* Options (your call, I won't touch key custody):
- Create an encrypted identity: `dfx identity new <name>` (set a password), or
- Use a hardware/seed-backed identity, or import one you control securely.
Then set it active for deploy and attach/create a **cycles wallet** under it.

## BLOCKER 2 — cycles (can't verify balance until identity is fixed)
Last known wallet ≈ 1.6 TC — **likely short.** Rough mainnet cost:
| Item | Est. cost |
|---|---|
| Canister create | ~0.1 TC |
| Model upload (~1.73 GB, chunked ingress) | ~0.3–0.6 TC |
| First resumable load (161 B instr) | ~0.16 TC |
| First generate (189 B instr) | ~0.19 TC |
| Storage runway (~2 GB held, ~1 month, incl. freezing threshold) | ~1–2 TC |
| **Comfortable total to deploy + prove + keep alive** | **~5–10 TC** |
So: **top up to ~10 TC** before deploying (exact number depends on how long it must stay live).
Convert ICP→cycles via the NNS/CMC under the secure identity.

## Controllers (confirm the real principals before running)
Deployer `gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae` (current, = ic_deploy_plain
principal). The spec also lists Plug / OISY / II controllers — **fill their real principals** in the
script's CONTROLLERS before running (don't deploy with a single plaintext controller).

## The staged flow (what `scripts/deploy-mainnet.sh` does — gated, nothing auto-runs)
1. Refuse unless `CONFIRM_MAINNET=1` and the active identity is NOT `ic_deploy_plain`.
2. `dfx wallet balance --network ic` → refuse if below a floor you set.
3. Create `diffusion_canister` on `ic` with the controllers.
4. `dfx canister update-settings --network ic --wasm-memory-limit 4026531840` (3.75 GB) BEFORE load.
5. `dfx canister install --network ic --mode install --wasm build/diffusion_canister.wasm` (hash-verify
   it equals `2cb66399…`).
6. Upload the pinned q4 model + TAESD (chunked) — reuse the project's upload path with `--network ic`.
7. Run the resumable load loop until `load_done`.
8. Run `onchain_generate` once → first MAINNET image; record REAL cycles burned.
9. Record the mainnet canister id + image SHA + real cycle costs in BENCHMARKS.md / VERSIONS.md.

## Honesty gates (unchanged)
- Never fabricate mainnet cycles. If the wallet is short at step 2, STOP and report the exact top-up.
- Do not expose via the public router yet (metering/gate layer comes first — see
  docs/TRP-Router-Metering-Gate-Spec.md).
- One-way-ish: a mainnet canister burns real cycles continuously. Deploy deliberately.
