use candid::{CandidType, Deserialize};
use ic_cdk::api::performance_counter;
use ic_cdk::api::time;
use ic_cdk_macros::{init, query, update};
use serde_bytes::ByteBuf;
use std::cell::RefCell;

const SD_CPP_COMMIT: &str = "a77d3623180b2bc1886f3dd04c0aa04156a987ef";
const WASM_BLOCKER: &str = "C2: stable-diffusion.cpp not linked — icpp/WASI build blocked (see pathc/BUILD-NOTES.md)";

#[derive(CandidType, Deserialize, Clone)]
pub enum BuildPhase {
    #[serde(rename = "c1_toolchain")]
    C1Toolchain,
    #[serde(rename = "c2_wasm_blocked")]
    C2WasmBlocked,
    #[serde(rename = "c3_model_ready")]
    C3ModelReady,
    #[serde(rename = "c4_inference_pending")]
    C4InferencePending,
    #[serde(rename = "c5_ready")]
    C5Ready,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct StageTiming {
    pub stage: String,
    pub instructions: u64,
    pub update_calls: u32,
    pub wall_ms: u64,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct Status {
    pub phase: BuildPhase,
    pub message: String,
    pub sd_cpp_commit: String,
    pub model_sha256: Option<String>,
    pub wasm_linked: bool,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct BeginArgs {
    pub prompt: String,
    pub seed: u64,
    pub steps: u32,
    pub height: u32,
    pub width: u32,
}

#[derive(CandidType, Deserialize, Clone)]
pub enum BeginResult {
    #[serde(rename = "ok")]
    Ok(u64),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize, Clone)]
pub struct StepOk {
    pub step_index: u32,
    pub instructions: u64,
    pub wall_ms: u64,
}

#[derive(CandidType, Deserialize, Clone)]
pub enum StepResult {
    #[serde(rename = "ok")]
    Ok(StepOk),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize, Clone)]
pub struct FinishOk {
    pub png_sha256: String,
    pub bytes_len: u64,
    pub timings: Vec<StageTiming>,
}

#[derive(CandidType, Deserialize, Clone)]
pub enum FinishResult {
    #[serde(rename = "ok")]
    Ok(FinishOk),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize, Clone)]
pub enum UploadResult {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "err")]
    Err(String),
}

thread_local! {
    static WEIGHTS: RefCell<Vec<u8>> = RefCell::new(Vec::new());
    static TIMINGS: RefCell<Vec<StageTiming>> = RefCell::new(Vec::new());
    static SESSION: RefCell<Option<BeginArgs>> = RefCell::new(None);
}

fn counter_instructions() -> u64 {
    performance_counter(0)
}

fn now_ms() -> u64 {
    time() / 1_000_000
}

#[init]
fn init() {
    ic_cdk::println!("diffusion_canister init: {}", WASM_BLOCKER);
}

#[query]
fn status() -> Status {
    Status {
        phase: BuildPhase::C2WasmBlocked,
        message: WASM_BLOCKER.to_string(),
        sd_cpp_commit: SD_CPP_COMMIT.to_string(),
        model_sha256: Some(
            "d50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580".to_string(),
        ),
        wasm_linked: false,
    }
}

#[update]
fn upload_weights_chunk(offset: u64, chunk: ByteBuf) -> UploadResult {
    let start = counter_instructions();
    let t0 = now_ms();
    let data = chunk.into_vec();
    WEIGHTS.with(|w| {
        let mut buf = w.borrow_mut();
        let end = offset as usize + data.len();
        if end > buf.len() {
            buf.resize(end, 0);
        }
        buf[offset as usize..end].copy_from_slice(&data);
    });
    let instr = counter_instructions().saturating_sub(start);
    TIMINGS.with(|t| {
        t.borrow_mut().push(StageTiming {
            stage: "upload_chunk".to_string(),
            instructions: instr,
            update_calls: 1,
            wall_ms: now_ms().saturating_sub(t0),
        });
    });
    UploadResult::Ok
}

#[query]
fn weights_bytes_loaded() -> u64 {
    WEIGHTS.with(|w| w.borrow().len() as u64)
}

#[update]
fn begin(args: BeginArgs) -> BeginResult {
    let _ = (args.prompt.as_str(), args.seed, args.steps);
    SESSION.with(|s| *s.borrow_mut() = Some(args));
    BeginResult::Err(WASM_BLOCKER.to_string())
}

#[update]
fn step(step_index: u32) -> StepResult {
    let _ = step_index;
    StepResult::Err(WASM_BLOCKER.to_string())
}

#[update]
fn finish() -> FinishResult {
    FinishResult::Err(WASM_BLOCKER.to_string())
}

#[query]
fn last_timings() -> Vec<StageTiming> {
    TIMINGS.with(|t| t.borrow().clone())
}

ic_cdk::export_candid!();
