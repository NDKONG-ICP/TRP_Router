//! Minimal MCP-style JSON-RPC over HTTP (stub). Maps tool calls to existing /v1 handlers.

use serde_json::{json, Value};

pub fn handle_get() -> String {
    json!({
        "name": "trp-router",
        "version": "0.1.0-beta",
        "protocol": "mcp-stub-http",
        "endpoints": {
            "tools_list": "POST /mcp {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}",
            "tools_call": "POST /mcp {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"chat\",\"arguments\":{...}}}"
        },
        "auth": "trp_ API key (DRAFT — BYOK/credits at launch)"
    })
    .to_string()
}

pub fn tools_list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_models",
                "description": "List OpenAI-shaped models from /v1/models",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "chat",
                "description": "Chat completion (same as POST /v1/chat/completions)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "model": { "type": "string" },
                        "messages": { "type": "array" },
                        "stream": { "type": "boolean" }
                    },
                    "required": ["model", "messages"]
                }
            },
            {
                "name": "generate_image",
                "description": "Image generation (POST /v1/images/generations)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "model": { "type": "string" },
                        "prompt": { "type": "string" },
                        "size": { "type": "string" }
                    },
                    "required": ["prompt"]
                }
            },
            {
                "name": "onchain_raven_art",
                "description": "On-chain Raven compositor (trp/onchain-raven-art)",
                "inputSchema": {
                    "type": "object",
                    "properties": { "prompt": { "type": "string" }, "seed": { "type": "integer" } },
                    "required": ["prompt"]
                }
            }
        ]
    })
}

pub fn parse_request(body: &[u8]) -> Result<(String, Value), String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("invalid json: {e}"))?;
    let method = v
        .get("method")
        .and_then(|m| m.as_str())
        .ok_or("missing method")?
        .to_string();
    let params = v.get("params").cloned().unwrap_or(json!({}));
    Ok((method, params))
}

pub fn ok_response(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

pub fn err_response(id: Value, message: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32601, "message": message }
    })
    .to_string()
}
