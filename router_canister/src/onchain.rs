use candid::{CandidType, Deserialize, Principal};
use serde::Deserialize as SerdeDeserialize;

#[derive(CandidType, Deserialize)]
struct InputRecord {
    args: Vec<String>,
}

#[derive(CandidType, Deserialize)]
struct RunOutputRecord {
    status_code: u16,
    output: String,
    conversation: String,
    error: String,
    prompt_remaining: String,
    generated_eog: bool,
    n_prompt_tokens: Option<u64>,
    n_prompt_tokens_cached: Option<u64>,
    n_prompt_tokens_decoded: Option<u64>,
    n_tokens_generated: Option<u64>,
    n_prompt_tokens_remaining: Option<u64>,
    partial: Option<bool>,
}

#[derive(CandidType, Deserialize)]
enum OutputRecordResult {
    Ok(RunOutputRecord),
    Err(RunOutputRecord),
}

const BASE_ARGS: &[&str] = &[
    "--prompt-cache",
    "prompt.cache",
    "--prompt-cache-all",
    "--cache-type-k",
    "q8_0",
    "--repeat-penalty",
    "1.1",
    "--temp",
    "0.6",
    "-sp",
];

fn qwen_prompt(user: &str) -> String {
    format!(
        "<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        user.trim()
    )
}

async fn run_update(llama: Principal, args: Vec<String>) -> Result<RunOutputRecord, String> {
    let (res,): (OutputRecordResult,) = ic_cdk::call(llama, "run_update", (InputRecord { args },))
        .await
        .map_err(|e| format!("run_update call: {e:?}"))?;
    match res {
        OutputRecordResult::Ok(r) => {
            if r.status_code >= 400 {
                return Err(format!("run_update status {}: {}", r.status_code, r.error));
            }
            Ok(r)
        }
        OutputRecordResult::Err(r) => Err(r.error),
    }
}

pub async fn complete_qwen(llama: Principal, user_message: &str) -> Result<(String, u32), String> {
    let (new_chat_res,): (OutputRecordResult,) = ic_cdk::call(
        llama,
        "new_chat",
        (InputRecord {
            args: vec![
                "--prompt-cache".into(),
                "prompt.cache".into(),
                "--cache-type-k".into(),
                "q8_0".into(),
            ],
        },),
    )
    .await
    .map_err(|e| format!("new_chat: {e:?}"))?;
    if let OutputRecordResult::Err(r) = new_chat_res {
        return Err(format!("new_chat: {}", r.error));
    }

    let mut calls = 0u32;
    let mut output = String::new();
    let mut ingest = qwen_prompt(user_message);

    while !ingest.is_empty() {
        calls += 1;
        let mut args: Vec<String> = BASE_ARGS.iter().map(|s| s.to_string()).collect();
        args.push("-p".into());
        args.push(ingest.clone());
        args.push("-n".into());
        args.push("1".into());
        let r = run_update(llama, args).await?;
        ingest = r.prompt_remaining;
        output.push_str(&r.output);
        if calls > 64 {
            return Err("prompt ingest exceeded call budget".into());
        }
    }

    loop {
        calls += 1;
        let mut args: Vec<String> = BASE_ARGS.iter().map(|s| s.to_string()).collect();
        args.push("-p".into());
        args.push(String::new());
        args.push("-n".into());
        args.push("512".into());
        let r = run_update(llama, args).await?;
        output.push_str(&r.output);
        if r.generated_eog {
            break;
        }
        if calls > 96 {
            break;
        }
    }

    let _ = ic_cdk::call::<_, (OutputRecordResult,)>(
        llama,
        "remove_prompt_cache",
        (InputRecord {
            args: vec!["--prompt-cache".into(), "prompt.cache".into()],
        },),
    )
    .await;

    Ok((output.trim().to_string(), calls))
}

pub fn map_model(model: &str) -> Option<&'static str> {
    match model {
        "trp/onchain-qwen-0.5b" => Some("qwen25"),
        _ if model.starts_with("trp/onchain-") => None,
        _ => None,
    }
}

#[derive(SerdeDeserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

pub fn last_user_message(messages: &[ChatMsg]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|m| m.role.eq_ignore_ascii_case("user"))
        .map(|m| m.content.clone())
}
