#!/usr/bin/env bash
# Path C reproducible build steps (honest staging — see BUILD-NOTES.md for blockers).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SD="$ROOT/vendor/stable-diffusion.cpp"
export PATH="/opt/homebrew/bin:${PATH:-}"

echo "== C1 vendor =="
test -d "$SD/.git" || { echo "run: git clone into vendor/stable-diffusion.cpp"; exit 1; }
(cd "$SD" && git submodule update --init --depth 1)

echo "== C2 native host build (reference / dev only, not IC WASM) =="
mkdir -p "$SD/build-native"
if [[ ! -f "$SD/build-native/Makefile" ]]; then
  (cd "$SD/build-native" && cmake .. -DCMAKE_BUILD_TYPE=Release -DSD_BUILD_EXAMPLES=ON)
fi
(cmake --build "$SD/build-native" -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)")

echo "== C2 IC WASM (WASI probe) =="
WASI="$HOME/.icpp/wasi-sdk/wasi-sdk-25.0/share/cmake/wasi-sdk.cmake"
if [[ -f "$WASI" ]]; then
  mkdir -p "$SD/build-wasi-probe"
  if ! (cd "$SD/build-wasi-probe" && cmake .. \
    -DCMAKE_TOOLCHAIN_FILE="$WASI" \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DSD_BUILD_EXAMPLES=OFF 2>&1 | tail -5); then
    echo "WASI cmake failed (expected: ggml Threads) — see BUILD-NOTES.md"
  fi
else
  echo "wasi-sdk not found at ~/.icpp — skip WASI probe"
fi
echo "icpp build-wasm: not configured for sd.cpp yet (see BUILD-NOTES.md)."

echo "Done (host binaries in $SD/build-native/bin if cmake succeeded)."
