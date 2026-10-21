#!/usr/bin/env bash
# Re-wire router after wasm upgrade (thread_local config is not stable).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cache/dfinity/versions/0.29.2:$PATH"
NET=ic
BLOB=5y35h-dyaaa-aaaao-bbqua-cai
LLAMA=5ryw3-vqaaa-aaaao-bbqvq-cai
dfx canister call router_canister init_router "(principal \"$BLOB\")" --network "$NET"
dfx canister call router_canister set_llama_qwen25 "(principal \"$LLAMA\")" --network "$NET"
echo "router wired (blob + llama)"
