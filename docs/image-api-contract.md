# TRP Router — Image Generation API (contract)

OpenAI-compatible. The frontend and router MUST both conform to this; change it here first,
then both sides. Model: **`raven-diffusion`** → fully on-chain diffusion (canister `7chv3-5iaaa-aaaao-bbq3a-cai`).

## Endpoint
```
POST /v1/images/generations
Authorization: Bearer <API_KEY>        # or the router's II session; one of the two is required
Content-Type: application/json
```

## Request
| Field | Type | Req | Default | Notes |
|-------|------|-----|---------|-------|
| `model` | string | ✓ | — | must be `"raven-diffusion"` |
| `prompt` | string | ✓ | — | 1–1000 chars |
| `seed` | integer | — | random | **determinism**: same `(prompt, seed)` → byte-identical PNG |
| `n` | integer | — | `1` | only `1` supported in BETA; >1 → `400` |
| `size` | string | — | `"64x64"` | only `"64x64"` supported in BETA; other → `400` |
| `response_format` | string | — | `"b64_json"` | `"b64_json"` or `"url"` (url served from blob_store) |

```json
{ "model": "raven-diffusion", "prompt": "a raven over a neon city", "seed": 4242 }
```

## Response — 200
OpenAI shape (`created`, `data[]`) plus TRP trust fields on each item.
| Field | Type | Notes |
|-------|------|-------|
| `created` | integer | unix seconds |
| `data[].b64_json` | string | PNG bytes, base64 (present when `response_format="b64_json"`) |
| `data[].url` | string | blob_store URL (present when `response_format="url"`) |
| `data[].seed` | integer | the seed actually used (echo random back so clients can reproduce) |
| `data[].canister` | string | `"7chv3-5iaaa-aaaao-bbq3a-cai"` |
| `data[].module_hash` | string | `"d89a560a…"` — what the canister is running |
| `data[].sha256` | string | SHA-256 of the PNG (hex) |
| `data[].deterministic` | boolean | always `true` for `raven-diffusion` |

```json
{
  "created": 1730000000,
  "data": [{
    "b64_json": "<base64-png>",
    "seed": 4242,
    "canister": "7chv3-5iaaa-aaaao-bbq3a-cai",
    "module_hash": "d89a560af45e5a39b5e2ef1572152215b0c78c7690e3af997cb2ff780694c513",
    "sha256": "bec2a6db063332a7667774016c5e505b6b11af5dc641983a6b564a56e480737f",
    "deterministic": true
  }]
}
```

## Async HTTP (default for `raven-diffusion`)

The IC HTTP gateway times out near **~60s**. Full on-chain load+generate often exceeds that, so **HTTP uses async jobs by default**.

1. **`POST /v1/images/generations`** → **202**  
   `{ "id": "<job>", "object": "image.generation.job", "status": "queued" }`  
   Pass `"async": false` only if you accept sync risk (Playground uses the IC-native update `playground_image_generate` instead).

2. **`GET /v1/images/result/{id}`** (same `Authorization` / `x-oc-api-key`) →  
   `{ "id", "object": "image.generation.result", "status": "queued"|"running"|"done"|"error", "result"?: { …OpenAI image body… } }`

See [`ROUTER-ENABLEMENT.md`](ROUTER-ENABLEMENT.md) for curl examples and [`relay/DEPLOY.md`](../relay/DEPLOY.md) for off-chain chat.

## Errors (OpenAI error envelope)
```json
{ "error": { "type": "...", "code": "...", "message": "..." } }
```
| HTTP | `error.code` | When |
|------|--------------|------|
| 400 | `invalid_request` | bad model/size/n, missing prompt |
| 401 | `unauthorized` | missing/invalid API key or session |
| 429 | `rate_limit_exceeded` | per-principal daily free quota hit (include `Retry-After`) |
| 503 | `canister_unavailable` | diffusion canister out of cycles / busy |
| 500 | `generation_failed` | canister trap or internal error (include a short detail) |

## Determinism / verification
Clients may display and let users verify: the image is produced fully on-chain and is reproducible.
`sha256` is the PNG hash; `module_hash` is independently checkable via
`dfx canister info 7chv3-5iaaa-aaaao-bbq3a-cai --network ic`. Same `(prompt, seed)` always yields the same `sha256`.

## Examples
```bash
curl https://<router-host>/v1/images/generations \
  -H "Authorization: Bearer $TRP_KEY" -H "Content-Type: application/json" \
  -d '{"model":"raven-diffusion","prompt":"a raven over a neon city","seed":4242}'
```
```js
const r = await fetch(`${base}/v1/images/generations`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "raven-diffusion", prompt, seed }),
});
if (r.status === 429) { /* show quota message + Retry-After */ }
const { data } = await r.json();
img.src = `data:image/png;base64,${data[0].b64_json}`;   // or data[0].url
```

## BETA scope (keep honest)
- `n=1`, `size="64x64"` only. Free per-principal daily quota is the drain guard for now.
- No $TRP / paid credits yet — that's Phase 2 (the `trp_meter` canister). No price/token copy in responses or UI.
