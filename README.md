# TRP Router

**An OpenAI-compatible AI gateway that runs on the Internet Computer — and home of Raven Diffusion, the first Stable Diffusion that runs *entirely* on-chain.**

One endpoint, two planes of AI:

- **Off-chain plane** — frontier models (OpenAI, Flux, Gemini, …) with health-checked automatic failover.
- **On-chain plane** — models that execute *inside* IC canisters: **Raven Diffusion** (images) and on-chain LLM inference. Deterministic, verifiable by module hash, impossible to deplatform.

🎨 **Live Playground:** https://6pjrv-saaaa-aaaao-bbq4q-cai.icp0.io/
📖 **Docs:** https://6pjrv-saaaa-aaaao-bbq4q-cai.icp0.io/docs.html

Built by [The Raven Project](https://6pjrv-saaaa-aaaao-bbq4q-cai.icp0.io/), on the ggml-on-IC foundation [@onicai](https://x.com/onicai) pioneered for on-chain LLMs.

---

## Why this is notable

Raven Diffusion is, to our knowledge, the first image-generation diffusion model that runs **fully inside a smart contract**. No off-chain GPU, no external API, no trusted server — the Internet Computer's own replicas compute every pixel.

- **Deterministic.** Same `(prompt, seed)` → byte-identical PNG, every time.
- **Verifiable.** Anyone can reproduce an output and check the exact binary the canister runs by its module hash.
- **Reverse-gas.** The canisters pay their own cycles; users need no wallet and pay no gas to try it.
- **Collectible.** Each generation can mint as a transferable **ICRC-7 / ICRC-37** NFT with on-chain provenance.

---

## Quickstart — use Raven Diffusion

It speaks the OpenAI Images API. **POST must use the `raw.icp0.io` host** (CORS/headers).

```bash
curl -X POST https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "x-oc-api-key: <PLAYGROUND_API_KEY>" \
  -d '{"model":"raven-diffusion","prompt":"a raven over a neon city","seed":4242}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1",
                api_key="<PLAYGROUND_API_KEY>")
img = client.images.generate(model="raven-diffusion",
                             prompt="a raven over a neon city")  # seed is first-class
```

**Response** (OpenAI shape + trust fields):

```json
{ "created": 1730000000,
  "data": [{ "b64_json": "<png>", "canister": "7chv3-5iaaa-aaaao-bbq3a-cai",
             "sha256": "bec2a6db…", "deterministic": true }],
  "model": "raven-diffusion" }
```

**Auth:** `x-oc-api-key: <key>` (shared Playground key, 2 free images/day per principal) **or** `x-oc-api-key: ii:<principal>` for an Internet-Identity session (free tier per II principal, then paid credits).

**Verify any output yourself:**

```bash
dfx canister info 7chv3-5iaaa-aaaao-bbq3a-cai --network ic
# expect module hash 0xd89a560af45e5a39b5e2ef1572152215b0c78c7690e3af997cb2ff780694c513
```

Same prompt + seed always yields the same `sha256`. Regenerate to prove it.

---

## How we did it (the fully-on-chain diffusion pipeline)

Diffusion models are large and compute-heavy, and the IC caps a single update call at ~40B instructions — far less than a full generation needs. The pipeline:

1. **Model on-chain.** A ~1.73 GB SD-Turbo model (`q4_0` GGUF) + TAESD are streamed into the canister's **stable memory** (chunked ingress upload), where they persist across upgrades.
2. **Pipeline in-canister.** `stable-diffusion.cpp` (leejet) + `ggml` are compiled to WebAssembly via **icpp-pro**; the full **CLIP → UNet → VAE** pipeline runs inside the canister.
3. **Resumable chunked execution.** The core trick: a `ggml` compute graph is **paused mid-execution** when it reaches an instruction budget (~35B/slice) and **resumed across many `step()` update calls**, driven by a phase state machine (`Condition → Denoise → Decode → Done`). Latent and graph-cursor state is stashed between calls so the whole generation completes under consensus without ever exceeding the per-message limit.
4. **Determinism.** CPU RNG → same `(prompt, seed)` produces a byte-identical PNG, independently reproducible and auditable.

This generalizes the ggml-on-IC approach [@onicai](https://x.com/onicai) pioneered for on-chain LLMs (`llama_cpp_canister`) to the much harder diffusion case. The resumable-execution engine lives in `pathc/src-icpp/` (`pathc_icp_gen.cpp`, `pathc_icp_hooks.cpp`, `pathc_infer.cpp`).

> Current output is **64×64, single-step** (beta) — the breakthrough is that it runs fully on-chain and verifiable, not the resolution. Higher resolution and multi-step detail are on the roadmap.

---

## Payments & credits ($TRP coming)

Pure **Internet Identity + ICRC-2** — no third-party wallet. The `trp_pay` canister:

1. User signs an `icrc2_approve` on the ICP ledger (approving `trp_pay`) with their II.
2. `buy_credits(pack)` pulls the ICP via `icrc2_transfer_from` and grants credits.
3. The payment is **split**: a configurable slice → cycles via the **CMC** onto the diffusion canister (the "burn" that powers generation), the remainder → the treasury.
4. The router consumes a credit per generation after the free tier.

Pack tiers (ICP → credits): 1→1, 5→10, 10→22, 25→55, 100→210. `$TRP` utility + governance launches via LGE SONS on the OHSHII Launcher (utility-only; not an offer or price claim).

---

## Canisters (mainnet)

| Component | Canister ID |
|---|---|
| Router (gateway) | `5723t-oaaaa-aaaao-bbquq-cai` |
| Raven Diffusion | `7chv3-5iaaa-aaaao-bbq3a-cai` (module `d89a560…`) |
| Playground (UI) | `6pjrv-saaaa-aaaao-bbq4q-cai` |
| NFT collection (ICRC-7/37) | `62oay-tiaaa-aaaao-bbq7a-cai` |
| Payments (`trp_pay`) | `ujwwi-hiaaa-aaaao-bbrha-cai` |
| Meter (`trp_meter`) | `6gk2j-eiaaa-aaaao-bbq5a-cai` |
| On-chain LLM (Qwen) | `5ryw3-vqaaa-aaaao-bbqvq-cai` |

---

## Repository layout

```
trp-router/
  router_canister/   # OpenAI-compatible gateway (Rust): routing, quota, paid credits, playground auth
  trp_pay/           # ICP (ICRC-2) -> generation credits; CMC burn + treasury split (Rust)
  trp_meter/         # metering / credit accounting (Rust)
  raven_nft/         # ICRC-7 + ICRC-37 NFT collection for generations (Rust)
  blob_store/        # content-addressed image/asset store (Rust)
  pathc/             # Raven Diffusion: the on-chain Stable Diffusion canister (C++/icpp)
    src-icpp/        #   resumable chunked execution engine + pipeline hooks
    scripts/         #   upload/load/generate + benchmarks
  ui-mockup/         # Playground front-end (static: index.html + modules)
  scripts/           # deploy + wire scripts (wire-raven-diffusion.mjs, deploy-*.sh)
```

`mock_trp_ledger/` is a local-only ICRC-1/2 ledger for tests — **not for mainnet.**

---

## Build & deploy

Requires [dfx](https://internetcomputer.org/docs/building-apps/getting-started/install), Rust (`wasm32-unknown-unknown`), Node, and (for the diffusion canister) [icpp-pro](https://docs.icpp.world/).

```bash
# Rust canisters
dfx deploy router_canister --network ic
dfx deploy trp_pay --network ic
dfx deploy raven_nft --network ic

# Front-end (builds dist/ from ui-mockup, then deploys the assets canister)
CONFIRM_MAINNET=1 bash scripts/deploy-playground-only.sh
```

**After every `router_canister` upgrade, re-run** `node scripts/wire-raven-diffusion.mjs` — it re-sets the diffusion/llama principals, the Playground API key, and **`set_trp_pay`** (paid credits break until re-wired).

The diffusion canister (`pathc/`) deploy, model upload, and resumable load are documented in `pathc/` (`BENCHMARKS.md`, `VERSIONS.md`) and `scripts/`.

---

## Developer notes / gotchas

- **Front-end `@dfinity/*`:** load from **esm.sh**, not jsdelivr `+esm` (jsdelivr ships a broken `borc`/CBOR). Pin to `@2.4.1`. For `auth-client` add `?alias=@dfinity/candid:@dfinity/candid@2.4.1`. Use `HttpAgent.create({ host: "https://icp-api.io" })` and **never** `fetchRootKey()` on mainnet. Pass IDL factories as `({ IDL }) => IDL.Service(...)` **un-called** to `createActor`.
- **Router `POST`** must target `https://<router>.raw.icp0.io/v1` (CORS/headers).
- **`config.js`** (Playground API key) is generated locally by the wire script and is **not** committed — see `ui-mockup/config.example.js` for the shape.
- The router uses one shared stable `MemoryManager` (`router_canister/src/mem.rs`) with a MemoryId registry — never add a second manager or reuse an id.
- Mainnet ICP/CMC moves: do **not** run custom CMC/TPUP automation without explicit review — prefer NNS / `dfx ledger top-up`.

---

## Credits

Raven Diffusion is The Raven Project's own engineering, built on the ggml-on-IC foundation **[@onicai](https://x.com/onicai)** pioneered for on-chain LLMs (`llama_cpp_canister`), generalized to the diffusion pipeline. Uses `stable-diffusion.cpp` (leejet), `ggml`, and `icpp-pro`.

*On-chain outputs are deterministic and independently verifiable. `$TRP` information describes product utility and governance only — not financial advice or an offer.*
