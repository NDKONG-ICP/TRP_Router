# TRP Router pinned versions

| Component | Pin |
|-----------|-----|
| dfx | 0.29.2 (local smoke; shared Pocket IC on :8000) |
| icp-cli | 1.2.0 (onicai upstream; TRP upload uses dfx + `@dfinity/agent` bridge) |
| icpp-pro | 6.6.0 (local build attempted; upgraded from 5.2.0 for Rust 1.93) |
| wasi-sdk | wasi-sdk-25.0 (via icpp) |
| ic-cdk (Rust canisters) | 0.13 |
| ic-stable-structures | 0.6 |
| onicai `llama_cpp_canister` **source** | commit `5fa3091f24955317f9bc944dba0455b9221d0808` |
| onicai **llama_cpp.wasm** (local deploy) | release **v0.22.0** sha256 `acb02b81a91b281f6514704b9acb0c4a6cfe0d992ca12381dbc11140e1dbc7ee` (prebuilt; local icpp link failed — see BUILD-REPORT.md) |
| llama_cpp_onicai_fork | commit `702142008552e33844f99dddefc409550166d175` (from `version_fork.env` at source pin) |
| GGUF Qwen2.5-0.5B-Instruct q8_0 | sha256 `ca59ca7f13d0e15a8cfa77bd17e65d24f6844b554a7b6c12e07a5f89ff76844e` (675_710_816 bytes) — **loaded locally** |
| GGUF Llama-3.2-1B-Instruct q4_k_m | not loaded (after 0.5B works) |
| Local llama canister id (example) | `lm4fb-uh777-77777-aaacq-cai` (ephemeral; varies per replica) |
| Cloudflare model id | `@cf/black-forest-labs/flux-1-schnell` |
| Gemini image model | `gemini-2.5-flash-image` |
| Pollinations | `model=flux`, 1024×1024, keyless |
