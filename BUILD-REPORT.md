# TRP Router — BUILD REPORT (local replica)

**Branch:** `trp-router/build`  
**Date:** 2026-10-21  
**Mainnet:** NOT deployed (per hard boundary).

## Milestones

| Milestone | Status | Notes |
|-----------|--------|--------|
| **M1 blob_store** | **PASS (local)** | `node scripts/test-m1-blob.mjs`: 3.2 MiB chunked upload, SHA-256 commit, `get_chunk` reassembly, `http_request` + streaming callback reassembly. Fixed `StreamingHttpCallback` (`define_function!`) for large-blob HTTP. |
| **M2 router + images** | **PASS (local)** | `node scripts/test-m2-image.mjs`: zero keys → **pollinations-flux** (402 + JPEG with `Accept: image/*`); image stored at `/blob/<sha256>` in blob_store. On-chain HTTPS outcalls (no worker fallback). |
| **M3 onicai** | **STAGED** | Pinned commit in `VERSIONS.md`; `vendor/llama_cpp_canister/README-STAGE.md`. `/v1/chat/completions` for `trp/onchain-*` returns 503 until C++ build. |
| **M4 moderation** | **PASS (local)** | Disallowed prompt blocked fail-closed; normal prompt generates. On-chain enhance STAGED (pass-through). |
| **M5 payments** | **STAGED** | `PAYMENTS_ENABLED=false`; `mock_trp_ledger` deployed; `scripts/test-m5-mock.mjs` verifies gate. |
| **M6 stake/BYOK/NFT** | **STAGED** | Placeholders in `payments.rs`. |
| **M7 docs** | **DRAFT** | `README.md`, `docs/OpenAI-SDK-snippet.md` — legal review pending. |

## Local replica setup (verified)

- **dfx 0.29.2** + Pocket IC on `127.0.0.1:8000`.
- If port 8000 is already in use (e.g. Raven DAPP local network), **reuse** that replica: `cd trp-router && dfx ping && dfx deploy --yes`. Do not run conflicting `dfx start --clean` in two projects without coordinating ports.
- Standalone trp-router on 8100 was attempted; Pocket IC exited early in this environment — shared 8000 is the supported path for smoke here.
- Scripts: `npm install` once in `trp-router/` for `@dfinity/agent` tests.

## Sample outputs

- `tmp/m1-pass.json` — last M1 content hash  
- `tmp/m2-image-response.json` — OpenAI-shaped image response with `provider`  
- `tmp/m2-status.json` — `/v1/status` provider health  

## Honest gaps

- **onicai C++ build** not completed — M3 acceptance blocked until owner runs icpp-pro pipeline.
- **`POST /v1/images/edits`** → 501 (multipart not implemented).
- **Small GGUF round-trip** — same blob_store API as M1; not run in automated smoke (add manual upload before M3).
- **M5–M6** full ICRC-2 pay flow needs `PAYMENTS_ENABLED=true` dev build + expanded tests.

## Provider / key status

| Provider | Keys | Local demo |
|----------|------|------------|
| Pollinations | None | Works with `Accept: image/*` (HTTP 402 + body) |
| Cloudflare FLUX | Account + token | Skipped when unset |
| Gemini image | API key | Skipped when unset |

## Owner next steps

1. `./scripts/smoke-local.sh` with replica healthy on :8000.
2. Vendor/build onicai at pinned commit; load GGUF via blob_store; wire M3 SSE chat.
3. Legal review → remove DRAFT banners.
4. After TRP mint: mock → real ledger; mainnet deploy + cycles (out of scope for this run).

See `VERSIONS.md` for pins.
