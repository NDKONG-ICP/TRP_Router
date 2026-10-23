# Vendor patches (apply after cloning sd.cpp @ a77d362)

Files under `vendor/stable-diffusion.cpp/`:

- `src/model_manager.cpp` — WASI lambda return type `-> size_t`, ternary `size_t{0}`
- `src/model_io/safetensors_io.cpp` — `.string()` instead of `.u8string()` on WASI
- `src/model_loader.cpp` — `#ifdef __wasi__` force `n_threads = 1`

## C4 — instruction-bounded load (applied under `TRP_PATHC_ICP`)

- **`model_loader.cpp`:** large matmul weights native quant byte-copy (chunked, resumable); quant→float dequant at load for 1-D or ≤65536 elements (bias/norm/scales).
- **`ggml_block.hpp`:** `get_type` on ICP: F32 params for 1-D/small quant; else native quant for linear/matmul; conv weights stay quant in memory.
- **`ggml_extend.cpp`:** `ggml_ext_conv_kernel` casts quant→F16 for `ggml_conv_2d*` (CPU rejects quant kernels); `ggml_ext_f32_param` for elementwise add/mul.
- **`diffusion_engine.cpp`:** skip `set_wtype_override` on ICP; skip `is_using_v_parameterization_for_sd2` probe (IC0502 trap); defer `build_denoiser` to its own update.
- **`pathc_icp_*`:** `ic0_debug_print` tracing, `pathc_icp_mark_param_finished` (load progress source of truth), GGML abort hook.
- **`model_manager.cpp`:** do not mark params loaded from loader callback `loaded` set before bytes are read.
- **`model_loader.cpp`:** after each tensor, check `pathc_icp_budget_exceeded()` → pause with partial return.
- **`model_manager.cpp`:** treat pause as partial success (no storage teardown).
- **`diffusion_engine.cpp`:** `pathc_init_incomplete_` + resume via `validate_and_load_runners()` on next `init()`.
- **`pathc_icp_hooks.*`:** `kPathcInferInstrBudget` ≈ 35×10⁹; `pathc_icp_run_graph_chunked()`; eval callback forces **one node per batch** (`ask` → true); `pathc_icp_note_graph_pause()`.
- **`ggml_extend_backend.cpp`:** chunked eval + resume node cursor (direct CPU backend path).
- **`ggml/src/ggml-backend.cpp`:** sched eval loop: resume `j0`, return `GGML_STATUS_ABORTED` on infer pause, clear resume on full success.
- **`ggml_runner.cpp`:** skip `runner_end` on infer pause; sched `ABORTED` → segment pause; keep `compute_ctx` via existing `GraphEndGuard`.
- **`pipeline/generation.h`:** skip `ConditionerRunnerEndOnExit` when pause/resume graph active.
- **`pipeline/image.cpp`:** phase cursor (`PathcGenPhase`); embed stash without forced pause; pause-aware embed failure.
- **`conditioning/conditioner.hpp`:** return empty condition/tensor on pause (no `GGML_ASSERT` trap mid-CLIP).
- **`ggml_runner.cpp`:** `pathc_compute_suspended_` keeps `graph_active_` + `compute_ctx` on pause; `pathc_resume_paused_compute()` / `pathc_abort_suspended_session()`.
- **`pathc_icp_gen` + `pathc_generate_image_step`:** condition snapshot; step(1) resumes graph slices without full `generate_image` restart.
- **`ggml-backend.cpp`:** pause/resume uses `pathc_root_graph` (segment graph), not sched copy.
- **Runner lifecycle (all phases):** `pathc_icp_should_defer_runner_teardown()` gates `runner_end()`, `free_compute_ctx()`, `reset_compute_ctx()`, `GraphEndGuard`/`RunnerEndGuard`, `PathcRunnerEndOnExit` (diffusion sample + control), `ConditionerRunnerEndOnExit` (CLIP). VAE encode/decode `auto_end` paths use `GGMLRunner::runner_end()` → same gate.
- **Upload:** POSIX `open`/`write`/`O_APPEND` chunked VFS writes (`model.gguf`).
- **`gguf_io.cpp`:** on ICP, `read_gguf_file` uses `gguf_init_from_file` only (skip `GGUFReader` ifstream).

Re-apply after vendor bump or keep a fork branch.
