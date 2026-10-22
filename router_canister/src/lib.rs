mod blob_client;
mod chat_providers;
mod image_providers;
mod mcp;
mod models;
mod moderation;
mod onchain;
mod payments;
mod raven_art;
mod relay_client;

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
    /// When `true`, HTTP gateway invokes `http_request_update` with the same request.
    pub upgrade: Option<bool>,
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
    static GROQ_KEY: RefCell<Option<String>> = RefCell::new(None);
    static OPENROUTER_KEY: RefCell<Option<String>> = RefCell::new(None);
    static ANTHROPIC_VAULT: RefCell<Option<String>> = RefCell::new(None);
    static PROVIDER_ERRORS: RefCell<Vec<(String, String)>> = RefCell::new(Vec::new());
    static RELAY_URL: RefCell<Option<String>> = RefCell::new(None);
    static RELAY_SECRET: RefCell<Option<String>> = RefCell::new(None);
    static REQ_SEQ: RefCell<u64> = RefCell::new(0);
}

fn next_req_seq() -> u64 {
    REQ_SEQ.with(|s| {
        let mut n = s.borrow_mut();
        *n += 1;
        *n
    })
}

fn relay_config() -> Option<relay_client::RelayConfig> {
    let url = RELAY_URL.with(|u| u.borrow().clone())?;
    let secret = RELAY_SECRET.with(|s| s.borrow().clone())?;
    Some(relay_client::RelayConfig {
        infer_url: url,
        shared_secret: secret,
    })
}

fn public_blob_url(blob_id: &str) -> String {
    format!(
        "https://{}.raw.icp0.io/blob/{}",
        ic_cdk::id().to_text(),
        blob_id
    )
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
        upgrade: None,
    }
}

fn http_upgrade() -> HttpResponse {
    HttpResponse {
        status_code: 204,
        headers: vec![],
        body: vec![],
        streaming_strategy: None,
        upgrade: Some(true),
    }
}

fn normalize_path(url: &str) -> String {
    let mut path = url.split('?').next().unwrap_or(url).to_string();
    if let Some(idx) = path.find("/v1/") {
        path = path[idx..].to_string();
    } else if let Some(idx) = path.find("/blob/") {
        path = path[idx..].to_string();
    }
    if !path.starts_with('/') {
        path = format!("/{path}");
    }
    path
}

fn is_post_upgrade_path(path: &str) -> bool {
    matches!(
        path,
        "/v1/chat/completions" | "/v1/images/generations" | "/v1/images/edits" | "/mcp"
    )
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
    stream: Option<bool>,
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
    CF_ACCT.with(|a| *a.borrow_mut() = cf_acct);
    CF_TOKEN.with(|t| *t.borrow_mut() = cf_token);
    GEMINI_KEY.with(|g| *g.borrow_mut() = gemini);
}

#[update]
fn set_chat_vault_keys(groq: Option<String>, openrouter: Option<String>, anthropic: Option<String>) {
    GROQ_KEY.with(|g| *g.borrow_mut() = groq);
    OPENROUTER_KEY.with(|o| *o.borrow_mut() = openrouter);
    ANTHROPIC_VAULT.with(|a| *a.borrow_mut() = anthropic);
}

#[update]
fn set_relay_config(relay_url: Option<String>, relay_secret: Option<String>) {
    RELAY_URL.with(|u| *u.borrow_mut() = relay_url);
    RELAY_SECRET.with(|s| *s.borrow_mut() = relay_secret);
}

#[update]
fn set_byok_anthropic(key: Option<String>) {
    payments::set_byok_anthropic(caller(), key);
}

