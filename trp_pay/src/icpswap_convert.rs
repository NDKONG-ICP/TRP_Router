//! ICPSwap V3: token → ICP via depositFrom → swap → withdraw (ICRC-2 tokens on trp_pay).

use candid::{CandidType, Deserialize, Nat, Principal};
use ic_cdk::println;

use crate::icpswap_quote;
use crate::Account;

#[derive(CandidType, Deserialize, Debug)]
struct DepositArgs {
    fee: Nat,
    token: String,
    amount: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
struct SwapArgs {
    amountIn: String,
    zeroForOne: bool,
    amountOutMinimum: String,
}

#[derive(CandidType, Deserialize, Debug)]
struct WithdrawArgs {
    fee: Nat,
    token: String,
    amount: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
enum PoolError {
    CommonError,
    InsufficientFunds,
    InternalError(String),
    UnsupportedToken(String),
}

#[derive(CandidType, Deserialize, Debug)]
enum PoolResult {
    ok(Nat),
    err(PoolError),
}

#[derive(CandidType, Deserialize, Debug)]
struct UnusedBalance {
    balance0: Nat,
    balance1: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
enum UnusedResult {
    ok(UnusedBalance),
    err(PoolError),
}

#[derive(CandidType, Deserialize)]
struct ApproveArgs {
    from_subaccount: Option<Vec<u8>>,
    spender: Account,
    amount: Nat,
    expires_at: Option<u64>,
    fee: Option<Nat>,
    memo: Option<Vec<u8>>,
    created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
enum ApproveError {
    BadFee { expected_fee: Nat },
    InsufficientFunds { balance: Nat },
    GenericError { error_code: Nat, message: String },
}

#[derive(CandidType, Deserialize, Debug)]
enum ApproveResult {
    Ok(Nat),
    Err(ApproveError),
}

pub struct SwapToIcpParams {
    pub pool: Principal,
    pub token_ledger: Principal,
    pub icp_ledger: Principal,
    pub token_amount: u128,
    pub zero_for_one: bool,
    pub slippage_bps: u32,
}

async fn icrc1_fee(ledger: Principal) -> Result<u64, String> {
    let (fee,): (Nat,) = ic_cdk::call(ledger, "icrc1_fee", ())
        .await
        .map_err(|e| format!("icrc1_fee: {e:?}"))?;
    fee.0.try_into().map_err(|_| "fee overflow".to_string())
}

async fn icrc2_approve_spender(
    ledger: Principal,
    spender: Principal,
    amount: u128,
) -> Result<(), String> {
    let fee = icrc1_fee(ledger).await?;
    let args = ApproveArgs {
        from_subaccount: None,
        spender: Account {
            owner: spender,
            subaccount: None,
        },
        amount: Nat::from(amount.saturating_add(fee as u128)),
        expires_at: None,
        fee: None,
        memo: None,
        created_at_time: None,
    };
    let (res,): (ApproveResult,) = ic_cdk::call(ledger, "icrc2_approve", (args,))
        .await
        .map_err(|e| format!("icrc2_approve: {e:?}"))?;
    match res {
        ApproveResult::Ok(_) => Ok(()),
        ApproveResult::Err(e) => Err(format!("approve rejected: {e:?}")),
    }
}

async fn pool_deposit_from(
    pool: Principal,
    token: Principal,
    amount: u128,
    fee: u64,
) -> Result<(), String> {
    let args = DepositArgs {
        fee: Nat::from(fee),
        token: token.to_text(),
        amount: Nat::from(amount),
    };
    let (res,): (PoolResult,) = ic_cdk::call(pool, "depositFrom", (args,))
        .await
        .map_err(|e| format!("depositFrom: {e:?}"))?;
    match res {
        PoolResult::ok(_) => Ok(()),
        PoolResult::err(e) => Err(format!("depositFrom err: {e:?}")),
    }
}

async fn pool_quote_out(
    pool: Principal,
    amount_in: u128,
    zero_for_one: bool,
) -> Result<u128, String> {
    icpswap_quote::pool_quote(pool, amount_in, zero_for_one).await
}

async fn pool_swap(
    pool: Principal,
    amount_in: u128,
    zero_for_one: bool,
    min_out: u128,
) -> Result<u128, String> {
    let args = SwapArgs {
        amountIn: amount_in.to_string(),
        zeroForOne: zero_for_one,
        amountOutMinimum: min_out.to_string(),
    };
    let (res,): (PoolResult,) = ic_cdk::call(pool, "swap", (args,))
        .await
        .map_err(|e| format!("swap: {e:?}"))?;
    match res {
        PoolResult::ok(n) => {
            let v: u128 = n.0.try_into().map_err(|_| "swap out overflow".to_string())?;
            Ok(v)
        }
        PoolResult::err(e) => Err(format!("swap err: {e:?}")),
    }
}

async fn pool_withdraw(
    pool: Principal,
    token: Principal,
    amount: u128,
    fee: u64,
) -> Result<(), String> {
    let args = WithdrawArgs {
        fee: Nat::from(fee),
        token: token.to_text(),
        amount: Nat::from(amount),
    };
    let (res,): (PoolResult,) = ic_cdk::call(pool, "withdraw", (args,))
        .await
        .map_err(|e| format!("withdraw: {e:?}"))?;
    match res {
        PoolResult::ok(_) => Ok(()),
        PoolResult::err(e) => Err(format!("withdraw err: {e:?}")),
    }
}

/// Best-effort: pull token / ICP stuck in pool internal balance back to this canister's ledger accounts.
pub async fn recover_unused_pool_balances(
    pool: Principal,
    token_ledger: Principal,
    icp_ledger: Principal,
) -> Result<(), String> {
    let self_id = ic_cdk::id();
    let (res,): (UnusedResult,) = ic_cdk::call(pool, "getUserUnusedBalance", (self_id,))
        .await
        .map_err(|e| format!("getUserUnusedBalance: {e:?}"))?;
    let bal = match res {
        UnusedResult::ok(b) => b,
        UnusedResult::err(e) => return Err(format!("unused balance err: {e:?}")),
    };
    let meta = icpswap_quote::pool_metadata(pool).await?;
    let token0 = Principal::from_text(&meta.token0.address).map_err(|e| format!("token0: {e}"))?;
    let token1 = Principal::from_text(&meta.token1.address).map_err(|e| format!("token1: {e}"))?;

    let b0: u128 = bal.balance0.0.try_into().unwrap_or(0);
    let b1: u128 = bal.balance1.0.try_into().unwrap_or(0);

    if b0 > 0 {
        let ledger = if token0 == token_ledger {
            token_ledger
        } else if token0 == icp_ledger {
            icp_ledger
        } else {
            token0
        };
        let fee = icrc1_fee(ledger).await?;
        if b0 > fee as u128 {
            let _ = pool_withdraw(pool, ledger, b0, fee).await;
        }
    }
    if b1 > 0 {
        let ledger = if token1 == token_ledger {
            token_ledger
        } else if token1 == icp_ledger {
            icp_ledger
        } else {
            token1
        };
        let fee = icrc1_fee(ledger).await?;
        if b1 > fee as u128 {
            let _ = pool_withdraw(pool, ledger, b1, fee).await;
        }
    }
    Ok(())
}

/// Swap tokens already held by trp_pay into ICP on trp_pay's ICP account.
pub async fn swap_token_to_icp(p: SwapToIcpParams) -> Result<u64, String> {
    if p.token_amount == 0 {
        return Err("zero token amount".to_string());
    }
    let token_fee = icrc1_fee(p.token_ledger).await?;
    let icp_fee = icrc1_fee(p.icp_ledger).await?;

    println!(
        "trp_pay: swap start pool={} token={} amount={} zfo={}",
        p.pool, p.token_ledger, p.token_amount, p.zero_for_one
    );

    icrc2_approve_spender(p.token_ledger, p.pool, p.token_amount)
        .await
        .map_err(|e| format!("pool approve: {e}"))?;

    if let Err(e) = pool_deposit_from(p.pool, p.token_ledger, p.token_amount, token_fee).await {
        let _ = recover_unused_pool_balances(p.pool, p.token_ledger, p.icp_ledger).await;
        return Err(e);
    }

    let quoted_out = pool_quote_out(p.pool, p.token_amount, p.zero_for_one)
        .await
        .map_err(|e| format!("pre-swap quote: {e}"))?;
    let slip = p.slippage_bps.min(5000) as u128;
    let min_out = quoted_out.saturating_mul(10_000u128 - slip) / 10_000u128;

    let icp_out = match pool_swap(p.pool, p.token_amount, p.zero_for_one, min_out).await {
        Ok(v) => v,
        Err(e) => {
            let _ = recover_unused_pool_balances(p.pool, p.token_ledger, p.icp_ledger).await;
            return Err(e);
        }
    };

    if let Err(e) = pool_withdraw(p.pool, p.icp_ledger, icp_out, icp_fee).await {
        let _ = recover_unused_pool_balances(p.pool, p.token_ledger, p.icp_ledger).await;
        return Err(format!("withdraw ICP: {e}"));
    }

    println!("trp_pay: swap ok icp_out_e8s={icp_out}");
    icp_out.try_into().map_err(|_| "icp out exceeds u64".to_string())
}
