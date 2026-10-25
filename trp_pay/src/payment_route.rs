//! Route ICP held by this canister after a purchase: CMC top-up (burn) + treasury.
//!
//! `cycles_slice_e8s` is **per credit** in the pack: total burn =
//! `cycles_slice_e8s * credits_in_pack` (capped by received ICP minus fees).

use candid::{CandidType, Deserialize, Nat, Principal};
use ic_cdk::println;

use crate::Account;

pub const LEDGER_FEE_E8S: u64 = 10_000;
/// ICP ledger / CMC top-up memo (`TPUP`).
pub const MEMO_TOP_UP: u64 = 1_347_768_404;

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
pub enum TransferError {
    BadFee { expected_fee: Nat },
    InsufficientFunds { balance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { error_code: Nat, message: String },
}

#[derive(CandidType, Deserialize, Debug)]
pub enum TransferResult {
    Ok(Nat),
    Err(TransferError),
}

#[derive(CandidType, Deserialize)]
struct NotifyTopUpArg {
    canister_id: Principal,
    block_index: u64,
}

#[derive(CandidType, Deserialize, Debug)]
enum NotifyTopUpResult {
    Ok(Nat),
    Err(String),
}


/// CMC top-up subaccount: `0x0a` || canister_id bytes || zero-pad to 32 bytes.
pub fn cmc_top_up_subaccount(target_canister: &Principal) -> Vec<u8> {
    let mut sub = [0u8; 32];
    sub[0] = 0x0a;
    let bytes = target_canister.as_slice();
    let n = bytes.len().min(31);
    sub[1..1 + n].copy_from_slice(&bytes[..n]);
    sub.to_vec()
}

fn top_up_memo_blob() -> Vec<u8> {
    MEMO_TOP_UP.to_le_bytes().to_vec()
}

async fn icrc1_transfer(
    ledger: Principal,
    to: Account,
    amount_e8s: u64,
    memo: Option<Vec<u8>>,
) -> Result<Nat, String> {
    if amount_e8s == 0 {
        return Err("zero transfer amount".to_string());
    }
    let args = TransferArg {
        from_subaccount: None,
        to,
        amount: Nat::from(amount_e8s),
        fee: Some(Nat::from(LEDGER_FEE_E8S)),
        memo,
        created_at_time: None,
    };
    let (res,): (TransferResult,) = ic_cdk::call(ledger, "icrc1_transfer", (args,))
        .await
        .map_err(|e| format!("icrc1_transfer call failed: {e:?}"))?;
    match res {
        TransferResult::Ok(block) => Ok(block),
        TransferResult::Err(e) => Err(format!("icrc1_transfer rejected: {e:?}")),
    }
}

async fn notify_top_up(
    cmc: Principal,
    diffusion: Principal,
    block_index: u64,
) -> Result<(), String> {
    let arg = NotifyTopUpArg {
        canister_id: diffusion,
        block_index,
    };
    let (res,): (NotifyTopUpResult,) = ic_cdk::call(cmc, "notify_top_up", (arg,))
        .await
        .map_err(|e| format!("notify_top_up call failed: {e:?}"))?;
    match res {
        NotifyTopUpResult::Ok(_) => Ok(()),
        NotifyTopUpResult::Err(e) => Err(e),
    }
}

/// Mint cycles onto `diffusion` via CMC after sending `burn_e8s` ICP (excludes fee).
pub async fn route_cycles_burn(
    ledger: Principal,
    cmc: Principal,
    diffusion: Principal,
    burn_e8s: u64,
) -> Result<(), String> {
    if burn_e8s <= LEDGER_FEE_E8S {
        return Err("burn amount too small for ledger fee".to_string());
    }
    let to = Account {
        owner: cmc,
        subaccount: Some(cmc_top_up_subaccount(&diffusion)),
    };
    let block = icrc1_transfer(ledger, to, burn_e8s, Some(top_up_memo_blob())).await?;
    let idx = block
        .0
        .to_string()
        .parse::<u64>()
        .map_err(|_| format!("unexpected block index {block:?}"))?;
    notify_top_up(cmc, diffusion, idx).await
}

pub async fn route_treasury(
    ledger: Principal,
    treasury: Principal,
    amount_e8s: u64,
) -> Result<(), String> {
    if amount_e8s <= LEDGER_FEE_E8S {
        return Err("treasury amount too small for ledger fee".to_string());
    }
    let to = Account {
        owner: treasury,
        subaccount: None,
    };
    icrc1_transfer(ledger, to, amount_e8s, None)
        .await
        .map(|_| ())
}

/// Best-effort split after credits are granted. Logs failures; does not roll back credits.
pub async fn split_purchase_icp(
    ledger: Principal,
    cmc: Principal,
    treasury: Principal,
    diffusion: Principal,
    icp_e8s: u64,
    credits: u64,
    cycles_slice_e8s: u64,
) {
    let burn_target = cycles_slice_e8s.saturating_mul(credits);
    let max_burn = icp_e8s.saturating_sub(LEDGER_FEE_E8S.saturating_mul(2));
    let burn_e8s = burn_target.min(max_burn);
    let treasury_e8s = icp_e8s.saturating_sub(burn_e8s).saturating_sub(LEDGER_FEE_E8S);

    if burn_e8s > LEDGER_FEE_E8S {
        match route_cycles_burn(ledger, cmc, diffusion, burn_e8s).await {
            Ok(()) => println!("trp_pay: routed {burn_e8s} e8s to CMC for {diffusion}"),
            Err(e) => println!("trp_pay: cycles burn failed (credits kept): {e}"),
        }
    } else {
        println!("trp_pay: skip burn — burn_e8s={burn_e8s} icp_e8s={icp_e8s}");
    }

    if treasury_e8s > LEDGER_FEE_E8S {
        match route_treasury(ledger, treasury, treasury_e8s).await {
            Ok(()) => println!("trp_pay: sent {treasury_e8s} e8s to treasury {treasury}"),
            Err(e) => println!("trp_pay: treasury transfer failed (ICP on trp_pay): {e}"),
        }
    }
}

pub async fn sweep_icp_balance_to_treasury(ledger: Principal, treasury: Principal) -> Result<u64, String> {
    let self_acct = Account {
        owner: ic_cdk::id(),
        subaccount: None,
    };
    let (bal,): (Nat,) = ic_cdk::call(ledger, "icrc1_balance_of", (self_acct,))
        .await
        .map_err(|e| format!("balance_of: {e:?}"))?;
    let bal_u64: u64 = bal.0.try_into().unwrap_or(0);
    let send = bal_u64.saturating_sub(LEDGER_FEE_E8S);
    if send <= LEDGER_FEE_E8S {
        return Ok(0);
    }
    route_treasury(ledger, treasury, send).await?;
    Ok(send)
}
