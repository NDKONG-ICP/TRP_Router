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

## Phase A — alt-token packs (ICPSwap quote, no auto-swap)

**Behavior:** Same credit packs as ICP; price in ckBTC / ckETH / ckUSDC / ckSOL via on-chain **SwapPool `quote`**. User pays with **ICRC-2**; `trp_pay` grants credits, then **forwards the received token to treasury** (owner II). No ICPSwap swap in this phase — you convert liquidity manually.

**API (trp_pay):**

- `list_payment_tokens` / admin `set_payment_token` / `remove_payment_token`
- `quote_token(pack_index, symbol)` — composite query; includes ~0.5% buffer vs raw pool quote
- `buy_credits_token(pack_index, symbol)` — re-prices at call time, then `icrc2_transfer_from` + treasury forward
- `$TRP`: keep `enabled = false` until a ledger exists (`ledger` must not be anonymous when enabled)

**Mainnet pool IDs (SwapFactory `4mmnk-kiaaa-aaaag-qbllq-cai`, fee 3000):**

| Symbol | Ledger | Pool | sell_zero_for_one |
|--------|--------|------|-------------------|
| ckBTC | `mxzaz-hqaaa-aaaar-qaada-cai` | `xmiu5-jqaaa-aaaag-qbz7q-cai` | `true` (token0=ckBTC) |
| ckETH | `ss2fx-dyaaa-aaaar-qacoq-cai` | `angxa-baaaa-aaaag-qcvnq-cai` | `false` (token0=ICP) |
| ckUSDC | `xevnm-gaaaa-aaaar-qafnq-cai` | `mohjv-bqaaa-aaaag-qjyia-cai` | `false` (token0=ICP) |

`quote_token` is an **update** call (not composite query) so ICPSwap pools on other subnets are reachable.

**Configure a token (mainnet example — ckBTC):**

```bash
export DFX_IDENTITY=ic_deploy_plain
PAY=ujwwi-hiaaa-aaaao-bbrha-cai
dfx canister call trp_pay set_payment_token "(record {
  symbol = \"ckBTC\";
  ledger = principal \"mxzaz-hqaaa-aaaar-qaada-cai\";
  decimals = 8 : nat8;
  icpswap_pool = principal \"xmiu5-jqaaa-aaaag-qbz7q-cai\";
  sell_zero_for_one = opt true;
  enabled = true;
  stub_token_base_per_icp_e8 = 0 : nat64;
})" --network ic
```

Look up other pools via SwapFactory `4mmnk-kiaaa-aaaag-qbllq-cai` → `getPool` (fee **3000**, token `standard = "ICRC2"` or `"ICRC1"` per pool). Set `sell_zero_for_one` from pool metadata (token0→token1 = `true` when selling token0 for ICP).

**Local replica:** set `icpswap_pool = principal \"aaaaa-aa\"` (anonymous) and non-zero `stub_token_base_per_icp_e8` for fixed-rate tests on `mock_trp_ledger`.

**Deploy order:** `dfx deploy trp_pay` → `set_payment_token` for each asset → tiny mainnet buy per token → `CONFIRM_MAINNET=1 bash scripts/deploy-playground-only.sh` for wallet UI.

## Phase B — auto-swap token → ICP → cycles

**Default: `auto_convert_enabled = false`** until you configure pools and run tiny mainnet tests.

When enabled, `buy_credits_token` after pulling tokens:

1. **ICPSwap** (ICRC-2 path): `icrc2_approve` pool → `depositFrom` → `swap` (with `amountOutMinimum` from quote × `(1 − slippage_bps)`) → `withdraw` ICP to `trp_pay`.
2. **ICP split** (same as ICP packs): `split_purchase_icp_with_lp` → CMC burn on `7chv3` + treasury remainder.
3. **On swap failure** (credits already granted): record **`admin_list_pending`**, attempt **token refund** to buyer; admin may **`admin_retry_conversion`** or **`admin_refund_pending`**.

**Config** (via `set_config`):

| Field | Default | Meaning |
|-------|---------|---------|
| `auto_convert_enabled` | false | Phase A treasury forward when false |
| `slippage_bps` | 100 | 1% min-out vs pool quote |
| `liquidity_share_bps` | 0 | Reserved for TRP LP (not wired) |
| `liquidity_add_enabled` | false | Gate `increaseLiquidity` until $TRP pool exists |
| `trp_liquidity_pool` | anonymous | Future TRP/<token> pool |

**Enable (after Phase A tokens configured):**

```bash
dfx canister call trp_pay set_config "(record {
  auto_convert_enabled = opt true;
  slippage_bps = opt (100 : nat32);
})" --network ic
```

**Smoke:** one minimal alt-token buy per asset; confirm `7chv3` cycles ↑ and treasury ICP; if pending row appears, use admin retry/refund — do not raise limits until clean.

Mainnet swap moves real funds — get explicit owner approval before enabling (`.cursor/rules/mainnet-icp-wallet-safety.mdc`).

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
