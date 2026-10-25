# trp_pay — deploy & go-live (Phases 2–4)

## Phase 2 (burn + treasury)

After `buy_credits`, `trp_pay` splits each pack’s ICP:

- **Burn:** `cycles_slice_e8s × credits_in_pack` (config default **3_000_000** e8s ≈ **0.03 ICP per credit**) → ICRC transfer to CMC with TPUP memo → `notify_top_up` mints cycles on **`diffusion_canister`**.
- **Treasury:** remainder (minus fees) → ICRC transfer to **`treasury`** (`crpau-rqaaa-aaaao-a4neq-cai`).
- Failures are logged only; **credits are already granted**. Admin fallback: **`sweep_to_treasury()`**.

CMC subaccount encoding: `0x0a || canister_id bytes || zero-pad` (32 bytes). Do **not** use raw principal-at-offset-0 (that stranded funds in a prior incident).

## Prerequisite: cycles wallet

`ic_deploy_plain` uses cycles wallet **`daf6l-jyaaa-aaaao-a4nba-cai`**. Creating `trp_pay` needs **well above ~0.12 TC** free on that wallet (target **≥ 2 TC** before deploy). Top up via **NNS → Wallet → Convert ICP to cycles** (Internet Identity controller) or `dfx ledger top-up daf6l-jyaaa-aaaao-a4nba-cai` from an identity that holds ICP — do **not** use custom CMC TPUP scripts.

One-shot after the wallet is funded:

```bash
CONFIRM_MAINNET=1 bash scripts/deploy-trp-pay-mainnet.sh
```

Or step-by-step:

```bash
export DFX_WARNING=-mainnet_plaintext_identity
export DFX_IDENTITY=ic_deploy_plain

# 1) Ship payment canister (payments disabled by default)
dfx deploy trp_pay --network ic

# 2) Wire config (leave payments_enabled = false)
dfx canister call trp_pay set_config "(record {
  payments_enabled = opt false;
  icp_ledger = opt principal \"ryjl3-tyaaa-aaaaa-aaaba-cai\";
  treasury = opt principal \"crpau-rqaaa-aaaao-a4neq-cai\";
  diffusion_canister = opt principal \"7chv3-5iaaa-aaaao-bbq3a-cai\";
  cmc = opt principal \"rkp4c-7iaaa-aaaaa-aaaca-cai\";
  router = opt principal \"5723t-oaaaa-aaaao-bbquq-cai\";
  cycles_slice_e8s = opt (3_000_000 : nat64);
})" --network ic

# 3) Admin II (owner)
dfx canister call trp_pay add_admin "(principal \"72w3b-oy3is-urqu2-sjyxa-oh5nc-lfs2i-p3mzm-tq3j5-pokxx-hc7ym-wqe\")" --network ic

# 4) Router points at trp_pay (optional: disable legacy meter so II gets 2 free/day on-router)
dfx canister call router_canister clear_trp_meter --network ic
dfx canister call router_canister set_trp_pay "(principal \"$(dfx canister id trp_pay --network ic)\")" --network ic

# 5) CMC smoke: enable payments briefly OR use smallest pack after funding II with ≥1 ICP
#    Verify 7chv3 cycle balance increases after a 1-credit buy with cycles_slice_e8s = 1_000_000 (0.01 ICP) test config.

# 6) Deploy router + playground
dfx deploy router_canister --network ic
CONFIRM_MAINNET=1 bash scripts/deploy-playground-only.sh
node scripts/wire-raven-diffusion.mjs

# 7) Go live
dfx canister call trp_pay set_config "(record { payments_enabled = opt true })" --network ic
```

## Phase 3 (router)

- **2 free** on-chain images per **II** principal per UTC day (`Authorization: Bearer ii:…`).
- **50/day** shared bucket for playground API key (`x-oc-api-key`).
- After free quota: **`trp_pay.consume_credit`** (router must be set in `trp_pay` config).
- Playground sends **`x-oc-api-key: ii:<principal>`** (and `Authorization`) when signed in — required because the icp0.io boundary drops bare `Authorization` (see `trp-core.js`).
- If **`set_trp_meter`** is still set, meter exhaustion falls through to **2 free/day + trp_pay** on the router.

## Phase 4 (wallet UI)

Wallet tab: quote packs, paid credit balance, **Approve + Buy** via ICRC-2. User must hold ICP on the II ledger account first.

## CMC smoke buy (CLI)

From an identity with **≥ 1 ICP + fee** on the ledger (e.g. fund `ic_deploy_plain` / your II account):

```bash
export DFX_IDENTITY=ic_deploy_plain
export TRP_PAY_CANISTER_ID=ujwwi-hiaaa-aaaao-bbrha-cai
node scripts/trp-pay-smoke-buy.mjs
```

Then confirm **`7chv3`** cycle balance increased vs baseline.

## Local test

```bash
dfx start --background
dfx deploy mock_trp_ledger trp_pay router_canister
# init mock balances, approve, buy_credits, set_trp_pay, POST generate with ii: header
```
