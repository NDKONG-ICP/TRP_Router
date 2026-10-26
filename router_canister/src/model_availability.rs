//! Which catalog entries are actually callable on this deployment (no false advertising).

use crate::models::{self, ModelEntry};

#[derive(Clone, Copy, Debug, Default)]
pub struct RuntimeFlags {
    pub relay_configured: bool,
    pub blob_store_configured: bool,
    pub llama_qwen_configured: bool,
}

/// If unavailable, returns a consumer-safe message (no vault env var names).
pub fn gate_message(model_id: &str, rt: &RuntimeFlags) -> Option<String> {
    if model_id.starts_with("trp/onchain-") && model_id != "trp/onchain-raven-art" {
        if models::map_onchain_chat(model_id).is_none() {
            return Some(format!("Model `{model_id}` is not supported."));
        }
        if !rt.llama_qwen_configured {
            return Some(
                "On-chain chat is not enabled on this router deployment yet.".into(),
            );
        }
        return None;
    }

    if matches!(
        model_id,
        "raven-diffusion" | "trp/raven-diffusion" | "trp/onchain-raven-diffusion"
    ) {
        return None;
    }

    if model_id == "trp/onchain-raven-art" {
        return None;
    }

    if model_id == "trp/flux"
        || model_id == "trp/image-standard"
        || model_id == "trp/image-identity"
    {
        if !rt.blob_store_configured {
            return Some(
                "Off-chain image storage is not enabled on this router deployment yet.".into(),
            );
        }
        return None;
    }

    if models::relay_target(model_id).is_some() {
        if !rt.relay_configured {
            return Some(
                "Off-chain chat is not enabled on this router deployment yet.".into(),
            );
        }
        return None;
    }

    Some(format!("Model `{model_id}` is not supported."))
}

pub fn catalog_filtered(rt: &RuntimeFlags) -> Vec<ModelEntry> {
    models::catalog()
        .into_iter()
        .filter(|m| gate_message(m.id, rt).is_none())
        .collect()
}

pub fn models_json_filtered(rt: &RuntimeFlags) -> String {
    let entries = catalog_filtered(rt);
    let items: Vec<String> = entries
        .iter()
        .map(|m| {
            format!(
                r#"{{"id":"{}","object":"model","owned_by":"{}","capability":"{}","on_chain":{},"byok":{},"free_tier":{}}}"#,
                m.id, m.owned_by, m.capability, m.on_chain, m.byok, m.free_tier
            )
        })
        .collect();
    format!(r#"{{"object":"list","data":[{}]}}"#, items.join(","))
}
