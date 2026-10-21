//! Off-chain chat providers (HTTPS outcalls + transform).

use crate::image_providers;
use crate::models;
use ic_cdk::api::management_canister::http_request::HttpHeader;
use serde::{Deserialize, Serialize};

#[derive(Clone, Default)]
pub struct ChatKeys {
    pub cf_acct: Option<String>,
    pub cf_token: Option<String>,
    pub groq: Option<String>,
    pub openrouter: Option<String>,
    pub anthropic: Option<String>,
}

#[derive(Serialize)]
struct OpenAiChatReq<'a> {
    model: &'a str,
    messages: &'a [OpenAiMsg<'a>],
    max_tokens: u32,
}

#[derive(Serialize)]
struct OpenAiMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAiChatResp {
    choices: Option<Vec<OpenAiChoice>>,
    error: Option<OpenAiErr>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: Option<OpenAiMsgOwned>,
}

#[derive(Deserialize)]
struct OpenAiMsgOwned {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiErr {
    message: Option<String>,
}

pub async fn complete(
    model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
) -> Result<String, String> {
    if let Some(cf_model) = models::cf_run_model(model) {
        return cloudflare_chat(cf_model, messages, keys).await;
    }
    if let Some(groq_model) = models::groq_model(model) {
        return groq_chat(groq_model, messages, keys).await;
    }
    if let Some(or_model) = models::or_model(model) {
        return openrouter_chat(or_model, messages, keys).await;
    }
    if let Some(claude) = models::anthropic_model_id(model) {
        return anthropic_chat(claude, messages, keys).await;
    }
    Err(format!("unknown or unsupported chat model: {model}"))
}

async fn groq_chat(
    model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
) -> Result<String, String> {
    let key = keys.groq.as_deref().ok_or("BYOK required: set Groq API key in vault")?;
    let msgs: Vec<OpenAiMsg> = messages
        .iter()
        .map(|(r, c)| OpenAiMsg {
            role: r.as_str(),
            content: c.as_str(),
        })
        .collect();
    let body = OpenAiChatReq {
        model,
        messages: &msgs,
        max_tokens: 1024,
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let resp = image_providers::http_post_json(
        "https://api.groq.com/openai/v1/chat/completions".into(),
        vec![
            HttpHeader {
                name: "Authorization".into(),
                value: format!("Bearer {key}"),
            },
            HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            },
        ],
        bytes,
    )
    .await?;
    parse_openai_chat(&resp)
}

async fn openrouter_chat(
    model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
) -> Result<String, String> {
    let key = keys
        .openrouter
        .as_deref()
        .ok_or("BYOK required: set OpenRouter API key in vault")?;
    let msgs: Vec<OpenAiMsg> = messages
        .iter()
        .map(|(r, c)| OpenAiMsg {
            role: r.as_str(),
            content: c.as_str(),
        })
        .collect();
    let body = OpenAiChatReq {
        model,
        messages: &msgs,
        max_tokens: 1024,
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let resp = image_providers::http_post_json(
        "https://openrouter.ai/api/v1/chat/completions".into(),
        vec![
            HttpHeader {
                name: "Authorization".into(),
                value: format!("Bearer {key}"),
            },
            HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            },
            HttpHeader {
                name: "HTTP-Referer".into(),
                value: "https://trp-router.icp0.io".into(),
            },
        ],
        bytes,
    )
    .await?;
    parse_openai_chat(&resp)
}

async fn cloudflare_chat(
    cf_model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
) -> Result<String, String> {
    let acct = keys
        .cf_acct
        .as_deref()
        .ok_or("BYOK required: Cloudflare account id in vault")?;
    let token = keys
        .cf_token
        .as_deref()
        .ok_or("BYOK required: Cloudflare API token in vault")?;
    let prompt = messages
        .iter()
        .map(|(r, c)| format!("{r}: {c}"))
        .collect::<Vec<_>>()
        .join("\n");
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{cf_model}"
    );
    let body = serde_json::json!({ "messages": [{ "role": "user", "content": prompt }] });
    let resp = image_providers::http_post_json(
        url,
        vec![
            HttpHeader {
                name: "Authorization".into(),
                value: format!("Bearer {token}"),
            },
            HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            },
        ],
        body.to_string().into_bytes(),
    )
    .await?;
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&resp) {
        if let Some(t) = v.pointer("/result/response").and_then(|x| x.as_str()) {
            return Ok(t.to_string());
        }
        if let Some(t) = v.as_str() {
            return Ok(t.to_string());
        }
    }
    String::from_utf8(resp).map_err(|_| "cloudflare: invalid utf8 response".into())
}

#[derive(Serialize)]
struct AnthropicReq<'a> {
    model: &'a str,
    max_tokens: u32,
    system: Option<&'a str>,
    messages: Vec<AnthropicMsg<'a>>,
}

#[derive(Serialize)]
struct AnthropicMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Option<Vec<AnthropicBlock>>,
    error: Option<AnthropicErr>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicErr {
    message: Option<String>,
}

async fn anthropic_chat(
    model: &str,
    messages: &[(String, String)],
    keys: &ChatKeys,
) -> Result<String, String> {
    let key = keys
        .anthropic
        .as_deref()
        .ok_or("BYOK required: attach Anthropic API key (0% fee)")?;
    let mut system = None;
    let mut msgs = Vec::new();
    for (role, content) in messages {
        if role.eq_ignore_ascii_case("system") {
            system = Some(content.as_str());
        } else if role.eq_ignore_ascii_case("user") || role.eq_ignore_ascii_case("assistant") {
            msgs.push(AnthropicMsg {
                role: if role.eq_ignore_ascii_case("assistant") {
                    "assistant"
                } else {
                    "user"
                },
                content: content.as_str(),
            });
        }
    }
    if msgs.is_empty() {
        return Err("Anthropic: need at least one user message".into());
    }
    let body = AnthropicReq {
        model,
        max_tokens: 1024,
        system,
        messages: msgs,
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let resp = image_providers::http_post_json(
        "https://api.anthropic.com/v1/messages".into(),
        vec![
            HttpHeader {
                name: "x-api-key".into(),
                value: key.to_string(),
            },
            HttpHeader {
                name: "anthropic-version".into(),
                value: "2023-06-01".into(),
            },
            HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            },
        ],
        bytes,
    )
    .await?;
    let parsed: AnthropicResp = serde_json::from_slice(&resp).map_err(|e| format!("anthropic json: {e}"))?;
    if let Some(err) = parsed.error {
        return Err(err.message.unwrap_or_else(|| "anthropic error".into()));
    }
    Ok(parsed
        .content
        .unwrap_or_default()
        .into_iter()
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join(""))
}

fn parse_openai_chat(bytes: &[u8]) -> Result<String, String> {
    let parsed: OpenAiChatResp =
        serde_json::from_slice(bytes).map_err(|e| format!("openai-shaped json: {e}"))?;
    if let Some(err) = parsed.error {
        return Err(err.message.unwrap_or_else(|| "provider error".into()));
    }
    parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .ok_or_else(|| "empty completion".into())
}
