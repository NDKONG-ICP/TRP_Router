# onicai llama_cpp_canister (TRP Router vendored)

**Source commit:** `5fa3091f24955317f9bc944dba0455b9221d0808`  
**Wasm used locally:** release [v0.22.0](https://github.com/onicai/llama_cpp_canister/releases/download/v0.22.0/llama_cpp.wasm)  
SHA-256: `acb02b81a91b281f6514704b9acb0c4a6cfe0d992ca12381dbc11140e1dbc7ee`

Local `icpp build-wasm` at the pinned commit failed in this environment (C++ `decision.cpp` / toolchain; paths with spaces in `Raven DAPP` break icpp). Full upstream tree: clone at pin + `src/llama_cpp_onicai_fork` per upstream README.

TRP integration:

- Canister name in `trp-router/dfx.json`: `llama_cpp_qwen25`
- Upload: `node scripts/upload-gguf.mjs` (controller identity)
- Load: `README-qwen2.5.md` / BUILD-REPORT.md
- Router: `set_llama_qwen25` + `set_access` level 1
