use ic_cdk::api::management_canister::http_request::{
    http_request, CanisterHttpRequestArgument, HttpHeader, HttpMethod, TransformContext,
};

const TIMEOUT_NS: u128 = 30_000_000_000;

fn transform_ctx() -> TransformContext {
    // Transform must live on this canister (IC rejects external transform principal).
    TransformContext::from_name("transform".to_string(), vec![])
}

pub struct ProviderKeys {
    pub cf_acct: Option<String>,
    pub cf_token: Option<String>,
    pub gemini: Option<String>,
}

fn record_err(name: &str, msg: String) {
    ic_cdk::println!("[trp-router] provider {name} failed: {msg}");
}

async fn outcall_get(url: String) -> Result<Vec<u8>, String> {
    let arg = CanisterHttpRequestArgument {
        url,
        method: HttpMethod::GET,
        headers: vec![
            HttpHeader {
                name: "User-Agent".into(),
                value: "TRP-Router/0.1".into(),
            },
            HttpHeader {
                name: "Accept".into(),
                value: "image/*".into(),
            },
        ],
        body: None,
        max_response_bytes: Some(2_000_000),
        transform: Some(transform_ctx()),
    };
    let (resp,) = http_request(arg, TIMEOUT_NS)
        .await
        .map_err(|(code, msg)| format!("http outcall {code:?} {msg}"))?;
    let status: u128 = resp.status.0.to_string().parse().unwrap_or(0);
    if status >= 500 {
        return Err(format!("upstream {status}"));
    }
    // Pollinations often returns HTTP 402 with a valid JPEG body when Accept: image/*.
    if status == 402 && resp.body.len() > 500 {
        return Ok(resp.body);
    }
    if status >= 400 {
        return Err(format!("upstream {status} len={}", resp.body.len()));
    }
    Ok(resp.body)
}

async fn outcall_post_json(url: String, headers: Vec<HttpHeader>, body: Vec<u8>) -> Result<Vec<u8>, String> {
    let arg = CanisterHttpRequestArgument {
        url,
        method: HttpMethod::POST,
        headers,
        body: Some(body),
        max_response_bytes: Some(2_000_000),
        transform: Some(transform_ctx()),
    };
    let (resp,) = http_request(arg, TIMEOUT_NS)
        .await
        .map_err(|(code, msg)| format!("http outcall {code:?} {msg}"))?;
    let status: u128 = resp.status.0.to_string().parse().unwrap_or(0);
    if status >= 500 {
        return Err(format!("upstream {status}"));
    }
    // Pollinations may return 402 with a valid JPEG body — accept if non-empty.
    if status == 402 && resp.body.len() > 500 {
        return Ok(resp.body);
    }
    if status >= 400 {
        return Err(format!("upstream {status}"));
    }
    Ok(resp.body)
}

async fn cloudflare(prompt: &str, keys: &ProviderKeys) -> Result<Vec<u8>, String> {
    let acct = keys.cf_acct.as_deref().ok_or("cloudflare not configured")?;
    let token = keys.cf_token.as_deref().ok_or("cloudflare not configured")?;
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/black-forest-labs/flux-1-schnell"
    );
    let body = serde_json::json!({ "prompt": prompt.chars().take(4000).collect::<String>() });
    let bytes = outcall_post_json(
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
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if let Some(b64) = v.pointer("/result/image").and_then(|x| x.as_str()) {
            return decode_b64(b64);
        }
    }
    Err("cloudflare missing image".into())
}

fn decode_b64(b64: &str) -> Result<Vec<u8>, String> {
    // minimal base64 decode without extra dep: use simple table
    base64_decode(b64).ok_or_else(|| "base64 decode failed".into())
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in input.bytes().filter(|b| *b != b'=' && !b.is_ascii_whitespace()) {
        let val = TABLE.iter().position(|&t| t == c)? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

async fn gemini(prompt: &str, keys: &ProviderKeys) -> Result<Vec<u8>, String> {
    let key = keys.gemini.as_deref().ok_or("gemini not configured")?;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
    );
    let body = serde_json::json!({
        "contents":[{"parts":[{"text": format!("Generate a single 1024x1024 image. {}", &prompt.chars().take(3500).collect::<String>())}]}],
        "generationConfig":{"responseModalities":["TEXT","IMAGE"]}
    });
    let bytes = outcall_post_json(
        url,
        vec![HttpHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body.to_string().into_bytes(),
    )
    .await?;
    let v: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("gemini json: {e}"))?;
    if let Some(arr) = v.pointer("/candidates/0/content/parts").and_then(|p| p.as_array()) {
        for part in arr {
            if let Some(data) = part.pointer("/inlineData/data").and_then(|d| d.as_str()) {
                return decode_b64(data);
            }
        }
    }
    Err("gemini missing inline image".into())
}

async fn pollinations(prompt: &str) -> Result<Vec<u8>, String> {
    let encoded: String = urlencoding(prompt);
    // Deterministic seed so all subnet replicas request the same image (consensus).
    let seed = prompt_seed(prompt);
    let url = format!(
        "https://image.pollinations.ai/prompt/{encoded}?width=1024&height=1024&nologo=true&model=flux&seed={seed}"
    );
    match outcall_get(url).await {
        Ok(body) if body.len() >= 500 => Ok(body),
        Ok(body) => Err(format!("pollinations short body len={}", body.len())),
        Err(e) => Err(e),
    }
}

fn prompt_seed(prompt: &str) -> u64 {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(prompt.as_bytes());
    u64::from_be_bytes(h[..8].try_into().expect("8 bytes"))
}

fn urlencoding(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes().take(2000) {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub async fn generate_with_failover(
    prompt: &str,
    keys: &ProviderKeys,
) -> Result<(Vec<u8>, String), String> {
    if keys.cf_acct.is_some() && keys.cf_token.is_some() {
        match cloudflare(prompt, keys).await {
            Ok(b) => return Ok((b, "cloudflare-flux-schnell".into())),
            Err(e) => record_err("cloudflare-flux-schnell", e),
        }
    }
    if keys.gemini.is_some() {
        match gemini(prompt, keys).await {
            Ok(b) => return Ok((b, "gemini-2.5-flash-image".into())),
            Err(e) => record_err("gemini-2.5-flash-image", e),
        }
    }
    match pollinations(prompt).await {
        Ok(b) => Ok((b, "pollinations-flux".into())),
        Err(e) => {
            record_err("pollinations-flux", e.clone());
            Err(format!("all providers failed; last: {e}"))
        }
    }
}
