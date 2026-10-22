#!/usr/bin/env bash
# Host-only reference run (C3/C5 staging while C2 IC WASM is blocked).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SD="$ROOT/vendor/stable-diffusion.cpp/build-native/bin/sd-cli"
MODEL="$ROOT/models/sd_turbo-f16-q8_0.gguf"
TAE="$ROOT/models/taesd.safetensors"
OUT="$ROOT/tmp/reference-cpu-0.png"
PROMPT="${PROMPT:-a black raven on a branch, silhouette, minimal}"
SEED="${SEED:-4242}"

test -x "$SD" || { echo "run ../build.sh first"; exit 1; }
test -f "$MODEL" || { echo "download model — see models/README.md"; exit 1; }

mkdir -p "$ROOT/tmp"
/usr/bin/time -p "$SD" \
  -m "$MODEL" -p "$PROMPT" -H 256 -W 256 --steps 1 --cfg-scale 1.0 -s "$SEED" \
  --taesd "$TAE" --rng cpu -v -o "$OUT" 2>"$ROOT/tmp/host_reference.time.txt"

echo "PNG: $OUT"
shasum -a 256 "$OUT"
