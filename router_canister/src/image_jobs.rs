//! Async raven-diffusion jobs for HTTP clients (avoid ~60s IC gateway timeout).

use crate::mem;
use crate::pathc_client;
use candid::Principal;
use ic_stable_structures::{StableBTreeMap, Storable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;

const MAX_LOAD_STEPS: u32 = 500;
const MAX_GEN_STEPS: u32 = 500;
const STEPS_PER_POLL: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum JobStatus {
    Queued = 0,
    Running = 1,
    Done = 2,
    Error = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
enum JobPhase {
    AwaitingBegin = 0,
    Loading = 1,
    Generating = 2,
    Finishing = 3,
}

#[derive(Clone, Serialize, Deserialize)]
struct ImageJobRecord {
    owner: Principal,
    prompt: String,
    seed: u64,
    status: JobStatus,
    phase: JobPhase,
    load_calls: u32,
    gen_calls: u32,
    diffusion: Principal,
    result_json: Option<String>,
    error: Option<String>,
    created_ns: u64,
    updated_ns: u64,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct JobKey(String);

impl Storable for JobKey {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.as_bytes().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        JobKey(String::from_utf8_lossy(bytes.as_ref()).into_owned())
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Bounded {
            max_size: 64,
            is_fixed_size: false,
        };
}

impl Storable for ImageJobRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        let mut v = serde_json::to_vec(self).unwrap_or_default();
        Cow::Owned(v)
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        serde_json::from_slice(bytes.as_ref()).unwrap_or(ImageJobRecord {
            owner: Principal::anonymous(),
            prompt: String::new(),
            seed: 0,
            status: JobStatus::Error,
            phase: JobPhase::AwaitingBegin,
            load_calls: 0,
            gen_calls: 0,
            diffusion: Principal::anonymous(),
            result_json: None,
            error: Some("corrupt job record".into()),
            created_ns: 0,
            updated_ns: 0,
        })
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static JOBS: RefCell<StableBTreeMap<JobKey, ImageJobRecord, mem::Memory>> = RefCell::new(
        StableBTreeMap::init(mem::vmem(33))
    );
    static JOB_SEQ: RefCell<u64> = RefCell::new(0);
}

fn next_job_id(now: u64, owner: Principal) -> String {
    let n = JOB_SEQ.with(|s| {
        let mut g = s.borrow_mut();
        *g += 1;
        *g
    });
    let mut h = Sha256::new();
    h.update(owner.as_slice());
    h.update(n.to_le_bytes());
    h.update(now.to_le_bytes());
    hex::encode(&h.finalize()[..12])
}

pub fn create_job(
    owner: Principal,
    prompt: String,
    seed: u64,
    diffusion: Principal,
    now: u64,
) -> String {
    let id = next_job_id(now, owner);
    let rec = ImageJobRecord {
        owner,
        prompt,
        seed,
        status: JobStatus::Queued,
        phase: JobPhase::AwaitingBegin,
        load_calls: 0,
        gen_calls: 0,
        diffusion,
        result_json: None,
        error: None,
        created_ns: now,
        updated_ns: now,
    };
    JOBS.with(|m| m.borrow_mut().insert(JobKey(id.clone()), rec));
    id
}

pub async fn advance_job_async(job_id: &str, owner: Principal, now: u64) -> Result<String, String> {
    let key = JobKey(job_id.to_string());
    let mut rec = JOBS.with(|m| m.borrow().get(&key).ok_or_else(|| "unknown job id".to_string()))?;
    if rec.owner != owner {
        return Err("job not found".into());
    }
    if rec.status == JobStatus::Done || rec.status == JobStatus::Error {
        return Ok(job_status_json(job_id, &rec, now));
    }
    rec.status = JobStatus::Running;
    if let Err(e) = advance_job(&mut rec).await {
        rec.status = JobStatus::Error;
        rec.error = Some(e);
    }
    rec.updated_ns = now;
    JOBS.with(|m| m.borrow_mut().insert(key, rec.clone()));
    Ok(job_status_json(job_id, &rec, now))
}

async fn advance_job(rec: &mut ImageJobRecord) -> Result<(), String> {
    if rec.phase == JobPhase::AwaitingBegin {
        pathc_client::diffusion_begin(rec.diffusion, &rec.prompt, rec.seed).await?;
        rec.phase = JobPhase::Loading;
    }

    if rec.phase == JobPhase::Loading {
        for _ in 0..STEPS_PER_POLL {
            rec.load_calls += 1;
            if rec.load_calls > MAX_LOAD_STEPS {
                return Err(format!("load exceeded {MAX_LOAD_STEPS} step(0) calls"));
            }
            let ok = pathc_client::diffusion_step_load(rec.diffusion).await?;
            if ok.load_done {
                rec.phase = JobPhase::Generating;
                break;
            }
        }
    }

    if rec.phase == JobPhase::Generating {
        for _ in 0..STEPS_PER_POLL {
            rec.gen_calls += 1;
            if rec.gen_calls > MAX_GEN_STEPS {
                return Err(format!("generate exceeded {MAX_GEN_STEPS} step(1) calls"));
            }
            let ok = pathc_client::diffusion_step_gen(rec.diffusion).await?;
            if ok.generate_done {
                rec.phase = JobPhase::Finishing;
                break;
            }
        }
    }

    if rec.phase == JobPhase::Finishing {
        let out = pathc_client::diffusion_finish_png(rec.diffusion).await?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&out.png);
        let created = rec.created_ns;
        let canister = out.canister.to_text();
        let body = format!(
            r#"{{"created":{created},"data":[{{"b64_json":"{b64}","canister":"{canister}","sha256":"{}","deterministic":true}}],"model":"raven-diffusion","provider":"pathc-diffusion"}}"#,
            out.sha256_hex
        );
        rec.result_json = Some(body.clone());
        rec.status = JobStatus::Done;
        rec.phase = JobPhase::Finishing;
        crate::image_quota::record_generation();
        crate::diffusion_cache::put(
            &rec.owner.to_text(),
            &rec.prompt,
            rec.seed,
            rec.updated_ns,
            body,
        );
    }

    Ok(())
}

fn job_status_json(job_id: &str, rec: &ImageJobRecord, _now: u64) -> String {
    let status = match rec.status {
        JobStatus::Queued => "queued",
        JobStatus::Running => "running",
        JobStatus::Done => "done",
        JobStatus::Error => "error",
    };
    if rec.status == JobStatus::Done {
        if let Some(ref inner) = rec.result_json {
            return format!(
                r#"{{"id":"{job_id}","object":"image.generation.result","status":"done","result":{inner}}}"#
            );
        }
    }
    if rec.status == JobStatus::Error {
        let err = rec.error.as_deref().unwrap_or("generation failed");
        return format!(
            r#"{{"id":"{job_id}","object":"image.generation.result","status":"error","error":{}}}"#,
            serde_json::json!(err)
        );
    }
    format!(
        r#"{{"id":"{job_id}","object":"image.generation.result","status":"{status}"}}"#
    )
}

pub fn queued_response(job_id: &str) -> String {
    format!(
        r#"{{"id":"{job_id}","object":"image.generation.job","status":"queued"}}"#
    )
}
