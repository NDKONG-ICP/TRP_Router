# Router enablement (owner)

What `/v1/models` advertises matches what works over HTTP on **this** deployment. Disabled routes return **501** with `"code":"model_not_enabled"` (no vault env strings).

## Currently typical on mainnet (no relay)

| Capability | Models | Requirement |
|------------|--------|-------------|
| On-chain chat | `trp/onchain-qwen-0.5b`, `trp/onchain-raven-chat` | `set_llama_qwen25` + `node scripts/wire-raven-diffusion.mjs` (wires llama + diffusion + blob + pay) |
| On-chain image (sync IC update) | `playground_image_generate` on router | Playground API key or `ii:` auth |
| On-chain image (async HTTP) | `raven-diffusion` | `POST /v1/images/generations` → **202** + poll `GET /v1/images/result/{id}` |
| On-chain compositor | `trp/onchain-raven-art` | Always on |
| Off-chain chat | `trp/cf/*`, `trp/groq/*`, `trp/or/*`, `trp/gemini-*` | Relay (below) |
| Claude | `trp/claude-*` | Relay + platform Anthropic vault or per-user BYOK |
| Off-chain image | `trp/flux`, `trp/image-*` | `init_router(blob_store)` + provider keys optional (Pollinations fallback) |

## Off-chain relay (Cloudflare Worker)

See [`relay/DEPLOY.md`](../relay/DEPLOY.md).

1. Deploy Worker + secrets (`RELAY_SHARED_SECRET`, provider API keys).
2. In `trp-router/.env` (gitignored):

   ```
   RELAY_URL=https://…/infer
   RELAY_SHARED_SECRET=…
   ```

3. `node scripts/set-vault-from-env.mjs`
4. Smoke: `curl -X POST …/v1/chat/completions` with a listed `trp/groq/…` model.

## After any `router_canister` upgrade

```bash
export DFX_WARNING=-mainnet_plaintext_identity
cd trp-router
dfx deploy router_canister --network ic --identity ic_deploy_plain --yes
node scripts/wire-raven-diffusion.mjs
```

Verify: `GET …/v1/models`, on-chain chat, async image job flow.

## Async raven-diffusion (HTTP integrators)

```bash
# 1) Create job (default async; use "async": false only for sync attempt — may hit ~60s gateway)
curl -sS -X POST "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/images/generations" \
  -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"model":"raven-diffusion","prompt":"a raven silhouette","seed":4242}'

# 2) Poll until status is done (same Authorization headers)
curl -sS "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io/v1/images/result/JOB_ID" \
  -H "Authorization: Bearer YOUR_KEY"
```

IC-native (no HTTP timeout): call `playground_image_generate` on the router canister via `agent-js` / `dfx canister call` (Playground uses this path).
