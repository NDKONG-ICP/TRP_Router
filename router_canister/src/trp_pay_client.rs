use candid::{CandidType, Deserialize, Principal};

#[derive(CandidType, Deserialize, Debug)]
enum NatResult {
    Ok(u64),
    Err(String),
}

pub async fn credit_balance(pay: Principal, user: Principal) -> u64 {
    let (bal,): (u64,) = ic_cdk::call(pay, "credit_balance", (user,))
        .await
        .unwrap_or((0,));
    bal
}

pub async fn consume_credit(pay: Principal, user: Principal) -> Result<u64, String> {
    let (res,): (NatResult,) = ic_cdk::call(pay, "consume_credit", (user,))
        .await
        .map_err(|e| format!("trp_pay consume_credit: {e:?}"))?;
    match res {
        NatResult::Ok(b) => Ok(b),
        NatResult::Err(e) => Err(e),
    }
}
