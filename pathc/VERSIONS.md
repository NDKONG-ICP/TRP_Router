# Path C PoC — pinned versions

| Component | Pin |
|-----------|-----|
| **Branch** | `pathc/poc` |
| **dfx** | 0.29.2 |
| **icpp-pro** | 6.6.0 |
| **wasi-sdk** | wasi-sdk-25.0 (via `~/.icpp/wasi-sdk`) |
| **stable-diffusion.cpp** | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` (vendor clone 2026-10-22) |
| **ggml (submodule)** | `dc998771e700d49bbdf9a39cede22bb5b3311767` |
| **Model (C3)** | [Green-Sky/SD-Turbo-GGUF](https://huggingface.co/Green-Sky/SD-Turbo-GGUF) `sd_turbo-f16-q8_0.gguf` |
| **Model SHA-256** | `d50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580` |
| **TAESD** | [madebyollin/taesd](https://huggingface.co/madebyollin/taesd) `diffusion_pytorch_model.safetensors` → `models/taesd.safetensors` |
| **TAESD SHA-256** | `db169d69145ec4ff064e49d99c95fa05d3eb04ee453de35824a6d0f325513549` |
| **Reference** | `trp-router/vendor/llama_cpp_canister` + upstream clone `onicai/llama_cpp_canister` @ main (icpp.toml template) |
| **Path C icpp** | `pathc/icpp.toml`, `pathc/wasi-shims/`, `pathc/scripts/build-icpp.sh` |
| **icpp wasm (local build)** | `d2a12a10c2d260ce7bad2563c87763988f45cf22eccd03a57737b578e02f6871` (~36 MB, mmap + VFS size sync + step split) |
| **Local canister id** | `uxrrr-q7777-77774-qaaaq-cai` |
| **Onig config (WASI)** | copied from native build → `pathc/thirdparty-wasi/oniguruma/config.h` |

Update when icpp link succeeds or the model pin changes.
