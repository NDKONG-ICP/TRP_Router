//! OpenAI-shaped /v1/models catalog (DRAFT — capability metadata only).

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
    push("trp/image-standard", "trp-router", "image", false, false, true);
    push("trp/image-identity", "trp-router", "image", false, false, true);

    // Cloudflare Workers AI (BYOK / vault keys)
    for id in CF_LLM {
        push(id, "cloudflare", "chat", false, true, false);
    }
    for id in CF_EMBED {
        push(id, "cloudflare", "embeddings", false, true, false);
    }
    for id in CF_IMAGE {
        push(id, "cloudflare", "image", false, true, false);
    }

    // Groq (vault key; free tier at provider)
    for id in GROQ_MODELS {
        push(id, "groq", "chat", false, true, false);
    }

    // Gemini chat (vault)
    push("trp/gemini-2.0-flash", "google", "chat", false, true, false);

    // OpenRouter free slug models (vault key)
    for id in OR_FREE {
        push(id, "openrouter", "chat", false, true, true);
    }

    // Anthropic Claude (BYOK)
    for id in CLAUDE_MODELS {
        push(id, "anthropic", "chat", false, true, false);
    }

    // Pollinations image (keyless)
    push("trp/flux", "pollinations", "image", false, false, true);

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

const CF_LLM: &[&str] = &[
    "trp/cf/@cf/meta/llama-3-8b-instruct",
    "trp/cf/@cf/meta/llama-3.1-8b-instruct",
    "trp/cf/@cf/mistral/mistral-7b-instruct-v0.2",
    "trp/cf/@cf/mistral/mistral-7b-instruct-v0.1",
    "trp/cf/@cf/huggingface/distilbert-sst-2-int8",
    "trp/cf/@cf/defiant/speecht5_tts",
    "trp/cf/@cf/openai/whisper",
    "trp/cf/@cf/facebook/bart-large-cnn",
    "trp/cf/@cf/microsoft/phi-2",
    "trp/cf/@cf/qwen/qwq-32b",
    "trp/cf/@cf/meta/llama-2-7b-chat-fp16",
    "trp/cf/@cf/meta/llama-3.2-3b-instruct",
    "trp/cf/@cf/meta/llama-3.2-1b-instruct",
    "trp/cf/@cf/meta/llama-3.2-11b-vision-instruct",
    "trp/cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

const CF_EMBED: &[&str] = &[
    "trp/cf/@cf/baai/bge-base-en-v1.5",
    "trp/cf/@cf/baai/bge-large-en-v1.5",
    "trp/cf/@cf/google/embeddinggemma-300m",
];

const CF_IMAGE: &[&str] = &[
    "trp/cf/@cf/black-forest-labs/flux-1-schnell",
    "trp/cf/@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "trp/cf/@cf/bytedance/stable-diffusion-xl-lightning",
];

const GROQ_MODELS: &[&str] = &[
    "trp/groq/llama-3.3-70b-versatile",
    "trp/groq/llama-3.1-8b-instant",
    "trp/groq/llama3-70b-8192",
    "trp/groq/llama3-8b-8192",
    "trp/groq/gemma2-9b-it",
    "trp/groq/mixtral-8x7b-32768",
];

const OR_FREE: &[&str] = &[
    "trp/or/meta-llama/llama-3.2-3b-instruct:free",
    "trp/or/google/gemma-2-9b-it:free",
    "trp/or/mistralai/mistral-7b-instruct:free",
    "trp/or/qwen/qwen-2.5-7b-instruct:free",
    "trp/or/deepseek/deepseek-r1-distill-llama-70b:free",
];

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
