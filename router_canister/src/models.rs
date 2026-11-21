//! OpenAI-shaped /v1/models catalog (DRAFT — smoke-listed models only).

#[derive(Clone, Copy)]
pub struct ModelEntry {
    pub id: &'static str,
    pub owned_by: &'static str,
    pub capability: &'static str,
    pub on_chain: bool,
    pub byok: bool,
    pub free_tier: bool,
}

pub fn catalog() -> Vec<ModelEntry> {
    let mut v = Vec::new();
    let mut push = |id, owned_by, capability, on_chain, byok, free_tier| {
        v.push(ModelEntry {
            id,
            owned_by,
            capability,
            on_chain,
            byok,
            free_tier,
        });
    };

    push("trp/onchain-qwen-0.5b", "onicai", "chat", true, false, true);
    push("trp/onchain-raven-chat", "raven", "chat", true, false, true);
    push("trp/onchain-raven-art", "raven", "image", true, false, true);
    push("raven-diffusion", "raven", "image", true, false, true);
    push("trp/image-standard", "trp-router", "image", false, false, true);
    push("trp/image-identity", "trp-router", "image", false, false, true);
    push("trp/flux", "pollinations", "image", false, false, true);

    for id in CF_LLM_CHAT {
        push(id, "cloudflare", "chat", false, false, false);
    }
    for id in GROQ_MODELS {
        push(id, "groq", "chat", false, false, false);
    }
    for id in GEMINI_MODELS {
        push(id, "google", "chat", false, false, false);
    }

    for id in OR_FREE {
        push(id, "openrouter", "chat", false, false, true);
    }

    for id in CLAUDE_MODELS {
        push(id, "anthropic", "chat", false, true, false);
    }

    v
}

/// A listed model that is not on the free tier. These are billed to the operator's
/// provider accounts, so callers need an admin-minted API key to use them.
pub fn is_paid(model_id: &str) -> bool {
    catalog()
        .iter()
        .any(|m| m.id == model_id && !m.free_tier)
}

pub fn models_json() -> String {
    let entries = catalog();
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

/// Cloudflare Workers AI chat models (relay-routed). Every id here was probed
/// end-to-end through the relay on 2026-11-15 on the Workers Free plan.
/// Removed: `@cf/microsoft/phi-2` (retired by Cloudflare on 2026-05-30).
/// Not listed: Kimi K2.x, DeepSeek v4, GLM 5.3 — they need the Workers Paid plan.
const CF_LLM_CHAT: &[&str] = &[
    "trp/cf/@cf/meta/llama-3.2-1b-instruct",
    "trp/cf/@cf/meta/llama-3.2-3b-instruct",
    "trp/cf/@cf/meta/llama-3.1-8b-instruct-fp8",
    "trp/cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "trp/cf/@cf/meta/llama-4-scout-17b-16e-instruct",
    "trp/cf/@cf/mistralai/mistral-small-3.1-24b-instruct",
    "trp/cf/@cf/qwen/qwen2.5-coder-32b-instruct",
];

const GROQ_MODELS: &[&str] = &[
    "trp/groq/openai/gpt-oss-20b",
    "trp/groq/openai/gpt-oss-120b",
    "trp/groq/qwen/qwen3.8-27b",
];

/// Gemini is unlisted until the relay has a valid GEMINI_API_KEY (the current one
/// is rejected upstream: "API key not valid"). Re-add `"trp/gemini-2.0-flash"`
/// (or its current successor) here once the key is replaced.
const GEMINI_MODELS: &[&str] = &[];

/// OpenRouter is unlisted until OPENROUTER_API_KEY is set on the relay (it has none).
/// Re-add e.g. `"trp/or/meta-llama/llama-3.2-3b-instruct:free"` once it is.
const OR_FREE: &[&str] = &[];

/// `trp/<anthropic id>`; probed through the relay on 2026-11-15.
pub const CLAUDE_MODELS: &[&str] = &[
    "trp/claude-fable-5-2",
    "trp/claude-opus-5-5",
    "trp/claude-sonnet-5-5",
    "trp/claude-haiku-5-5",
    "trp/claude-fable-5-1",
    "trp/claude-opus-5",
    "trp/claude-sonnet-5",
    "trp/claude-fable-5",
];

pub fn anthropic_model_id(trp_id: &str) -> Option<&'static str> {
    CLAUDE_MODELS
        .iter()
        .find(|m| **m == trp_id)
        .and_then(|m| m.strip_prefix("trp/"))
}

pub fn cf_run_model(trp_id: &str) -> Option<&str> {
    trp_id.strip_prefix("trp/cf/")
}

pub fn groq_model(trp_id: &str) -> Option<&str> {
    trp_id.strip_prefix("trp/groq/")
}

pub fn or_model(trp_id: &str) -> Option<&str> {
    trp_id.strip_prefix("trp/or/")
}

/// Map TRP model id → (relay provider, upstream model id).
pub fn relay_target(trp_id: &str) -> Option<(String, String)> {
    // Only ids in the catalog route to the relay — a bare `trp/groq/<anything>` or
    // `trp/or/<anything>` prefix must not be an open passthrough to the provider.
    if GROQ_MODELS.contains(&trp_id) {
        if let Some(m) = groq_model(trp_id) {
            return Some(("groq".into(), m.to_string()));
        }
    }
    if CF_LLM_CHAT.contains(&trp_id) {
        if let Some(m) = cf_run_model(trp_id) {
            return Some(("cloudflare".into(), m.to_string()));
        }
    }
    if OR_FREE.contains(&trp_id) {
        if let Some(m) = or_model(trp_id) {
            return Some(("openrouter".into(), m.to_string()));
        }
    }
    if let Some(m) = anthropic_model_id(trp_id) {
        return Some(("anthropic".into(), m.to_string()));
    }
    if GEMINI_MODELS.contains(&trp_id) {
        if let Some(m) = trp_id.strip_prefix("trp/") {
            return Some(("gemini".into(), m.to_string()));
        }
    }
    None
}

pub fn map_onchain_chat(model: &str) -> Option<&'static str> {
    match model {
        "trp/onchain-qwen-0.5b" | "trp/onchain-raven-chat" => Some("qwen25"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paid_flag_follows_the_catalog() {
        assert!(is_paid("trp/claude-opus-5-5"));
        assert!(is_paid("trp/groq/openai/gpt-oss-20b"));
        assert!(is_paid("trp/cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast"));
        assert!(!is_paid("trp/onchain-qwen-0.5b"));
        assert!(!is_paid("raven-diffusion"));
        assert!(!is_paid("not-a-model"));
    }

    #[test]
    fn relay_routes_only_listed_models() {
        assert_eq!(
            relay_target("trp/claude-fable-5-2"),
            Some(("anthropic".into(), "claude-fable-5-2".into()))
        );
        assert_eq!(
            relay_target("trp/groq/openai/gpt-oss-120b"),
            Some(("groq".into(), "openai/gpt-oss-120b".into()))
        );
        // Retired / unkeyed providers and arbitrary passthrough ids are not routable.
        assert_eq!(relay_target("trp/cf/@cf/microsoft/phi-2"), None);
        assert_eq!(relay_target("trp/gemini-2.0-flash"), None);
        assert_eq!(relay_target("trp/or/meta-llama/llama-3.2-3b-instruct:free"), None);
        assert_eq!(relay_target("trp/groq/whisper-large-v3"), None);
    }

    #[test]
    fn every_catalog_id_is_unique() {
        let ids: Vec<&str> = catalog().iter().map(|m| m.id).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(ids.len(), sorted.len());
    }
}
