#!/usr/bin/env bash
# Host sd-cli reference vs on-chain PNG (same model/prompt/seed/size).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SD="$ROOT/vendor/stable-diffusion.cpp/build-native/bin/sd-cli"
MODEL="$ROOT/models/sd_turbo-f16-q4_0.gguf"
TAE="$ROOT/models/taesd.safetensors"
PROMPT="${PATHC_PROMPT:-a black raven on a branch, silhouette, minimal}"
SEED="${PATHC_SEED:-4242}"
W="${PATHC_WIDTH:-16}"
H="${PATHC_HEIGHT:-16}"
METHOD="${PATHC_SAMPLER:-euler}"   # euler | euler_a
PRED="${PATHC_PREDICTION:-eps}"  # eps | v

HOST_OUT="$ROOT/tmp/host-ref-${W}x${H}-${METHOD}-${PRED}.png"
ONCHAIN="${PATHC_ONCHAIN_PNG:-$ROOT/tmp/onchain-0.png}"

test -x "$SD" || { echo "missing sd-cli — run build.sh"; exit 1; }
mkdir -p "$ROOT/tmp"

echo "== Host sd.cpp ${W}x${H} method=$METHOD prediction=$PRED seed=$SEED =="
"$SD" -m "$MODEL" -p "$PROMPT" -H "$H" -W "$W" --steps 1 --cfg-scale 1.0 -s "$SEED" \
  --taesd "$TAE" --rng cpu --sampling-method "$METHOD" --prediction "$PRED" \
  -o "$HOST_OUT" 2>"$ROOT/tmp/host-ref.time.txt" | tail -5

echo "HOST  $(shasum -a 256 "$HOST_OUT" | awk '{print $1}')  $HOST_OUT"
if [[ -f "$ONCHAIN" ]]; then
  echo "CHAIN $(shasum -a 256 "$ONCHAIN" | awk '{print $1}')  $ONCHAIN"
  if cmp -s "$HOST_OUT" "$ONCHAIN"; then
    echo "MATCH: host and canister PNGs are byte-identical"
  else
    echo "MISMATCH: numerical or pipeline divergence (compare visually)"
  fi
else
  echo "No on-chain PNG at $ONCHAIN — run onchain_generate.mjs first"
fi
