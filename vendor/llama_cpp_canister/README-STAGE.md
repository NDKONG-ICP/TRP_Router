# onicai llama_cpp_canister — STAGED (M3)

**Pinned commit:** `5fa3091f24955317f9bc944dba0455b9221d0808`  
**Repo:** https://github.com/onicai/llama_cpp_canister

This overnight run **did not** compile/deploy the C++ `icpp-pro` canister (toolchain + build time). Steps for the owner:

1. Clone at the pinned commit into `vendor/llama_cpp_canister/`.
2. Follow upstream README (`run_update_full`, model upload via chunked stable memory or blob_store GGUF).
3. Add canister to `dfx.json` as `llama_onchain`.
4. Wire `router_canister` `trp/onchain-*` models to inter-canister calls (replace 503 stub in `handle_chat`).

Model weights: use `blob_store` with `kind = Model` or onicai's native loader; pin SHA-256 in `VERSIONS.md`.
