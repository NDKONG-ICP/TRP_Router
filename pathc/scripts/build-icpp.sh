#!/usr/bin/env bash
# Build diffusion_canister WASM via icpp-pro (must run from a path WITHOUT spaces).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="${PATHC_BUILD_ROOT:-/tmp/trp-pathc-nospace}"
rsync -a --delete "$SRC/" "$BUILD_ROOT/"
cd "$BUILD_ROOT"

SD="$BUILD_ROOT/vendor/stable-diffusion.cpp"
GGML_VER="$SD/build-native/ggml/src/ggml-version.h"
if [[ -f "$GGML_VER" ]]; then
  cp "$GGML_VER" "$SD/ggml/src/ggml-version.h"
else
  sed 's/@GGML_VERSION@/pathc-icp/; s/@GGML_BUILD_COMMIT@/a77d362/' \
    "$SD/ggml/src/ggml-version.h.in" > "$SD/ggml/src/ggml-version.h"
fi
ONIG_CFG="$BUILD_ROOT/thirdparty-wasi/oniguruma/config.h"
if [[ -f "$ONIG_CFG" ]]; then
  cp "$ONIG_CFG" "$SD/thirdparty/oniguruma/config.h"
elif [[ -f "$SD/build-native/thirdparty/oniguruma/config.h" ]]; then
  cp "$SD/build-native/thirdparty/oniguruma/config.h" "$SD/thirdparty/oniguruma/config.h"
else
  echo "missing onig config.h — run native cmake once or add thirdparty-wasi/oniguruma/config.h" >&2
  exit 1
fi

python3 "$BUILD_ROOT/scripts/gen-icpp-config.py" "$BUILD_ROOT"

# Universal preamble must apply to icpp runtime TUs too — rebuild IC API lib when config changes.
rm -rf "$BUILD_ROOT/build-library" "$BUILD_ROOT/build"

icpp build-wasm --config icpp.effective.toml --generate-bindings no "$@"
HASH=""
if [[ -f build/diffusion_canister.wasm ]]; then
  mkdir -p "$SRC/build"
  cp build/diffusion_canister.wasm "$SRC/build/"
  cp build/diffusion_canister.did "$SRC/build/" 2>/dev/null || cp diffusion_canister.did "$SRC/build/"
  HASH=$(shasum -a 256 build/diffusion_canister.wasm | awk '{print $1}')
  echo "WASM_SHA256=$HASH"
  ls -lah build/diffusion_canister.wasm
fi
