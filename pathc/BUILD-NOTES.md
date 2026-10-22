# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-22 (C2 link + deploy)  
**Verdict:** **C2 wasm LINKS** — `build/diffusion_canister.wasm` ~36 MB. **Local icpp canister deployed** (`dfx deploy` from `pathc/`). **On-chain image:** pending GGUF upload + first `generate_image` run.

## Phase A / C2 (icpp / WASI)

### What works

| Item | Status |
|------|--------|
| **once_flag / libc++** | Universal `-include wasi-shims/icp_preamble.h` via `scripts/gen-icpp-config.py` on `cpp_compile_flags` + `cpp_compile_flags_defaults` (icpp runtime TUs). Clean rebuild clears `build-library/`. |
| **Space-free build root** | `pathc/scripts/build-icpp.sh` → `/tmp/trp-pathc-nospace` |
| **icpp recipe** | `pathc/icpp.toml` — sd.cpp + ggml CPU + onig + utf8proc + zip |
| **WASI shims** | `pathc/wasi-shims/` (mutex, thread, future, condition_variable, `icp_preamble.h`) |
| **Candid exports** | `src-icpp/diffusion_canister.h` — `WASM_SYMBOL_EXPORTED("canister_query …")` / `canister_update …` |
| **Host C3** | SD-Turbo q8_0 + TAESD; `tmp/reference-cpu-0.png`; timings in `BENCHMARKS.md` |
| **Deploy** | `pathc/dfx.json` custom canister → `build/diffusion_canister.wasm` |

### Vendor patches (sd.cpp @ `a77d362…`)

See `patches/vendor-icp.md` (not committed: full `vendor/stable-diffusion.cpp/` tree).

### Upload

- **Do not** use `dfx canister call` with megabyte `vec { … }` (argv limit). Use `node pathc/scripts/upload_model.mjs` (`@dfinity/agent`, 1.9 MB chunks, host `dfx info webserver-port` → 4943).

### Phase B–E (in progress)

- Chunked GGUF → VFS `model.gguf` / `taesd.safetensors` (`upload_*_chunk`).
- `begin` / `step` / `finish` → `generate_image` (CPU RNG, 128×128 default).
- `pathc/tmp/onchain-0.png`, `BENCHMARKS.md` on-chain table, determinism.

## Build commands

```bash
pathc/scripts/build-icpp.sh
cd pathc && dfx deploy diffusion_canister --network local -y
node ../pathc/scripts/upload_model.mjs   # from trp-router (node_modules)
node ../pathc/scripts/onchain_generate.mjs
```

## GO / NO-GO

| Milestone | Verdict |
|-----------|---------|
| **C2 link** | **GO** — wasm links, deploys, `status` query OK |
| **M2 on-chain image** | **PENDING** — upload + inference |
| **M3 shard** | **NO-GO** — out of scope for PoC |
