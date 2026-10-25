//! On-chain ICPSwap V3 pool quotes (SwapPool `quote` query).
//!
//! Used to price alt-token credit packs in ICP terms. See ICPSwap docs:
//! amountIn / amountOut are decimal-scaled strings; zeroForOne = token0 → token1.

use candid::{CandidType, Deserialize, Nat, Principal};
const ICP_LEDGER: &str = "ryjl3-tyaaa-aaaaa-aaaba-cai";

#[derive(CandidType, Deserialize, Debug)]
struct SwapArgs {
    amountIn: String,
    zeroForOne: bool,
    amountOutMinimum: String,
}

#[derive(CandidType, Deserialize, Debug)]
enum PoolError {
    CommonError,
    InsufficientFunds,
    InternalError(String),
    UnsupportedToken(String),
}

#[derive(CandidType, Deserialize, Debug)]
enum QuoteResult {
    ok(Nat),
    err(PoolError),
}

#[derive(CandidType, Deserialize, Debug)]
struct PoolMetadata {
    token0: TokenInfo,
    token1: TokenInfo,
    fee: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
struct TokenInfo {
    address: String,
    standard: String,
}

#[derive(CandidType, Deserialize, Debug)]
enum MetaResult {
    ok(PoolMetadata),
    err(PoolError),
}

/// Infer `zeroForOne` when selling `token_ledger` for ICP on this pool.
pub async fn sell_zero_for_one(pool: Principal, token_ledger: Principal) -> Result<bool, String> {
    let (res,): (MetaResult,) = ic_cdk::call(pool, "metadata", ())
        .await
        .map_err(|e| format!("pool metadata: {e:?}"))?;
    let meta = match res {
        MetaResult::ok(m) => m,
        MetaResult::err(e) => return Err(format!("pool metadata err: {e:?}")),
    };
    let token = token_ledger.to_text();
    let icp = ICP_LEDGER;
    if meta.token0.address == token && meta.token1.address == icp {
        Ok(true)
    } else if meta.token1.address == token && meta.token0.address == icp {
        Ok(false)
    } else {
        Err(format!(
            "pool {} is not ICP pair for token {}",
            pool, token
        ))
    }
}

async fn pool_quote(
    pool: Principal,
    amount_in: u128,
    zero_for_one: bool,
) -> Result<u128, String> {
    let args = SwapArgs {
        amountIn: amount_in.to_string(),
        zeroForOne: zero_for_one,
        amountOutMinimum: "0".to_string(),
    };
    let (res,): (QuoteResult,) = ic_cdk::call(pool, "quote", (args,))
        .await
        .map_err(|(code, msg)| format!("quote call ({code:?}): {msg}"))?;
    match res {
        QuoteResult::ok(n) => {
            let v: u128 = n.0.try_into().map_err(|_| "quote nat overflow".to_string())?;
            Ok(v)
        }
        QuoteResult::err(e) => Err(format!("quote rejected: {e:?}")),
    }
}

/// Token amount (base units) to pay so that selling it on the pool yields at least `icp_e8s` ICP out.
pub async fn token_amount_for_icp_value(
    pool: Principal,
    _token_ledger: Principal,
    icp_e8s: u64,
    zero_for_one: bool,
) -> Result<u128, String> {
    if icp_e8s == 0 {
        return Err("zero ICP pack price".to_string());
    }
    let target = icp_e8s as u128;
    // Upper bound: start at 1 ICP-equivalent in token base if unknown — use generous high search.
    let mut hi: u128 = target.saturating_mul(1_000_000).max(1_000_000);
    let mut out = pool_quote(pool, hi, zero_for_one).await.unwrap_or(0);
    while out < target && hi < u128::MAX / 2 {
        hi = hi.saturating_mul(2);
        out = pool_quote(pool, hi, zero_for_one).await?;
    }
    if out < target {
        return Err("pool liquidity too low for pack price".to_string());
    }
    let mut lo: u128 = 0;
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        let q = pool_quote(pool, mid, zero_for_one).await?;
        if q >= target {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Ok(hi)
}

/// Fixed-rate stub for local replica when pool is unset (admin `stub_token_base_per_icp_e8`).
pub fn stub_token_amount(stub_base_per_icp_e8: u64, icp_e8s: u64) -> u128 {
    let v = (stub_base_per_icp_e8 as u128).saturating_mul(icp_e8s as u128) / 100_000_000u128;
    v.max(1)
}
