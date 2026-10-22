# Path C PoC — build notes (honest staging)

**Branch:** `pathc/poc`  
**Updated:** 2026-10-22 (Phase A icpp push)  
**Verdict:** **C2 wasm LINKS (2026-10-22)** — `build/diffusion_canister.wasm` ~36 MB via `scripts/build-icpp.sh`. **No on-chain image yet** (inference + deploy not wired).

## Tonight: Phase A (icpp / WASI)

### What works

| Item | Status |
|------|--------|
| **Space-free build root** | `pathc/scripts/build-icpp.sh` rsyncs to `/tmp/trp-pathc-nospace` (required — icpp breaks on `Raven DAPP` paths) |
| **icpp recipe** | `pathc/icpp.toml` — sd.cpp + ggml CPU + onig + utf8proc + zip |
| **WASI shims** | `pathc/wasi-shims/` copied/adapted from onicai (mutex, thread, future, condition_variable) |
| **Compile progress** | **~50+ translation units** produce `.o` under `build/` (ggml ops, pipeline, model_io, tokenizers, etc.) |
| **Host C3/C5** | SD-Turbo q8_0 + TAESD; `tmp/reference-cpu-0.png`; timings in `BENCHMARKS.md` |
| **Rust scaffold** | `diffusion_canister` deploys locally; returns explicit C2 error until C++ wasm is wired |

### Vendor patches (sd.cpp @ `a77d362…`, document for re-apply)

Applied under `pathc/vendor/stable-diffusion.cpp/`:

1. **`src/model_manager.cpp`** — lambda `available_device_bytes` explicit `-> size_t`; ternary uses `size_t{0}`.
2. **`src/model_io/safetensors_io.cpp`** — WASI: `.string()` instead of `.u8string()` for shard paths.
3. **`src/model_loader.cpp`** — `#ifdef __wasi__`: force `n_threads = 1`.
4. **`wasi-shims/thread`** — `std::thread` runs worker inline (no trap); `sleep_for` + include `once_flag` before `<chrono>`.
5. **`wasi-shims/mutex`** — `unique_lock(m, try_to_lock_t)`.
6. **`icpp.toml` flags** — `-DGGML_MAX_NAME=160`, `-D_WASI_EMULATED_MMAN`, link `-lwasi-emulated-mman`, onig `config.h` from `thirdparty-wasi/oniguruma/`.

### Remaining C2 blocker (exact)

**Single compile error** (blocks link → no `build/diffusion_canister.wasm`):

```text
wasi-sysroot/.../c++/v1/__locale:131:3: error: unknown type name 'once_flag'
```

Triggered when libc++ `<chrono>` / locale headers load **before** our `wasi-shims/__mutex/once_flag.h` is visible (icpp runtime TUs + some sd includes). onicai avoids this by include order in llama sources; sd.cpp pulls `<chrono>` / iostream paths more aggressively.

**Fix direction:** Extend wasi-shims (e.g. lightweight `<locale>` guard or universal preamble that icpp applies to **all** TUs including icpp-pro runtime — may need icpp-local `-include` with absolute path in `build-icpp.sh`), matching onicai upgrade 0003 notes in `llama_cpp_canister/icpp.toml`.

### Superseded blockers

- ~~cmake `find_package(Threads)` on WASI~~ — bypassed by **icpp** (not cmake) for IC target.
- ~~No icpp recipe~~ — **draft recipe exists** (`pathc/icpp.toml`).

### Phase B–E (not started)

- Link wasm → deploy as `custom` canister (replace or merge Rust API).
- Stable-memory GGUF load (mirror onicai `file_upload_chunk` + virtual FS / `gguf_init_from_buffer`).
- `begin` / `step` / `finish` with TAESD, `--rng cpu`, 128×128 or 64×64, chunked update calls.
- `pathc/tmp/onchain-0.png`, full `BENCHMARKS.md` on-chain table, determinism.

## Build commands

```bash
# Host reference (unchanged)
cd pathc && ./scripts/host_reference.sh

# IC WASM (space-free)
pathc/scripts/build-icpp.sh
# artifacts: /tmp/trp-pathc-nospace/build/*.o ; wasm when link succeeds
```

## GO / NO-GO

| Milestone | Verdict |
|-----------|---------|
| **M2 optimize** | **NO-GO** — no linked wasm, no on-chain step timings |
| **M3 shard** | **NO-GO** — nothing to shard |
| **Feasibility** | **YES** — icpp path is real; compile surface mostly clears; one libc++/shim interaction left |

## Local dfx

Replica works after stale `network-id` backup. Rust `diffusion_canister` id (local): see last `dfx deploy` in your session.
