# TRP Router pinned versions

| Component | Pin |
|-----------|-----|
| dfx | 0.29.2 (local smoke; `dfx.json` pin updated from 0.15 — 0.15 replica/icx-proxy unstable on this host) |
| ic-cdk (Rust canisters) | 0.13 |
| ic-stable-structures | 0.6 |
| onicai `llama_cpp_canister` | **STAGED** commit `5fa3091f24955317f9bc944dba0455b9221d0808` (2026-10-21) — not built in this run |
| GGUF Qwen2.5-0.5B-Instruct q8_0 | STAGED — download from [onicai HF collection](https://huggingface.co/onicai/llama_cpp_canister_models); record SHA-256 before load |
| GGUF Llama-3.2-1B-Instruct q4_k_m | STAGED — same |
| Cloudflare model id | `@cf/black-forest-labs/flux-1-schnell` |
| Gemini image model | `gemini-2.5-flash-image` |
| Pollinations | `model=flux`, 1024×1024, keyless |
