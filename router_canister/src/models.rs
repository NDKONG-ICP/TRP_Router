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
    push("trp/image-standard", "trp-router", "image", false, false, true);
    push("trp/image-identity", "trp-router", "image", false, false, true);
    push("trp/flux", "pollinations", "image", false, false, true);

    for id in CF_LLM_CHAT {
        push(id, "cloudflare", "chat", false, false, false);
    }
    for id in GROQ_MODELS {
        push(id, "groq", "chat", false, false, false);
    }
    push("trp/gemini-2.0-flash", "google", "chat", false, false, false);

    for id in OR_FREE {
        push(id, "openrouter", "chat", false, false, true);
    }

    for id in CLAUDE_MODELS {
        push(id, "anthropic", "chat", false, true, false);
    }

    v
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

/// Cloudflare Workers AI chat models (relay-routed; spot-checked subset).
const CF_LLM_CHAT: &[&str] = &[
    "trp/cf/@cf/meta/llama-3.2-1b-instruct",
    "trp/cf/@cf/meta/llama-3.2-3b-instruct",
    "trp/cf/@cf/microsoft/phi-2",
];

const GROQ_MODELS: &[&str] = &[
    "trp/groq/openai/gpt-oss-20b",
    "trp/groq/openai/gpt-oss-120b",
    "trp/groq/qwen/qwen3.8-27b",
];

const OR_FREE: &[&str] = &["trp/or/meta-llama/llama-3.2-3b-instruct:free"];

pub const CLAUDE_MODELS: &[&str] = &[
    "trp/claude-opus-5-5",
    "trp/claude-sonnet-5-5",
    "trp/claude-haiku-5-5",
    "trp/claude-fable-5-1",
];

pub fn anthropic_model_id(trp_id: &str) -> Option<&'static str> {
    match trp_id {
        "trp/claude-opus-5-5" => Some("claude-opus-5-5"),
        "trp/claude-sonnet-5-5" => Some("claude-sonnet-5-5"),
        "trp/claude-haiku-5-5" => Some("claude-haiku-5-5"),
        "trp/claude-fable-5-1" => Some("claude-fable-5-1"),
        _ => None,
    }
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
    if let Some(m) = groq_model(trp_id) {
        return Some(("groq".into(), m.to_string()));
    }
    if CF_LLM_CHAT.contains(&trp_id) {
        if let Some(m) = cf_run_model(trp_id) {
            return Some(("cloudflare".into(), m.to_string()));
        }
    }
    if let Some(m) = or_model(trp_id) {
        return Some(("openrouter".into(), m.to_string()));
    }
    if let Some(m) = anthropic_model_id(trp_id) {
        return Some(("anthropic".into(), m.to_string()));
    }
    if trp_id == "trp/gemini-2.0-flash" {
        return Some(("gemini".into(), "gemini-2.0-flash".into()));
    }
    None
}
