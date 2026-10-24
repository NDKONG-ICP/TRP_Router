# Path C PoC — pinned versions

| Component | Pin |
|-----------|--------|
| **Branch** | `pathc/poc` |
| **dfx** | 0.29.2 |
| **icpp-pro** | 6.6.0 |
| **wasi-sdk** | wasi-sdk-25.0 (via `~/.icpp/wasi-sdk`) |
| **stable-diffusion.cpp** | `a77d3623180b2bc1886f3dd04c0aa04156a987ef` |
| **ggml (submodule)** | `dc998771e700d49bbdf9a39cede22bb5b3311767` |
| **Model (on-chain PoC q4)** | `models/sd_turbo-f16-q4_0.gguf` |
| **Model SHA-256 (q4)** | `9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5` (~1.73 GB on VFS) |
| **TAESD SHA-256** | `db169d69145ec4ff064e49d99c95fa05d3eb04ee453de35824a6d0f325513549` |
| **icpp wasm (local, 2026-10-23 P1)** | `6b6236b7b5a83816782629eff1900e6acfcf5382c8316a6df9a8473bb42eb290` |
| **Local canister id** | `uxrrr-q7777-77774-qaaaq-cai` (`.env.pathc`; changes after `dfx deploy`) |
| **Mainnet canister id (2026-10-24)** | `7chv3-5iaaa-aaaao-bbq3a-cai` — **live**; PNG SHA `bec2a6db…` (deterministic on `ic`) |
| **Mainnet wasm (deployed)** | `2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a` |
| **Infer budget / update** | `kPathcInferInstrBudget` = **35×10⁹** (load budget **8×10⁹**) |

Update when wasm or model pin changes.
