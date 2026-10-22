import { InferBody, InferResult, runUpstream } from "./providers";

const CACHE_TTL_MS = 45_000;

export class InferCoordinator {
  private state: DurableObjectState;
  private env: Env;
  private cached: { at: number; result: InferResult } | null = null;
  private inflight: Promise<InferResult> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      console.log(JSON.stringify({ event: "cache_hit", key: this.cachedKey(request) }));
      return json(this.cached.result);
    }

    if (!this.inflight) {
      const body = (await request.clone().json()) as InferBody;
      console.log(JSON.stringify({ event: "upstream_start", key: body.idempotency_key.slice(0, 16) }));
      this.inflight = runUpstream(body, this.env).then((result) => {
        this.cached = { at: Date.now(), result };
        console.log(
          JSON.stringify({
            event: result.ok ? "upstream_ok" : "upstream_err",
            key: body.idempotency_key.slice(0, 16),
            ok: result.ok,
          }),
        );
        return result;
      });
    } else {
      console.log(JSON.stringify({ event: "coalesce_wait", key: this.cachedKey(request) }));
    }

    try {
      const result = await this.inflight!;
      return json(result);
    } catch (e) {
      this.inflight = null;
      return json({ ok: false, error: String(e), upstream_calls: 0 }, 502);
    }
  }

  private cachedKey(request: Request): string {
    return request.headers.get("x-idempotency-key") || "?";
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Env {
  GROQ_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}
