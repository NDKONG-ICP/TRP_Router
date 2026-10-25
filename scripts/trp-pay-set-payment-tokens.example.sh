#!/usr/bin/env bash
# Example admin calls — verify pool IDs via ICPSwap SwapFactory before mainnet use.
# Usage: DFX_IDENTITY=ic_deploy_plain bash scripts/trp-pay-set-payment-tokens.example.sh
set -euo pipefail
NET=ic
PAY="${TRP_PAY_CANISTER_ID:-ujwwi-hiaaa-aaaao-bbrha-cai}"
d() { dfx canister call trp_pay "$@" --network "$NET"; }

# ckBTC / ICP — token0 ckBTC, token1 ICP (ICPSwap docs)
d set_payment_token "(record {
  symbol = \"ckBTC\";
  ledger = principal \"mxzaz-hqaaa-aaaar-qaada-cai\";
  decimals = 8 : nat8;
  icpswap_pool = principal \"xmiu5-jqaaa-aaaag-qbz7q-cai\";
  sell_zero_for_one = opt true;
  enabled = true;
  stub_token_base_per_icp_e8 = 0 : nat64;
})"

# $TRP placeholder — disabled until ledger exists
d set_payment_token "(record {
  symbol = \"\$TRP\";
  ledger = principal \"aaaaa-aa\";
  decimals = 8 : nat8;
  icpswap_pool = principal \"aaaaa-aa\";
  sell_zero_for_one = null;
  enabled = false;
  stub_token_base_per_icp_e8 = 0 : nat64;
})"

# ckETH / ckUSDC (SwapFactory fee 3000, token0=ICP for both → sell_zero_for_one = false)
d set_payment_token "(record {
  symbol = \"ckETH\";
  ledger = principal \"ss2fx-dyaaa-aaaar-qacoq-cai\";
  decimals = 18 : nat8;
  icpswap_pool = principal \"angxa-baaaa-aaaag-qcvnq-cai\";
  sell_zero_for_one = opt false;
  enabled = true;
  stub_token_base_per_icp_e8 = 0 : nat64;
})"

d set_payment_token "(record {
  symbol = \"ckUSDC\";
  ledger = principal \"xevnm-gaaaa-aaaar-qafnq-cai\";
  decimals = 6 : nat8;
  icpswap_pool = principal \"mohjv-bqaaa-aaaag-qjyia-cai\";
  sell_zero_for_one = opt false;
  enabled = true;
  stub_token_base_per_icp_e8 = 0 : nat64;
})"

# ckSOL / $TRP: defer until pool + ledger confirmed on mainnet.
