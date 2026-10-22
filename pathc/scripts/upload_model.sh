#!/usr/bin/env bash
# Chunk-upload GGUF (+ optional TAESD) to local diffusion_canister.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
[[ -f .env.pathc ]] && source .env.pathc

CANISTER="${CANISTER_ID_DIFFUSION_CANISTER:-diffusion_canister}"
NETWORK="${DFX_NETWORK:-local}"
CHUNK="${CHUNK_BYTES:-1900000}"

upload_file() {
  local method=$1
  local path=$2
  local size
  size=$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path")
  echo "Uploading $path ($size bytes) via $method ..."
  local offset=0
  while [[ "$offset" -lt "$size" ]]; do
    local remain=$((size - offset))
    local n=$CHUNK
    [[ "$remain" -lt "$n" ]] && n=$remain
    local blob
    blob=$(dd if="$path" bs=1 skip="$offset" count="$n" 2>/dev/null | xxd -p -c 256 | tr -d '\n' | sed 's/\(..\)/\\(&\)/g' | xargs -0 printf 'blob "%s"' 2>/dev/null || true)
    # dfx expects blob as vec nat8 in candid record
    local hex
    hex=$(dd if="$path" bs=1 skip="$offset" count="$n" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    local vec
    vec=$(python3 - <<PY
hexs = "$hex".strip()
bytes_list = [f"{int(hexs[i:i+2],16):d}" for i in range(0, len(hexs), 2)]
print("vec {" + "; ".join(bytes_list) + "}")
PY
)
    dfx canister call "$CANISTER" "$method" "(record { offset = ${offset} : nat64; chunk = ${vec} })" --network "$NETWORK" >/dev/null
    offset=$((offset + n))
    echo "  offset=$offset / $size"
  done
}

MODEL="${1:-$ROOT/models/sd_turbo-f16-q8_0.gguf}"
TAESD="${2:-$ROOT/models/taesd.safetensors}"

upload_file upload_weights_chunk "$MODEL"
if [[ -f "$TAESD" ]]; then
  upload_file upload_taesd_chunk "$TAESD"
fi

dfx canister call "$CANISTER" weights_bytes_loaded --network "$NETWORK"
dfx canister call "$CANISTER" taesd_bytes_loaded --network "$NETWORK"
