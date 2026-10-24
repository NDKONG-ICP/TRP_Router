#!/usr/bin/env bash
# BETA: deploy router upgrade + trp_playground assets (headless ic_deploy_plain).
set -euo pipefail
cd "$(dirname "$0")/.."
export DFX_WARNING=-mainnet_plaintext_identity
export TERM="${TERM:-xterm-256color}"
export NO_COLOR=1
NET=ic
ID="${DFX_IDENTITY:-ic_deploy_plain}"
GQKKO="gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae"
II="ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe"

d() { dfx "$@" --network "$NET" --identity "$ID"; }

[ "${CONFIRM_MAINNET:-}" = "1" ] || { echo "set CONFIRM_MAINNET=1"; exit 1; }

echo "=== upgrade router_canister (raven-diffusion endpoint) ==="
d deploy router_canister --yes

echo "=== wire diffusion + playground API key ==="
node scripts/wire-raven-diffusion.mjs

echo "=== create or deploy trp_playground assets ==="
if ! d canister id trp_playground >/dev/null 2>&1; then
  d canister create trp_playground \
    --with-cycles 800000000000 \
    --controller "$GQKKO" --controller "$II"
fi
d deploy trp_playground --yes || {
  PG=$(d canister id trp_playground)
  d canister deposit-cycles 500000000000 "$PG"
  d deploy trp_playground --yes
}

PG=$(d canister id trp_playground)
ROUTER=$(d canister id router_canister)
echo ""
echo "PLAYGROUND_URL=https://${PG}.icp0.io/"
echo "ROUTER_IMAGES_POST=https://${ROUTER}.icp0.io/v1/images/generations"
echo "ROUTER_CANISTER=${ROUTER}"
echo "PLAYGROUND_CANISTER=${PG}"
