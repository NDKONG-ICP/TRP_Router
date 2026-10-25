#!/usr/bin/env bash
# trp_pay Phases 2–4 mainnet go-live (see TRP-PAY-DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")/.."
export DFX_WARNING=-mainnet_plaintext_identity
export TERM="${TERM:-xterm-256color}"
export NO_COLOR=1
NET=ic
ID="${DFX_IDENTITY:-ic_deploy_plain}"
d() { dfx "$@" --network "$NET" --identity "$ID"; }

[ "${CONFIRM_MAINNET:-}" = "1" ] || {
  echo "Refusing mainnet deploy without CONFIRM_MAINNET=1"
  exit 1
}

echo "== cycles wallet =="
d wallet balance || true

echo "== 1) trp_pay =="
d deploy trp_pay --yes
PAY="$(d canister id trp_pay)"
echo "trp_pay id: $PAY"

echo "== 2) trp_pay config (payments off) =="
d canister call trp_pay set_config "(record {
  payments_enabled = opt false;
  icp_ledger = opt principal \"ryjl3-tyaaa-aaaaa-aaaba-cai\";
  treasury = opt principal \"crpau-rqaaa-aaaao-a4neq-cai\";
  diffusion_canister = opt principal \"7chv3-5iaaa-aaaao-bbq3a-cai\";
  cmc = opt principal \"rkp4c-7iaaa-aaaaa-aaaca-cai\";
  router = opt principal \"5723t-oaaaa-aaaao-bbquq-cai\";
  cycles_slice_e8s = opt (3_000_000 : nat64);
})"

echo "== 3) trp_pay admin =="
d canister call trp_pay add_admin "(principal \"72w3b-oy3is-urqu2-sjyxa-oh5nc-lfs2i-p3mzm-tq3j5-pokxx-hc7ym-wqe\")"

echo "== 4) router → trp_pay =="
d canister call router_canister clear_trp_meter
d canister call router_canister set_trp_pay "(principal \"$PAY\")"

echo "== 5) router + playground =="
d deploy router_canister --yes
node scripts/build-playground-assets.mjs
bash scripts/deploy-playground-only.sh

echo "== 6) STOP: CMC smoke (0.01 ICP/credit) before enabling payments =="
echo "    Optional test config:"
echo "    d canister call trp_pay set_config \"(record { cycles_slice_e8s = opt (1_000_000 : nat64) })\""
echo "    Fund II with ICP, buy smallest pack, verify 7chv3 cycles, then:"
echo "    d canister call trp_pay set_config \"(record { payments_enabled = opt true })\""
