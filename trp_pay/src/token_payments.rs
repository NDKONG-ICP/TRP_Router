//! Alt-token pack purchases (Phase A): pull token, grant credits, forward token to treasury.

use candid::Nat;
use ic_cdk::println;

use crate::icpswap_quote;
use crate::payment_route;
use crate::{Account, Config, TransferFromArgs, TransferFromResult};

pub const QUOTE_MAX_AGE_NS: u64 = 120_000_000_000; // 120s UI staleness hint
pub const QUOTE_BUFFER_BPS: u64 = 50; // +0.5% on token amount vs bare pool quote

pub struct TokenCfg {
    pub symbol: String,
    pub ledger: candid::Principal,
    pub decimals: u8,
    pub icpswap_pool: candid::Principal,
    pub sell_zero_for_one: Option<bool>,
    pub enabled: bool,
    /// Local/test: when pool is anonymous, use stub rate (token base units per 1 ICP e8s).
    pub stub_token_base_per_icp_e8: u64,
}

pub async fn icrc1_fee(ledger: candid::Principal) -> Result<u64, String> {
    let (fee,): (Nat,) = ic_cdk::call(ledger, "icrc1_fee", ())
        .await
        .map_err(|e| format!("icrc1_fee: {e:?}"))?;
    fee.0.try_into().map_err(|_| "fee too large".to_string())
}

pub async fn compute_token_price(
    cfg: &TokenCfg,
    icp_e8s: u64,
) -> Result<u128, String> {
    let mut base = if cfg.icpswap_pool == candid::Principal::anonymous() {
        if cfg.stub_token_base_per_icp_e8 == 0 {
            return Err("token pool not configured".to_string());
        }
        icpswap_quote::stub_token_amount(cfg.stub_token_base_per_icp_e8, icp_e8s)
    } else {
        let zfo = match cfg.sell_zero_for_one {
            Some(v) => v,
            None => icpswap_quote::sell_zero_for_one(cfg.icpswap_pool, cfg.ledger).await?,
        };
        icpswap_quote::token_amount_for_icp_value(
            cfg.icpswap_pool,
            cfg.ledger,
            icp_e8s,
            zfo,
        )
        .await?
    };
    base = base.saturating_mul(10_000u128 + QUOTE_BUFFER_BPS as u128) / 10_000u128;
    Ok(base)
}

pub async fn pull_token_from_user(
    ledger: candid::Principal,
    caller: candid::Principal,
    amount: u128,
) -> Result<(), String> {
    let args = TransferFromArgs {
        spender_subaccount: None,
        from: Account {
            owner: caller,
            subaccount: None,
        },
        to: Account {
            owner: ic_cdk::id(),
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: None,
        memo: None,
        created_at_time: None,
    };
    let (res,): (TransferFromResult,) = ic_cdk::call(ledger, "icrc2_transfer_from", (args,))
        .await
        .map_err(|e| format!("transfer_from: {e:?}"))?;
    match res {
        TransferFromResult::Ok(_) => Ok(()),
        TransferFromResult::Err(e) => Err(format!("payment failed: {e:?}")),
    }
}

pub async fn forward_token_to_treasury(
    cfg: &Config,
    token_ledger: candid::Principal,
    amount: u128,
) -> Result<(), String> {
    if amount == 0 {
        return Ok(());
    }
    let fee = icrc1_fee(token_ledger).await?;
    if amount <= fee as u128 {
        println!("trp_pay: skip token treasury — amount {amount} <= fee {fee}");
        return Ok(());
    }
    let send = amount - fee as u128;
    payment_route::route_treasury_token(token_ledger, cfg.treasury, send, fee)
        .await
        .map_err(|e| {
            println!("trp_pay: token treasury forward failed (credits kept): {e}");
            e
        })
}
