# Vendor patches (apply after cloning sd.cpp @ a77d362)

Files under `vendor/stable-diffusion.cpp/`:

- `src/model_manager.cpp` — WASI lambda return type `-> size_t`, ternary `size_t{0}`
- `src/model_io/safetensors_io.cpp` — `.string()` instead of `.u8string()` on WASI
- `src/model_loader.cpp` — `#ifdef __wasi__` force `n_threads = 1`

## C4 — instruction-bounded load (applied under `TRP_PATHC_ICP`)

- **`model_loader.cpp`:** after each tensor, check `pathc_icp_budget_exceeded()` → pause with partial return.
- **`model_manager.cpp`:** treat pause as partial success (no storage teardown).
- **`diffusion_engine.cpp`:** `pathc_init_incomplete_` + resume via `validate_and_load_runners()` on next `init()`.
- **`pathc_icp_hooks.*`:** 35B instruction budget per update call.
- **Upload:** dual-write chunks to `ic0` stable + VFS `model.gguf` (buffer-only load: TODO `gguf_init_from_buffer`).

Re-apply after vendor bump or keep a fork branch.
