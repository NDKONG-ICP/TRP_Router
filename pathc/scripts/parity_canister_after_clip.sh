#!/usr/bin/env bash
# Run AFTER canister CLIP completes (parity_status embeds_ready=true). Do not upgrade mid-generate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATHC_DEBUG_FLAGS="${PATHC_DEBUG_FLAGS:-65536}"
"$ROOT/scripts/parity_fetch_canister.mjs" status
"$ROOT/scripts/parity_harness.sh" canister-embeds
