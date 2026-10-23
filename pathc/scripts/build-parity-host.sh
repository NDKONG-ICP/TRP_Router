#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SD="$ROOT/vendor/stable-diffusion.cpp"
BN="$SD/build-native"
OUT="$ROOT/build-native/bin/pathc-parity"

if [[ ! -d "$BN" ]]; then
  echo "run $ROOT/build.sh first (native sd.cpp)" >&2
  exit 1
fi

if ! rg -q "TRP_PATHC_PARITY:BOOL=ON" "$BN/CMakeCache.txt" 2>/dev/null; then
  (cd "$BN" && cmake .. -DCMAKE_BUILD_TYPE=Release -DSD_BUILD_EXAMPLES=ON \
    -DTRP_PATHC_PARITY=ON -DPATHC_SRC_ICPP="$ROOT/src-icpp")
fi
cmake --build "$BN" --target pathc-parity -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
mkdir -p "$(dirname "$OUT")"
cp "$BN/bin/pathc-parity" "$OUT"
echo "pathc-parity: $OUT"
