use candid::{CandidType, Deserialize, Principal};

#[derive(CandidType, Deserialize)]
enum JobResult {
    #[serde(rename = "ok")]
    Ok(u64),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
enum MeterResult {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "err")]
    Err(String),
}

pub async fn begin_job(meter: Principal, owner: Principal, tier: &str) -> Result<u64, String> {
    let (res,): (JobResult,) = ic_cdk::call(meter, "begin_job", (owner, tier.to_string()))
        .await
        .map_err(|e| format!("meter begin_job: {e:?}"))?;
    match res {
        JobResult::Ok(id) => Ok(id),
        JobResult::Err(e) => Err(e),
    }
}

pub async fn settle_job(meter: Principal, job_id: u64) -> Result<(), String> {
    let (res,): (MeterResult,) = ic_cdk::call(meter, "settle_job", (job_id,))
        .await
        .map_err(|e| format!("meter settle_job: {e:?}"))?;
    match res {
        MeterResult::Ok => Ok(()),
        MeterResult::Err(e) => Err(e),
    }
}

pub async fn release_job(meter: Principal, job_id: u64) -> Result<(), String> {
    let (res,): (MeterResult,) = ic_cdk::call(meter, "release_job", (job_id,))
        .await
        .map_err(|e| format!("meter release_job: {e:?}"))?;
    match res {
        MeterResult::Ok => Ok(()),
        MeterResult::Err(e) => Err(e),
    }
}
