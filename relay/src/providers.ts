export type ChatMessage = { role: string; content: string };

export type InferBody = {
  provider: string;
  model: string;
  messages: ChatMessage[];
  idempotency_key: string;
  byok_key?: string;
};

export type InferOk = {
  ok: true;
  content: string;
  upstream_calls: number;
};

export type InferErr = {
  ok: false;
  error: string;
  upstream_calls: number;
};

export type InferResult = InferOk | InferErr;

type Env = {
  GROQ_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};

export async function runUpstream(body: InferBody, env: Env): Promise<InferResult> {
  try {
    const content = await dispatch(body, env);
    return { ok: true, content, upstream_calls: 1 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, upstream_calls: 1 };
  }
}

async function dispatch(body: InferBody, env: Env): Promise<string> {
  switch (body.provider) {
    case "groq":
      return groqChat(body, env);
    case "cloudflare":
      return cfChat(body, env);
    case "openrouter":
      return openrouterChat(body, env);
    case "anthropic":
      return anthropicChat(body, env);
    case "gemini":
      return geminiChat(body, env);
    default:
      throw new Error(`unknown provider: ${body.provider}`);
  }
}

async function groqChat(body: InferBody, env: Env): Promise<string> {
  const key = body.byok_key || env.GROQ_API_KEY;
  if (!key) throw new Error("groq: no API key");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      max_tokens: 512,
      temperature: 0,
    }),
  });
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(j.error?.message || `groq ${res.status}`);
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error("groq: empty completion");
  return text;
}

async function cfChat(body: InferBody, env: Env): Promise<string> {
  const acct = env.CLOUDFLARE_ACCOUNT_ID;
  const token = body.byok_key || env.CLOUDFLARE_API_TOKEN;
  if (!acct || !token) throw new Error("cloudflare: not configured");
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${body.model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: body.messages }),
  });
  const j = (await res.json()) as {
    result?: { response?: string };
    success?: boolean;
    errors?: { message?: string }[];
  };
  if (!res.ok) {
    throw new Error(j.errors?.[0]?.message || `cloudflare ${res.status}`);
  }
  const t = j.result?.response;
  if (t) return t;
  throw new Error("cloudflare: empty response");
}

async function openrouterChat(body: InferBody, env: Env): Promise<string> {
  const key = body.byok_key || env.OPENROUTER_API_KEY;
  if (!key) throw new Error("openrouter: no API key");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://trp-router.icp0.io",
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      max_tokens: 512,
      temperature: 0,
    }),
  });
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(j.error?.message || `openrouter ${res.status}`);
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error("openrouter: empty completion");
  return text;
}

async function anthropicChat(body: InferBody, env: Env): Promise<string> {
  const key = body.byok_key || env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("anthropic: BYOK required");
  let system: string | undefined;
  const msgs: ChatMessage[] = [];
  for (const m of body.messages) {
    if (m.role === "system") system = m.content;
    else if (m.role === "user" || m.role === "assistant") msgs.push(m);
  }
  if (msgs.length === 0) throw new Error("anthropic: need user message");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      max_tokens: 1024,
      system,
      messages: msgs.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  });
  const j = (await res.json()) as {
    content?: { text?: string }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(j.error?.message || `anthropic ${res.status}`);
  const text = j.content?.map((b) => b.text || "").join("") || "";
  if (!text) throw new Error("anthropic: empty completion");
  return text;
}

async function geminiChat(body: InferBody, env: Env): Promise<string> {
  const key = body.byok_key || env.GEMINI_API_KEY;
  if (!key) throw new Error("gemini: no API key");
  const contents = body.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(j.error?.message || `gemini ${res.status}`);
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("gemini: empty completion");
  return text;
}
