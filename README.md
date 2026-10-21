# TRP Router (DRAFT)

OpenAI-compatible AI gateway on the Internet Computer. **Local replica only** in this build; no mainnet deploy, no real TRP.

## Quick start (local)

1. Start or reuse a local replica on `http://127.0.0.1:8000` (`dfx ping` from repo root or parent Raven DAPP project).
2. `cd trp-router && npm install && dfx deploy --yes`
3. `./scripts/smoke-local.sh`

## Canisters

| Canister | Role |
|----------|------|
| `blob_store` | Content-addressed chunked storage; `GET /blob/<sha256>` |
| `router_canister` | `/v1/images/generations`, `/v1/models`, `/v1/status`, chat (off-chain/on-chain staged) |
| `mock_trp_ledger` | Local ICRC-style mock for M5 tests only |

## Docs

- Architecture: `../docs/TRP-Router-Plan.md`
- Tokenomics (staged): `../docs/TRP-Router-Tokenomics-and-OnChain.md`
- Build status: [BUILD-REPORT.md](./BUILD-REPORT.md)
- OpenAI SDK (DRAFT): [docs/OpenAI-SDK-snippet.md](./docs/OpenAI-SDK-snippet.md)

**DRAFT:** Public copy pending legal review. Credits are prepaid utility; no price or yield claims.
