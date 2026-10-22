#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cache/dfinity/versions/0.29.2:$PATH"
NET=ic

echo "=== load_model ==="
dfx canister call llama_cpp_qwen25 load_model --network "$NET" '(record {
  args = vec {
    "--model"; "models/model.gguf";
    "--cache-type-k"; "q8_0";
  }
})'

echo "=== set_access level 1 ==="
dfx canister call llama_cpp_qwen25 set_access --network "$NET" '(record { level = 1 : nat16 })'

ROUTER=$(dfx canister id router_canister --network "$NET")
LLAMA=$(dfx canister id llama_cpp_qwen25 --network "$NET")

dfx canister call router_canister set_llama_qwen25 --network "$NET" "(principal \"$LLAMA\")"
echo "router $ROUTER wired to llama $LLAMA"
