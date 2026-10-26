//! Path C diffusion orchestration (mainnet canister 7chv3 — model stays loaded between sessions).
//!
//! Phase 2 (hardened): deploy a production diffusion canister with `canister_inspect_message`
//! allowlisting only this router's principal, plus prepaid credits via `trp_meter`.

use candid::{CandidType, Deserialize, Principal};
use sha2::{Digest, Sha256};

const DEFAULT_DIFFUSION: &str = "7chv3-5iaaa-aaaao-bbq3a-cai";
const MAX_LOAD_STEPS: u32 = 500;
const MAX_GEN_STEPS: u32 = 500;
const DEFAULT_WIDTH: u32 = 64;
const DEFAULT_HEIGHT: u32 = 64;
/// Mainnet 7chv3 currently stable at 1 step (multi-step traps until diffusion wasm upgrade).
const DEFAULT_STEPS: u32 = 1;

#[derive(CandidType, Deserialize)]
struct BeginArgs {
    prompt: String,
    seed: u64,
    steps: u32,
    height: u32,
    width: u32,
    debug_flags: u32,
}

#[derive(CandidType, Deserialize)]
enum BeginResult {
    #[serde(rename = "ok")]
    Ok(u64),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
pub struct StepOk {
    step_index: u32,
    instructions: u64,
    wall_ms: u64,
    pub load_done: bool,
    pub generate_done: bool,
    tensors_this_call: u32,
    tensors_loaded_total: u32,
    tensors_total: u32,
    gguf_tensors: u32,
    bytes_loaded: u64,
}

#[derive(CandidType, Deserialize)]
enum StepResult {
    #[serde(rename = "ok")]
    Ok(StepOk),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
struct FinishOk {
    png_sha256: String,
    bytes_len: u64,
}

#[derive(CandidType, Deserialize)]
enum FinishResult {
    #[serde(rename = "ok")]
    Ok(FinishOk),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
enum PngResult {
    #[serde(rename = "ok")]
    Ok(Vec<u8>),
    #[serde(rename = "err")]
    Err(String),
}

pub struct DiffusionImage {
    pub png: Vec<u8>,
    pub sha256_hex: String,
    pub canister: Principal,
}

pub fn default_diffusion_principal() -> Principal {
    Principal::from_text(DEFAULT_DIFFUSION).expect("valid diffusion canister id")
}

pub async fn diffusion_begin(diffusion: Principal, prompt: &str, seed: u64) -> Result<(), String> {
    let args = BeginArgs {
        prompt: prompt.to_string(),
        seed,
        steps: DEFAULT_STEPS,
        height: DEFAULT_HEIGHT,
        width: DEFAULT_WIDTH,
        debug_flags: 0,
    };
    let (begin_res,): (BeginResult,) = ic_cdk::call(diffusion, "begin", (args,))
        .await
        .map_err(|e| format!("begin call: {e:?}"))?;
    match begin_res {
        BeginResult::Ok(_session) => Ok(()),
        BeginResult::Err(e) => Err(e),
    }
}

pub async fn diffusion_step_load(diffusion: Principal) -> Result<StepOk, String> {
    let (st,): (StepResult,) = ic_cdk::call(diffusion, "step", (0u32,))
        .await
        .map_err(|e| format!("step(0) call: {e:?}"))?;
    match st {
        StepResult::Ok(ok) => Ok(ok),
        StepResult::Err(e) => Err(e),
    }
}

pub async fn diffusion_step_gen(diffusion: Principal) -> Result<StepOk, String> {
    let (st,): (StepResult,) = ic_cdk::call(diffusion, "step", (1u32,))
        .await
        .map_err(|e| format!("step(1) call: {e:?}"))?;
    match st {
        StepResult::Ok(ok) => Ok(ok),
        StepResult::Err(e) => Err(e),
    }
}

pub async fn diffusion_finish_png(diffusion: Principal) -> Result<DiffusionImage, String> {
    let (fin,): (FinishResult,) = ic_cdk::call(diffusion, "finish", ())
        .await
        .map_err(|e| format!("finish call: {e:?}"))?;
    match fin {
        FinishResult::Err(e) => return Err(e),
        FinishResult::Ok(_) => {}
    }

    let (png_res,): (PngResult,) = ic_cdk::call(diffusion, "get_png", ())
        .await
        .map_err(|e| format!("get_png call: {e:?}"))?;
    let png = match png_res {
        PngResult::Ok(b) => b,
        PngResult::Err(e) => return Err(e),
    };

    let computed = hex::encode(Sha256::digest(&png));
    Ok(DiffusionImage {
        png,
        sha256_hex: computed,
        canister: diffusion,
    })
}

pub async fn generate_raven_diffusion(
    diffusion: Principal,
    prompt: &str,
    seed: u64,
) -> Result<DiffusionImage, String> {
    diffusion_begin(diffusion, prompt, seed).await?;

    let mut load_calls = 0u32;
    loop {
        load_calls += 1;
        if load_calls > MAX_LOAD_STEPS {
            return Err(format!("load exceeded {MAX_LOAD_STEPS} step(0) calls"));
        }
        let ok = diffusion_step_load(diffusion).await?;
        if ok.load_done {
            break;
        }
    }

    let mut gen_calls = 0u32;
    loop {
        gen_calls += 1;
        if gen_calls > MAX_GEN_STEPS {
            return Err(format!("generate exceeded {MAX_GEN_STEPS} step(1) calls"));
        }
        let ok = diffusion_step_gen(diffusion).await?;
        if ok.generate_done {
            break;
        }
    }

    diffusion_finish_png(diffusion).await
}
