#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DFX_WARNING=-mainnet_plaintext_identity
export TERM="${TERM:-xterm-256color}"
export NO_COLOR=1
NET=ic
ID="${DFX_IDENTITY:-ic_deploy_plain}"
d() { dfx "$@" --network "$NET" --identity "$ID"; }

[ "${CONFIRM_MAINNET:-}" = "1" ] || { echo "set CONFIRM_MAINNET=1"; exit 1; }

node scripts/wire-raven-diffusion.mjs
node scripts/build-playground-assets.mjs
d deploy trp_playground --yes || {
  PG=$(d canister id trp_playground)
  d canister deposit-cycles 300000000000 "$PG"
  d deploy trp_playground --yes
}
PG=$(d canister id trp_playground)
echo "PLAYGROUND_URL=https://${PG}.icp0.io/"
