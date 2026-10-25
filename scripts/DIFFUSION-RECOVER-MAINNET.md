# Recover Raven Diffusion on mainnet (`7chv3-5iaaa-aaaao-bbq3a-cai`)

## Symptom

Generate returns **502** with:

`Canister trapped: unreachable` / **IC0502** on `step(1)`.

This is **corrupted in-canister state** (often after an out-of-cycles run). `begin()` alone does not fix it.

## Fix (controller required)

Controllers: your **Internet Identity** (`ucw6l-…`) and secure deploy identity (`xx6vh-…`).

### Option A — NNS (recommended)

1. Open [NNS](https://nns.ic0.app/) signed in with the II that controls the canister.
2. **My Canisters** → `7chv3-5iaaa-aaaao-bbq3a-cai`.
3. **Stop canister** → wait until stopped.
4. **Start canister**.
5. **Add cycles** (suggest ≥ 2T cycles for headroom).
6. Smoke test: `node scripts/test-raven-diffusion.mjs` from `trp-router/`.

### Option B — dfx (if your dfx identity is a controller)

```bash
export DFX_WARNING=-mainnet_plaintext_identity
dfx canister stop 7chv3-5iaaa-aaaao-bbq3a-cai --network ic
dfx canister start 7chv3-5iaaa-aaaao-bbq3a-cai --network ic
dfx canister deposit-cycles 2_000_000_000_000 7chv3-5iaaa-aaaao-bbq3a-cai --network ic
```

## Note

`ic_deploy_plain` is **not** a controller on `7chv3`; it cannot stop/start this canister.
