//! Off-chain chat — routed through idempotent relay when configured (IC consensus).

use crate::models;
use crate::relay_client::{self, RelayConfig};

#[derive(Clone, Default)]
pub struct ChatKeys {
    pub cf_acct: Option<String>,
    pub cf_token: Option<String>,
    pub groq: Option<String>,
    pub openrouter: Option<String>,
    pub anthropic: Option<String>,
}

pub async fn complete(
    model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
    relay: Option<RelayConfig>,
    req_seq: u64,
) -> Result<String, String> {
    if !models::relay_target(model).is_some() {
        return Err(format!("unknown or unsupported chat model: {model}"));
    }
    let relay = relay.ok_or_else(|| {
        "Off-chain chat is not enabled on this router deployment yet.".to_string()
    })?;
    let byok = anthropic_byok(model, keys);
    relay_client::infer_via_relay(model, messages, req_seq, &relay, byok).await
}

fn anthropic_byok(model: &str, keys: &ChatKeys) -> Option<String> {
    if models::anthropic_model_id(model).is_some() {
        keys.anthropic.clone()
    } else {
        None
    }
}
