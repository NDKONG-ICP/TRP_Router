#!/usr/bin/env bash
# Local smoke (M1–M4). Requires a healthy local replica on 127.0.0.1:8000.
# If Raven DAPP (or trp-router) already runs `dfx start`, reuse it — do NOT `dfx start --clean` here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export NO_COLOR=1 CI=1
DFX="${DFX:-$HOME/.cache/dfinity/versions/0.29.2/dfx}"
export PATH="$(dirname "$DFX"):$PATH"

run_dfx() { "$DFX" "$@"; }

echo "=== ping local replica ==="
run_dfx ping >/dev/null

echo "=== deploy (local only) ==="
run_dfx deploy --yes

mkdir -p tmp
echo "=== M1 blob ==="
node scripts/test-m1-blob.mjs | tee tmp/m1.log

echo "=== M2 image + M4 moderation ==="
node scripts/test-m2-image.mjs | tee tmp/m2.log

echo "=== M3 on-chain chat (staged) ==="
run_dfx canister call router_canister http_request_update '(record {
  method="POST"; url="/v1/chat/completions";
  headers=vec {};
  body=blob "7b226d6f64656c223a227472702f6f6e636861696e2d6c6c616d612d332e322d3162222c226d65737361676573223a5b7b22726f6c65223a2275736572222c22636f6e74656e74223a226869227d5d7d";
})' 2>&1 | tee tmp/m3-staged.log | head -8

if [[ -f scripts/test-m5-mock.mjs ]]; then
  echo "=== M5–M6 mock (staged) ==="
  node scripts/test-m5-mock.mjs | tee tmp/m5.log || true
fi

echo "Smoke finished — see tmp/ and BUILD-REPORT.md"
