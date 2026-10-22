# Vendor patches (apply after cloning sd.cpp @ a77d362)

Files under `vendor/stable-diffusion.cpp/`:

- `src/model_manager.cpp` — WASI lambda return type `-> size_t`, ternary `size_t{0}`
- `src/model_io/safetensors_io.cpp` — `.string()` instead of `.u8string()` on WASI
- `src/model_loader.cpp` — `#ifdef __wasi__` force `n_threads = 1`

Re-apply after vendor bump or keep a fork branch.
