#!/usr/bin/env bash
# One-time local setup after deploy + GGUF upload + load_model (see BUILD-REPORT.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${DFX:-$HOME/.cache/dfinity/versions/0.29.2}/..:$PATH"
DFX="${DFX:-$HOME/.cache/dfinity/versions/0.29.2/dfx}"

echo "=== set_access level 1 (non-anonymous callers, e.g. router_canister) ==="
"$DFX" canister call llama_cpp_qwen25 set_access '(record { level = 1 : nat16 })'

ROUTER=$("$DFX" canister id router_canister)
BLOB=$("$DFX" canister id blob_store)
LLAMA=$("$DFX" canister id llama_cpp_qwen25)

"$DFX" canister call router_canister init_router "(principal \"$BLOB\")"
"$DFX" canister call router_canister set_llama_qwen25 "(principal \"$LLAMA\")"

echo "router wired to llama_cpp_qwen25 $LLAMA"
