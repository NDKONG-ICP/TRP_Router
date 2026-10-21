mod blob_client;
mod image_providers;
mod moderation;
mod onchain;
mod payments;

use candid::{CandidType, Deserialize, Principal};
use ic_cdk::{api::time, caller, query, update};
use payments::PAYMENTS_ENABLED;
use serde::Deserialize as SerdeDeserialize;
use std::cell::RefCell;

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HeaderField(pub String, pub String);

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderField>,
    pub body: Vec<u8>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HttpResponse {
    pub status_code: u16,
    pub headers: Vec<HeaderField>,
    pub body: Vec<u8>,
    pub streaming_strategy: Option<()>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ProviderHealth {
    pub name: String,
    pub healthy: bool,
    pub last_error: Option<String>,
    pub circuit_open: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct RouterStatus {
    pub providers: Vec<ProviderHealth>,
    pub payments_enabled: bool,
    pub onchain_models_ready: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum QuoteResult {
    ok(Nat),
    err(String),
}

use candid::Nat;

thread_local! {
    static BLOB_STORE: RefCell<Option<Principal>> = RefCell::new(None);
    static LLAMA_QWEN25: RefCell<Option<Principal>> = RefCell::new(None);
    static CF_ACCT: RefCell<Option<String>> = RefCell::new(None);
    static CF_TOKEN: RefCell<Option<String>> = RefCell::new(None);
    static GEMINI_KEY: RefCell<Option<String>> = RefCell::new(None);
    static PROVIDER_ERRORS: RefCell<Vec<(String, String)>> = RefCell::new(Vec::new());
}

fn json_response(status: u16, body: &str) -> HttpResponse {
    HttpResponse {
        status_code: status,
        headers: vec![HeaderField(
            "Content-Type".into(),
            "application/json".into(),
        )],
        body: body.as_bytes().to_vec(),
        streaming_strategy: None,
    }
}

fn path_of(url: &str) -> &str {
    url.split('?').next().unwrap_or(url)
}

#[derive(SerdeDeserialize)]
struct ImageGenBody {
    prompt: String,
    model: Option<String>,
    size: Option<String>,
}

#[derive(SerdeDeserialize)]
struct ChatBody {
    model: String,
    messages: Vec<ChatMsg>,
}

#[derive(SerdeDeserialize)]
struct ChatMsg {
    role: String,
    content: String,
}

#[update]
fn init_router(blob_store: Principal) {
    BLOB_STORE.with(|b| *b.borrow_mut() = Some(blob_store));
}

#[update]
fn set_llama_qwen25(llama: Principal) {
    LLAMA_QWEN25.with(|l| *l.borrow_mut() = Some(llama));
}

#[update]
fn set_http_transform(_transform: Principal) {
    // Legacy no-op: transform is implemented on this canister as `transform` query.
}

#[query]
fn transform(raw: ic_cdk::api::management_canister::http_request::TransformArgs) -> ic_cdk::api::management_canister::http_request::HttpResponse {
    ic_cdk::api::management_canister::http_request::HttpResponse {
        status: raw.response.status,
        body: raw.response.body,
        headers: vec![],
    }
}

#[update]
fn set_provider_keys(cf_acct: Option<String>, cf_token: Option<String>, gemini: Option<String>) {
    // Local vault: admin-only; never log values.
    CF_ACCT.with(|a| *a.borrow_mut() = cf_acct);
    CF_TOKEN.with(|t| *t.borrow_mut() = cf_token);
    GEMINI_KEY.with(|g| *g.borrow_mut() = gemini);
}

#[query]
fn router_status() -> RouterStatus {
    let errs = PROVIDER_ERRORS.with(|e| e.borrow().clone());
    let mk = |name: &str| {
        let last = errs.iter().find(|(n, _)| n == name).map(|(_, m)| m.clone());
        ProviderHealth {
            name: name.into(),
            healthy: last.is_none(),
            last_error: last,
            circuit_open: false,
        }
    };
    RouterStatus {
        providers: vec![
            mk("cloudflare-flux-schnell"),
            mk("gemini-2.5-flash-image"),
            mk("pollinations-flux"),
        ],
        payments_enabled: PAYMENTS_ENABLED,
        onchain_models_ready: LLAMA_QWEN25.with(|l| l.borrow().is_some()),
    }
}

#[query]
fn pay_with_mock_trp_quote(amount_e8: Nat) -> QuoteResult {
    if !PAYMENTS_ENABLED {
        return QuoteResult::err("PAYMENTS_ENABLED=false (staged)".into());
    }
    let amount = u128::try_from(amount_e8.0).unwrap_or(0);
    match payments::quote_mock_trp_credits(amount) {
        Ok(c) => QuoteResult::ok(Nat::from(c)),
        Err(e) => QuoteResult::err(e),
    }
}

/// Local-only payment logic exercise (oracle + quote math); does not enable production payments.
#[update]
fn dev_exercise_m5_oracle(trp_usd_micro: candid::Nat, amount_e8: Nat) -> QuoteResult {
    let trp_usd_micro = u64::try_from(trp_usd_micro.0).unwrap_or(0);
    payments::refresh_oracle(trp_usd_micro);
    let amount = u128::try_from(amount_e8.0).unwrap_or(0);
    match payments::quote_mock_trp_credits(amount) {
        Ok(c) => QuoteResult::ok(Nat::from(c)),
        Err(e) => QuoteResult::err(e),
    }
}

#[update]
fn dev_exercise_m5_stale_oracle(amount_e8: Nat) -> QuoteResult {
    let amount = u128::try_from(amount_e8.0).unwrap_or(0);
    QuoteResult::err(
        payments::quote_mock_trp_credits(amount)
            .err()
            .unwrap_or_else(|| "unexpected ok".into()),
    )
}

#[update]
fn dev_exercise_m6_stake(amount_e8: Nat) -> Nat {
    let p = caller();
    let amt = u128::try_from(amount_e8.0).unwrap_or(0);
    let credits = payments::stake_accrue(p, amt);
    payments::grant_stake_credits(p, credits);
    Nat::from(payments::caller_credits(p))
}

#[update]
fn dev_exercise_m6_byok(enable: bool) -> Nat {
    payments::set_byok(caller(), enable);
    Nat::from(if payments::byok_active(caller()) {
        0u64
    } else {
        100u64
    })
}

#[update]
fn dev_exercise_m6_holder(daily: u32) -> bool {
    payments::register_mock_holder(caller(), daily);
    payments::consume_holder_free(caller())
}

#[query]
fn credit_balance() -> Nat {
    Nat::from(payments::caller_credits(caller()))
}

async fn handle_images_generations(body: &[u8]) -> HttpResponse {
    let parsed: ImageGenBody = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(e) => return json_response(400, &format!(r#"{{"error":"invalid json: {e}"}}"#)),
    };
    if let Err(e) = moderation::check_prompt(caller(), &parsed.prompt) {
        return json_response(400, &format!(r#"{{"error":"{e}"}}"#));
    }
    let enhanced = moderation::maybe_enhance_prompt(&parsed.prompt).await;
    let keys = image_providers::ProviderKeys {
        cf_acct: CF_ACCT.with(|a| a.borrow().clone()),
        cf_token: CF_TOKEN.with(|t| t.borrow().clone()),
        gemini: GEMINI_KEY.with(|g| g.borrow().clone()),
    };
    let gen = image_providers::generate_with_failover(&enhanced, &keys).await;
    let (bytes, provider) = match gen {
        Ok(v) => v,
        Err(e) => {
            return json_response(503, &format!(r#"{{"error":"{e}"}}"#));
        }
    };
    let blob_store = BLOB_STORE.with(|b| b.borrow().clone());
    let Some(blob_store) = blob_store else {
        return json_response(500, r#"{"error":"blob_store not configured"}"#.into());
    };
    let blob_id = match blob_client::store_image(blob_store, bytes).await {
        Ok(id) => id,
        Err(e) => return json_response(500, &format!(r#"{{"error":"{e}"}}"#)),
    };
    let router_id = ic_cdk::id();
    let url = format!(
        "http://{}.localhost:8000/blob/{}",
        router_id.to_text(),
        blob_id
    );
    let body = format!(
        r#"{{"created":{},"data":[{{"url":"/blob/{blob_id}","revised_prompt":null}}],"provider":"{provider}","router_url":"{url}"}}"#,
        time()
    );
    json_response(200, &body)
}

async fn handle_chat(body: &[u8]) -> HttpResponse {
    let parsed: ChatBody = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(e) => return json_response(400, &format!(r#"{{"error":"{e}"}}"#)),
    };
    if parsed.model.starts_with("trp/onchain-") {
        if onchain::map_model(&parsed.model) != Some("qwen25") {
            return json_response(
                503,
                r#"{"error":"on-chain model not loaded locally (only trp/onchain-qwen-0.5b is wired)"}"#,
            );
        }
        let Some(llama) = LLAMA_QWEN25.with(|l| l.borrow().clone()) else {
            return json_response(
                503,
                r#"{"error":"llama_cpp_qwen25 canister not configured (call set_llama_qwen25)"}"#,
            );
        };
        let msgs: Vec<onchain::ChatMsg> = parsed
            .messages
            .into_iter()
            .map(|m| onchain::ChatMsg {
                role: m.role,
                content: m.content,
            })
            .collect();
        let Some(user) = onchain::last_user_message(&msgs) else {
            return json_response(400, r#"{"error":"messages must include a user turn"}"#);
        };
        let (text, calls) = match onchain::complete_qwen(llama, &user).await {
            Ok(v) => v,
            Err(e) => return json_response(502, &format!(r#"{{"error":"{e}"}}"#)),
        };
        if text.is_empty() {
            return json_response(502, r#"{"error":"empty on-chain completion"}"#);
        }
        return sse_chat_response(&parsed.model, &text, calls);
    }
    let _ = parsed.messages;
    json_response(
        501,
        r#"{"error":"off-chain chat outcalls staged for R2; use trp/onchain-* after onicai build"}"#,
    )
}

fn sse_chat_response(model: &str, content: &str, update_calls: u32) -> HttpResponse {
    let escaped: String = content
        .chars()
        .flat_map(|c| match c {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\n' => "\\n".chars().collect::<Vec<_>>(),
            '\r' => "\\r".chars().collect::<Vec<_>>(),
            other => vec![other],
        })
        .collect();
    let chunk = format!(
        r#"data: {{"id":"trp-onchain","object":"chat.completion.chunk","model":"{model}","choices":[{{"index":0,"delta":{{"content":"{escaped}"}},"finish_reason":null}}],"on_chain_update_calls":{update_calls}}}"#,
    );
    let body = format!("{chunk}\n\ndata: [DONE]\n\n");
    HttpResponse {
        status_code: 200,
        headers: vec![
            HeaderField("Content-Type".into(), "text/event-stream".into()),
            HeaderField("Cache-Control".into(), "no-cache".into()),
            HeaderField("X-TRP-On-Chain".into(), "true".into()),
        ],
        body: body.into_bytes(),
        streaming_strategy: None,
    }
}

fn handle_models() -> HttpResponse {
    let body = r#"{"data":[
      {"id":"trp/image-standard","object":"model","owned_by":"trp-router"},
      {"id":"trp/image-identity","object":"model","owned_by":"trp-router"},
      {"id":"trp/onchain-qwen-0.5b","object":"model","owned_by":"trp-router","on_chain":true},
      {"id":"trp/onchain-llama-3.2-1b","object":"model","owned_by":"trp-router","on_chain":true}
    ]}"#;
    json_response(200, body)
}

fn handle_status() -> HttpResponse {
    let st = router_status();
    let prov: Vec<String> = st
        .providers
        .iter()
        .map(|p| {
            format!(
                r#"{{"name":"{}","healthy":{},"circuit_open":{}}}"#,
                p.name, p.healthy, p.circuit_open
            )
        })
        .collect();
    let body = format!(
        r#"{{"providers":[{}],"payments_enabled":{},"onchain_models_ready":{}}}"#,
        prov.join(","),
        st.payments_enabled,
        st.onchain_models_ready
    );
    json_response(200, &body)
}

#[update]
async fn http_request_update(req: HttpRequest) -> HttpResponse {
    let path = path_of(&req.url);
    if req.method.eq_ignore_ascii_case("POST") {
        match path {
            "/v1/images/generations" => return handle_images_generations(&req.body).await,
            "/v1/images/edits" => {
                return json_response(
                    501,
                    r#"{"error":"edits: use Gemini path via worker or add multipart parser (M2 follow-up)"}"#,
                )
            }
            "/v1/chat/completions" => return handle_chat(&req.body).await,
            _ => {}
        }
    }
    json_response(404, r#"{"error":"not found"}"#)
}

#[query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = path_of(&req.url);
    match path {
        "/v1/models" => handle_models(),
        "/v1/status" => handle_status(),
        p if p.starts_with("/blob/") => HttpResponse {
            status_code: 307,
            headers: vec![HeaderField(
                "Location".into(),
                format!(
                    "/blob/{}",
                    p.trim_start_matches("/blob/")
                ),
            )],
            body: vec![],
            streaming_strategy: None,
        },
        _ => json_response(404, r#"{"error":"not found"}"#),
    }
}

ic_cdk::export_candid!();
