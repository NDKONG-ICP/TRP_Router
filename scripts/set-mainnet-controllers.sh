#!/usr/bin/env bash
# Canonical TRP owner controllers (Relaunch Spec §6).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
NET="${1:-ic}"
CONTROLLERS=(
  "sh7h6-b7xcy-tjank-crj6d-idrcr-ormbi-22yqs-uanyl-itbp3-ur5ue-wae"
  "yyirv-5pjkg-oupac-gzja4-ljzfn-6mvon-r5w2i-6e7wm-sde75-wuses-nqe"
  "in4fs-lkdc6-2qxlg-c6woz-z5yqw-6hdwo-cnlym-qny2v-fjttc-e52da-lqe"
  "gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae"
)
for c in blob_store router_canister http_transform llama_cpp_qwen25; do
  if dfx canister id "$c" --network "$NET" >/dev/null 2>&1; then
    echo "=== controllers: $c ==="
    args=(--network "$NET")
    for p in "${CONTROLLERS[@]}"; do
      args+=(--set-controller "$p")
    done
    dfx canister update-settings "$c" "${args[@]}"
  fi
done
