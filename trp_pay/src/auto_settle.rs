//! Phase B: auto-swap alt-token payments to ICP, with queue + refund fallbacks.

use candid::{CandidType, Deserialize, Principal};
use ic_cdk::println;

use crate::icpswap_convert::{self, SwapToIcpParams};
use crate::icpswap_quote;
use crate::payment_route;
use crate::token_payments::{self, TokenCfg};
use crate::Config;

#[derive(Clone, Debug, CandidType, serde::Serialize, serde::Deserialize)]
pub enum PendingStatus {
    Pending,
    Converted,
    Refunded,
    Failed,
}

#[derive(Clone, CandidType, Deserialize, serde::Serialize)]
pub struct PendingConversion {
    pub id: u64,
    pub user: Principal,
    pub token_ledger: Principal,
    pub pool: Principal,
    pub token_amount: u128,
    pub pack_index: u32,
    pub icp_e8s: u64,
    pub credits: u64,
    pub status: PendingStatus,
    pub last_error: String,
    pub at_ns: u64,
}

pub struct ConvertConfig {
    pub auto_convert_enabled: bool,
    pub slippage_bps: u32,
    pub liquidity_share_bps: u32,
    pub liquidity_add_enabled: bool,
    pub trp_liquidity_pool: Principal,
}

pub async fn settle_after_token_pull(
    cfg: &Config,
    cc: &ConvertConfig,
    tok: &TokenCfg,
    user: Principal,
    token_amount: u128,
    pack_index: u32,
    icp_e8s: u64,
    credits: u64,
    record_pending: impl Fn(PendingConversion),
) {
    if !cc.auto_convert_enabled || tok.icpswap_pool == Principal::anonymous() {
        if let Err(e) =
            token_payments::forward_token_to_treasury(cfg, tok.ledger, token_amount).await
        {
            println!("trp_pay: phase A forward failed: {e}");
            record_pending(PendingConversion {
                id: 0,
                user,
                token_ledger: tok.ledger,
                pool: tok.icpswap_pool,
                token_amount,
                pack_index,
                icp_e8s,
                credits,
                status: PendingStatus::Pending,
                last_error: e,
                at_ns: ic_cdk::api::time(),
            });
        }
        return;
    }

    let zero_for_one = match tok.sell_zero_for_one {
        Some(v) => v,
        None => match icpswap_quote::sell_zero_for_one(tok.icpswap_pool, tok.ledger).await {
            Ok(v) => v,
            Err(e) => {
                record_pending(failed_pending(
                    user,
                    tok,
                    token_amount,
                    pack_index,
                    icp_e8s,
                    credits,
                    e,
                ));
                let _ =
                    token_payments::forward_token_to_treasury(cfg, tok.ledger, token_amount).await;
                return;
            }
        },
    };

    match icpswap_convert::swap_token_to_icp(SwapToIcpParams {
        pool: tok.icpswap_pool,
        token_ledger: tok.ledger,
        icp_ledger: cfg.icp_ledger,
        token_amount,
        zero_for_one,
        slippage_bps: cc.slippage_bps,
    })
    .await
    {
        Ok(icp_received) => {
            let route_icp = icp_received.min(icp_e8s);
            payment_route::split_purchase_icp_with_lp(
                cfg.icp_ledger,
                cfg.cmc,
                cfg.treasury,
                cfg.diffusion_canister,
                route_icp,
                credits,
                cfg.cycles_slice_e8s,
                cc.liquidity_share_bps,
                cc.liquidity_add_enabled,
                cc.trp_liquidity_pool,
            )
            .await;
            println!(
                "trp_pay: auto_convert ok user={user} icp_received={icp_received} routed={route_icp}"
            );
        }
        Err(e) => {
            println!("trp_pay: auto_convert failed (credits kept): {e}");
            record_pending(failed_pending(
                user,
                tok,
                token_amount,
                pack_index,
                icp_e8s,
                credits,
                e.clone(),
            ));
            if let Err(refund_err) =
                refund_token_to_user(cfg, tok.ledger, user, token_amount).await
            {
                println!("trp_pay: token refund failed: {refund_err}");
            }
        }
    }
}

fn failed_pending(
    user: Principal,
    tok: &TokenCfg,
    token_amount: u128,
    pack_index: u32,
    icp_e8s: u64,
    credits: u64,
    err: String,
) -> PendingConversion {
    PendingConversion {
        id: 0,
        user,
        token_ledger: tok.ledger,
        pool: tok.icpswap_pool,
        token_amount,
        pack_index,
        icp_e8s,
        credits,
        status: PendingStatus::Failed,
        last_error: err,
        at_ns: ic_cdk::api::time(),
    }
}

pub async fn refund_token_to_user(
    _cfg: &Config,
    token_ledger: Principal,
    user: Principal,
    amount: u128,
) -> Result<(), String> {
    let fee = token_payments::icrc1_fee(token_ledger).await?;
    if amount <= fee as u128 {
        return Err("amount too small to refund".to_string());
    }
    payment_route::route_treasury_token(token_ledger, user, amount - fee as u128, fee).await
}

pub async fn retry_pending_conversion(
    cfg: &Config,
    cc: &ConvertConfig,
    pending: &PendingConversion,
    tok: &TokenCfg,
) -> Result<(), String> {
    let _ = icpswap_convert::recover_unused_pool_balances(
        pending.pool,
        pending.token_ledger,
        cfg.icp_ledger,
    )
    .await;

    let zero_for_one = match tok.sell_zero_for_one {
        Some(v) => v,
        None => icpswap_quote::sell_zero_for_one(tok.icpswap_pool, tok.ledger).await?,
    };

    let icp_received = icpswap_convert::swap_token_to_icp(SwapToIcpParams {
        pool: tok.icpswap_pool,
        token_ledger: tok.ledger,
        icp_ledger: cfg.icp_ledger,
        token_amount: pending.token_amount,
        zero_for_one,
        slippage_bps: cc.slippage_bps,
    })
    .await?;

    let route_icp = icp_received.min(pending.icp_e8s);
    payment_route::split_purchase_icp_with_lp(
        cfg.icp_ledger,
        cfg.cmc,
        cfg.treasury,
        cfg.diffusion_canister,
        route_icp,
        pending.credits,
        cfg.cycles_slice_e8s,
        cc.liquidity_share_bps,
        cc.liquidity_add_enabled,
        cc.trp_liquidity_pool,
    )
    .await;
    Ok(())
}