fn chat_keys_for_caller() -> chat_providers::ChatKeys {
    let p = caller();
    chat_providers::ChatKeys {
        cf_acct: CF_ACCT.with(|a| a.borrow().clone()),
        cf_token: CF_TOKEN.with(|t| t.borrow().clone()),
        groq: GROQ_KEY.with(|g| g.borrow().clone()),
        openrouter: OPENROUTER_KEY.with(|o| o.borrow().clone()),
        anthropic: payments::byok_anthropic(p).or_else(|| ANTHROPIC_VAULT.with(|a| a.borrow().clone())),
    }
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
            mk("cloudflare-workers-ai"),
            mk("gemini-2.5-flash-image"),
            mk("groq"),
            mk("openrouter"),
            mk("anthropic"),
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
    if parsed.model.as_deref() == Some("trp/onchain-raven-art") {
        if let Err(e) = moderation::check_prompt(caller(), &parsed.prompt) {
            return json_response(400, &format!(r#"{{"error":"{e}"}}"#));
        }
        let bytes = raven_art::compose_png(&parsed.prompt, None);
        return store_image_blob(bytes, "raven-onchain-compositor").await;
    }
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
    store_image_blob(bytes, &provider).await
}

async fn store_image_blob(bytes: Vec<u8>, provider: &str) -> HttpResponse {
    let blob_store = BLOB_STORE.with(|b| b.borrow().clone());
    let Some(blob_store) = blob_store else {
        return json_response(500, r#"{"error":"blob_store not configured"}"#.into());
    };
    let blob_id = match blob_client::store_image(blob_store, bytes).await {
        Ok(id) => id,
        Err(e) => return json_response(500, &format!(r#"{{"error":"{e}"}}"#)),
    };
    let url = public_blob_url(&blob_id);
    let body = format!(
        r#"{{"created":{},"data":[{{"url":"/blob/{blob_id}","revised_prompt":null}}],"provider":"{provider}","router_url":"{url}"}}"#,
        time()
    );
    json_response(200, &body)
}

async fn handle_mcp(body: &[u8]) -> HttpResponse {
    let id = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .unwrap_or(serde_json::json!(null));
    let (method, params) = match mcp::parse_request(body) {
        Ok(v) => v,
        Err(e) => return json_response(400, &mcp::err_response(id, &e)),
    };
    match method.as_str() {
        "tools/list" => {
            let body = mcp::ok_response(id, mcp::tools_list());
            json_response(200, &body)
        }
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_default();
            match name {
                "list_models" => {
                    let models: serde_json::Value =
                        serde_json::from_str(&models::models_json()).unwrap_or(serde_json::json!({}));
                    json_response(200, &mcp::ok_response(id, models))
                }
                "chat" => {
                    let payload = serde_json::json!({
                        "model": args.get("model").and_then(|v| v.as_str()).unwrap_or("trp/onchain-qwen-0.5b"),
                        "stream": args.get("stream").and_then(|v| v.as_bool()).unwrap_or(false),
                        "messages": args.get("messages").cloned().unwrap_or_default(),
                    });
                    let inner = handle_chat(serde_json::to_vec(&payload).unwrap_or_default().as_slice()).await;
                    if inner.status_code != 200 {
                        return inner;
                    }
                    let parsed: serde_json::Value =
                        serde_json::from_slice(&inner.body).unwrap_or(serde_json::json!({}));
                    json_response(200, &mcp::ok_response(id, parsed))
                }
                "generate_image" | "onchain_raven_art" => {
                    let model = if name == "onchain_raven_art" {
                        "trp/onchain-raven-art"
                    } else {
                        args.get("model")
                            .and_then(|v| v.as_str())
                            .unwrap_or("trp/image-standard")
                    };
                    let payload = serde_json::json!({
                        "model": model,
                        "prompt": args.get("prompt").and_then(|v| v.as_str()).unwrap_or("raven"),
                        "size": args.get("size").and_then(|v| v.as_str()),
                    });
                    let inner =
                        handle_images_generations(serde_json::to_vec(&payload).unwrap_or_default().as_slice())
                            .await;
                    if inner.status_code != 200 {
                        return inner;
                    }
                    let parsed: serde_json::Value =
                        serde_json::from_slice(&inner.body).unwrap_or(serde_json::json!({}));
                    json_response(200, &mcp::ok_response(id, parsed))
                }
                _ => json_response(404, &mcp::err_response(id, "unknown tool")),
            }
        }
        _ => json_response(404, &mcp::err_response(id, "unknown method")),
    }
}

async fn handle_chat(body: &[u8]) -> HttpResponse {
    let parsed: ChatBody = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(e) => return json_response(400, &format!(r#"{{"error":"{e}"}}"#)),
    };
    if parsed.model.starts_with("trp/onchain-") {
        if onchain::map_model(&parsed.model).is_none() {
            return json_response(
                503,
                r#"{"error":"on-chain model not loaded or unknown id"}"#,
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
        let (text, calls) = match onchain::complete_for_model(llama, &parsed.model, &user).await {
            Ok(v) => v,
            Err(e) => return json_response(502, &format!(r#"{{"error":"{e}"}}"#)),
        };
        if text.is_empty() {
            return json_response(502, r#"{"error":"empty on-chain completion"}"#);
        }
        if parsed.stream == Some(true) {
            return sse_chat_response(&parsed.model, &text, calls, true);
        }
        return json_chat_response(&parsed.model, &text, true, Some(calls));
    }

    let msgs: Vec<(String, String)> = parsed
        .messages
        .iter()
        .map(|m| (m.role.clone(), m.content.clone()))
        .collect();
    let keys = chat_keys_for_caller();
    let seq = next_req_seq();
    let relay = relay_config();
    match chat_providers::complete(&parsed.model, &msgs, &keys, relay, seq).await {
        Ok(text) => {
            if parsed.stream == Some(true) {
                return sse_chat_response(&parsed.model, &text, 0, false);
            }
            json_chat_response(&parsed.model, &text, false, None)
        }
        Err(e) => {
            let code = if e.contains("BYOK required") { 402 } else { 502 };
            json_response(code, &format!(r#"{{"error":{}}}"#, serde_json::json!(e)))
        }
    }
}

fn json_chat_response(model: &str, content: &str, on_chain: bool, update_calls: Option<u32>) -> HttpResponse {
    let escaped = serde_json::to_string(content).unwrap_or_else(|_| "\"\"".into());
    let mut body = format!(
        r#"{{"id":"trp-chat","object":"chat.completion","model":"{model}","choices":[{{"index":0,"message":{{"role":"assistant","content":{escaped}}},"finish_reason":"stop"}}]"#
    );
    if let Some(c) = update_calls {
        body.push_str(&format!(r#","on_chain_update_calls":{c}"#));
    }
    body.push('}');
    let mut headers = vec![HeaderField("Content-Type".into(), "application/json".into())];
    if on_chain {
        headers.push(HeaderField("X-TRP-On-Chain".into(), "true".into()));
    }
    HttpResponse {
        status_code: 200,
        headers,
        body: body.into_bytes(),
        streaming_strategy: None,
        upgrade: None,
    }
}

fn sse_chat_response(model: &str, content: &str, update_calls: u32, on_chain: bool) -> HttpResponse {
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
    let mut headers = vec![
        HeaderField("Content-Type".into(), "text/event-stream".into()),
        HeaderField("Cache-Control".into(), "no-cache".into()),
    ];
    if on_chain {
        headers.push(HeaderField("X-TRP-On-Chain".into(), "true".into()));
    }
    HttpResponse {
        status_code: 200,
        headers,
        body: body.into_bytes(),
        streaming_strategy: None,
        upgrade: None,
    }
}

fn handle_models() -> HttpResponse {
    json_response(200, &models::models_json())
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
    let path = normalize_path(&req.url);
    if req.method.eq_ignore_ascii_case("POST") {
        match path.as_str() {
            "/v1/images/generations" => return handle_images_generations(&req.body).await,
            "/v1/images/edits" => {
                return json_response(
                    501,
                    r#"{"error":"edits: use Gemini path via worker or add multipart parser (M2 follow-up)"}"#,
                )
            }
            "/v1/chat/completions" => return handle_chat(&req.body).await,
            "/mcp" => return handle_mcp(&req.body).await,
            _ => {}
        }
    }
    json_response(404, r#"{"error":"not found"}"#)
}

#[query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = normalize_path(&req.url);
    if req.method.eq_ignore_ascii_case("POST") && is_post_upgrade_path(&path) {
        return http_upgrade();
    }
    if req.method.eq_ignore_ascii_case("OPTIONS") {
        return HttpResponse {
            status_code: 204,
            headers: vec![
                HeaderField("Access-Control-Allow-Origin".into(), "*".into()),
                HeaderField(
                    "Access-Control-Allow-Methods".into(),
                    "GET, POST, OPTIONS".into(),
                ),
                HeaderField(
                    "Access-Control-Allow-Headers".into(),
                    "Content-Type, Authorization, X-TRP-On-Chain".into(),
                ),
            ],
            body: vec![],
            streaming_strategy: None,
            upgrade: None,
        };
    }
    match path.as_str() {
        "/v1/models" => handle_models(),
        "/v1/status" => handle_status(),
        "/mcp" => json_response(200, &mcp::handle_get()),
        p if p.starts_with("/blob/") => HttpResponse {
            status_code: 307,
            headers: vec![HeaderField(
                "Location".into(),
                format!("/blob/{}", p.trim_start_matches("/blob/")),
            )],
            body: vec![],
            streaming_strategy: None,
            upgrade: None,
        },
        _ => json_response(404, r#"{"error":"not found"}"#),
    }
}

ic_cdk::export_candid!();
