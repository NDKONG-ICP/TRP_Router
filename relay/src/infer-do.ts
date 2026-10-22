import { InferBody, InferResult, runUpstream } from "./providers";

/** Covers IC HTTPS outcall retry window so stragglers never start a second upstream call. */
const CACHE_TTL_MS = 120_000;

const STORAGE_KEY = "completed";

export class InferCoordinator {
  private state: DurableObjectState;
  private env: Env;
  /** Set synchronously before any upstream await; never cleared on success. */
  private inflight: Promise<InferResult> | null = null;
  private cached: { at: number; result: InferResult; body: string } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const body = (await request.json()) as InferBody;
    const keyHint = body.idempotency_key?.slice(0, 16) ?? "?";
    const now = Date.now();

    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      console.log(JSON.stringify({ event: "memory_cache_hit", key: keyHint }));
      return responseFromBody(this.cached.body, this.cached.result);
    }

    const stored = await this.state.storage.get<{
      at: number;
      result: InferResult;
      body: string;
    }>(STORAGE_KEY);
    if (stored && now - stored.at < CACHE_TTL_MS) {
      this.cached = stored;
      console.log(JSON.stringify({ event: "storage_cache_hit", key: keyHint }));
      return responseFromBody(stored.body, stored.result);
    }

    if (!this.inflight) {
      console.log(JSON.stringify({ event: "upstream_start", key: keyHint }));
      this.inflight = this.runSingleUpstream(body, keyHint);
    } else {
      console.log(JSON.stringify({ event: "coalesce_wait", key: keyHint }));
    }

    try {
      const { result, body: serialized } = await this.inflight;
      return responseFromBody(serialized, result);
    } catch (e) {
      this.inflight = null;
      const err: InferResult = { ok: false, error: String(e), upstream_calls: 0 };
      const serialized = JSON.stringify(err);
      return new Response(serialized, {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /** One upstream call per DO instance / idempotency key; promise assigned before first await inside. */
  private runSingleUpstream(body: InferBody, keyHint: string): Promise<{ result: InferResult; body: string }> {
    const promise = runUpstream(body, this.env)
      .then(async (result) => {
        const serialized = JSON.stringify(result);
        const entry = { at: Date.now(), result, body: serialized };
        this.cached = entry;
        await this.state.storage.put(STORAGE_KEY, entry);
        console.log(
          JSON.stringify({
            event: result.ok ? "upstream_ok" : "upstream_err",
            key: keyHint,
            ok: result.ok,
          }),
        );
        return { result, body: serialized };
      })
      .catch(async (e) => {
        const err: InferResult = { ok: false, error: String(e), upstream_calls: 1 };
        const serialized = JSON.stringify(err);
        const entry = { at: Date.now(), result: err, body: serialized };
        this.cached = entry;
        await this.state.storage.put(STORAGE_KEY, entry);
        console.log(JSON.stringify({ event: "upstream_err", key: keyHint, ok: false }));
        return { result: err, body: serialized };
      });
    return promise;
  }
}

function responseFromBody(serialized: string, result: InferResult): Response {
  const status = result.ok ? 200 : 502;
  return new Response(serialized, {
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
