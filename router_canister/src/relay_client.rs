//! HTTPS outcall to idempotent single-fetch relay (consensus-safe off-chain chat).

use crate::image_providers;
use crate::models;
use ic_cdk::api::management_canister::http_request::HttpHeader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone)]
pub struct RelayConfig {
    pub infer_url: String,
    pub shared_secret: String,
}

pub fn canonical_messages(messages: &[(String, String)]) -> String {
    let arr: Vec<serde_json::Value> = messages
        .iter()
        .map(|(role, content)| {
            serde_json::json!({ "role": role, "content": content })
        })
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into())
}

pub fn idempotency_key(
    provider: &str,
    model: &str,
    messages: &[(String, String)],
    req_seq: u64,
) -> String {
    let mut h = Sha256::new();
    h.update(provider.as_bytes());
    h.update(b"\n");
    h.update(model.as_bytes());
    h.update(b"\n");
    h.update(canonical_messages(messages).as_bytes());
    h.update(b"\n");
    h.update(req_seq.to_string().as_bytes());
    hex::encode(h.finalize())
}

#[derive(Serialize)]
struct InferRequest<'a> {
    provider: &'a str,
    model: &'a str,
    messages: Vec<InferMsg<'a>>,
    idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    byok_key: Option<String>,
}

#[derive(Serialize)]
struct InferMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct InferResponse {
    ok: bool,
    content: Option<String>,
    error: Option<String>,
}

pub async fn infer_via_relay(
    trp_model: &str,
    messages: &[(String, String)],
    req_seq: u64,
    relay: &RelayConfig,
    byok_key: Option<String>,
) -> Result<String, String> {
    let (provider, upstream_model) = models::relay_target(trp_model)
        .ok_or_else(|| format!("model not routed to relay: {trp_model}"))?;
    let idem = idempotency_key(&provider, &upstream_model, messages, req_seq);
    let msgs: Vec<InferMsg> = messages
        .iter()
        .map(|(r, c)| InferMsg {
            role: r.as_str(),
            content: c.as_str(),
        })
        .collect();
    let body = InferRequest {
        provider: &provider,
        model: &upstream_model,
        messages: msgs,
        idempotency_key: idem,
        byok_key,
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let resp = image_providers::http_post_json_relay(
        relay.infer_url.clone(),
        vec![
            HttpHeader {
                name: "Authorization".into(),
                value: format!("Bearer {}", relay.shared_secret),
            },
            HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            },
        ],
        bytes,
    )
    .await?;
    let parsed: InferResponse =
        serde_json::from_slice(&resp).map_err(|e| format!("relay json: {e}"))?;
    if parsed.ok {
        parsed
            .content
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "relay: empty content".into())
    } else {
        Err(parsed
            .error
            .unwrap_or_else(|| "relay upstream error".into()))
    }
}
