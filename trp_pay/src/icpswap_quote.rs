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

#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct PoolMetadata {
    pub token0: TokenInfo,
    pub token1: TokenInfo,
    pub fee: Nat,
}

#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct TokenInfo {
    pub address: String,
    pub standard: String,
}

#[derive(CandidType, Deserialize, Debug)]
enum MetaResult {
    ok(PoolMetadata),
    err(PoolError),
}

/// Infer `zeroForOne` when selling `token_ledger` for ICP on this pool.
pub async fn sell_zero_for_one(pool: Principal, token_ledger: Principal) -> Result<bool, String> {
    let meta = pool_metadata(pool).await?;
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

pub async fn pool_metadata(pool: Principal) -> Result<PoolMetadata, String> {
    let (res,): (MetaResult,) = ic_cdk::call(pool, "metadata", ())
        .await
        .map_err(|e| format!("pool metadata: {e:?}"))?;
    match res {
        MetaResult::ok(m) => Ok(m),
        MetaResult::err(e) => Err(format!("pool metadata err: {e:?}")),
    }
}

pub async fn pool_quote(
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

fn ceil_div(a: u128, b: u128) -> u128 {
    if b == 0 {
        return 0;
    }
    (a + (b - 1)) / b
}

/// Token amount (base units) to pay so that selling it on the pool yields at least `icp_e8s` ICP out.
///
/// Rate-based inversion: a bounded exponential probe finds one `(amount, out)` point at or above
/// the target, then we invert linearly and refine. This replaces the old per-bit binary search,
/// which issued ~40 sequential inter-canister pool calls (~2.5 min per quote) and got slower the
/// larger the token's base-unit magnitude (worst for 18-decimal ckETH). This version is
/// magnitude-independent: ~3–5 pool calls for any token (ckBTC/ckETH/ckUSDC alike). The result is
/// always verified to yield at least `target` ICP out, so it never under-prices a pack.
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

    // 1) Bounded exponential probe: grow the input x256 until the pool returns at least `target`
    //    ICP out (or we exhaust a sane ceiling). Few steps even for 18-decimal tokens.
    let mut probe: u128 = 1;
    let mut out: u128 = pool_quote(pool, probe, zero_for_one).await.unwrap_or(0);
    let mut steps = 0;
    while out < target {
        if probe > u128::MAX / 256 || steps >= 14 {
            return Err("pool liquidity too low for pack price".to_string());
        }
        probe = probe.saturating_mul(256);
        out = pool_quote(pool, probe, zero_for_one).await?;
        steps += 1;
    }
    if out == 0 {
        return Err("pool returned zero out for probe".to_string());
    }

    // 2) Linear inversion from the probe rate: est ~= probe * target / out (round up).
    let mut est = ceil_div(probe.saturating_mul(target), out).max(1);

    // 3) Refine: re-quote at the estimate; if it under-delivers (price impact / rounding), scale up
    //    by the shortfall ratio and re-quote. At most a few corrections, each guaranteed to grow est.
    let mut got = pool_quote(pool, est, zero_for_one).await?;
    let mut tries = 0;
    while got < target {
        if tries >= 4 {
            return Err("could not converge quote to pack price".to_string());
        }
        est = ceil_div(est.saturating_mul(target), got.max(1)).saturating_add(1);
        got = pool_quote(pool, est, zero_for_one).await?;
        tries += 1;
    }
    Ok(est)
}

/// Fixed-rate stub for local replica when pool is unset (admin `stub_token_base_per_icp_e8`).
pub fn stub_token_amount(stub_base_per_icp_e8: u64, icp_e8s: u64) -> u128 {
    let v = (stub_base_per_icp_e8 as u128).saturating_mul(icp_e8s as u128) / 100_000_000u128;
    v.max(1)
}
