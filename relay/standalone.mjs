#!/usr/bin/env node
/**
 * Single-instance relay fallback (Fly.io / VPS). Same POST /infer contract as the Worker.
 * Run: RELAY_SHARED_SECRET=... GROQ_API_KEY=... node standalone.mjs
 */
import http from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.RELAY_SHARED_SECRET || "";
const TTL_MS = 45_000;

const cache = new Map();
const inflight = new Map();

async function groq(body, env) {
  const key = body.byok_key || env.GROQ_API_KEY;
  if (!key) throw new Error("groq: no key");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      max_tokens: 512,
      temperature: 0,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `groq ${res.status}`);
  return j.choices?.[0]?.message?.content || "";
}

async function upstream(body) {
  if (body.provider === "groq") return { ok: true, content: await groq(body, process.env), upstream_calls: 1 };
  throw new Error(`standalone: provider ${body.provider} not wired in fallback`);
}

async function infer(body) {
  const key = body.idempotency_key;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.result;

  if (!inflight.has(key)) {
    inflight.set(
      key,
      upstream(body)
        .catch((e) => ({ ok: false, error: String(e.message || e), upstream_calls: 1 }))
        .then((result) => {
          cache.set(key, { at: Date.now(), result });
          inflight.delete(key);
          return result;
        }),
    );
  } else {
    console.log(JSON.stringify({ event: "coalesce_wait", key: key.slice(0, 16) }));
  }
  return inflight.get(key);
}

const server = http.createServer(async (req, res) => {
  if (req.url !== "/infer" || req.method !== "POST") {
    res.writeHead(404);
    return res.end("not found");
  }
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401);
    return res.end("unauthorized");
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400);
    return res.end(JSON.stringify({ ok: false, error: "invalid json" }));
  }
  console.log(JSON.stringify({ event: "infer", key: body.idempotency_key?.slice(0, 16) }));
  const result = await infer(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});

server.listen(PORT, () => console.log(`relay standalone :${PORT}`));
