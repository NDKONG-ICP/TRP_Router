#!/usr/bin/env bash
# Staged host ↔ canister parity (apples-to-apples: q4 GGUF SHA, prompt, seed, CPU RNG, EPS, Euler).
# Do NOT upgrade the canister while a long generate is in flight.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODEL_SHA="9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5"
PROMPT="${PATHC_PROMPT:-a black raven on a branch, silhouette, minimal}"
SEED="${PATHC_SEED:-4242}"
W="${PATHC_WIDTH:-16}"
H="${PATHC_HEIGHT:-16}"
TMP="${PATHC_PARITY_TMP:-$ROOT/tmp/parity}"
mkdir -p "$TMP"

export PATHC_PROMPT="$PROMPT"
export PATHC_SEED="$SEED"
export PATHC_WIDTH="$W"
export PATHC_HEIGHT="$H"
export PATHC_MODEL_SHA256="$MODEL_SHA"
export PATHC_MODEL="${PATHC_MODEL:-$ROOT/models/sd_turbo-f16-q4_0.gguf}"
export PATHC_TAESD="${PATHC_TAESD:-$ROOT/models/taesd.safetensors}"
# Plain Euler (non-ancestral): do not set bit8; canister begin() matches when debug_flags=0.
export PATHC_DEBUG_FLAGS="${PATHC_DEBUG_FLAGS:-0}"

STAGE="${1:-embeds}"

host_embeds() {
  local out="$TMP/embeds_host.pathc"
  export PATHC_PARITY_EMBEDS_OUT="$out"
  export PATHC_PARITY_EMBEDS_ONLY=1
  "$ROOT/scripts/build-parity-host.sh"
  "$ROOT/build-native/bin/pathc-parity" embeds
  echo "host embeds: $out ($(shasum -a 256 "$out" | awk '{print $1}'))"
}

host_unet() {
  local out="$TMP/unet_host.pathc"
  export PATHC_PARITY_UNET_OUT="$out"
  "$ROOT/scripts/build-parity-host.sh"
  "$ROOT/build-native/bin/pathc-parity" unet
  echo "host unet: $out ($(shasum -a 256 "$out" | awk '{print $1}'))"
}

canister_fetch() {
  local which="$1"
  local out="$TMP/${which}_canister.pathc"
  "$ROOT/scripts/parity_fetch_canister.mjs" "$which" "$out"
  echo "canister $which: $out ($(shasum -a 256 "$out" | awk '{print $1}'))"
}

compare() {
  local which="$1"
  node "$ROOT/scripts/parity_compare.mjs" \
    "$TMP/${which}_host.pathc" "$TMP/${which}_canister.pathc"
}

case "$STAGE" in
  embeds)
    host_embeds
    echo "After wasm with parity queries is deployed, run: $0 canister-embeds"
    ;;
  canister-embeds)
    canister_fetch embeds
    compare embeds
    ;;
  unet)
    host_unet
    echo "After wasm deploy: PATHC_DEBUG_FLAGS=69632 begin (0x10000|0x20000) then $0 canister-unet"
    ;;
  canister-unet)
    canister_fetch unet
    compare unet
    ;;
  status)
    "$ROOT/scripts/parity_fetch_canister.mjs" status
    ;;
  *)
    echo "Usage: $0 embeds|canister-embeds|unet|canister-unet|status"
    exit 2
    ;;
esac
