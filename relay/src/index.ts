import { InferCoordinator } from "./infer-do";
import type { InferBody } from "./providers";

export { InferCoordinator };

type Env = {
  INFER_DO: DurableObjectNamespace;
  RELAY_SHARED_SECRET: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/infer" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    const auth = request.headers.get("Authorization") || "";
    const expected = `Bearer ${env.RELAY_SHARED_SECRET}`;
    if (!env.RELAY_SHARED_SECRET || auth !== expected) {
      return new Response("unauthorized", { status: 401 });
    }

    let body: InferBody;
    try {
      body = (await request.json()) as InferBody;
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!body.idempotency_key || !body.provider || !body.model) {
      return new Response(JSON.stringify({ ok: false, error: "missing fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = env.INFER_DO.idFromName(body.idempotency_key);
    const stub = env.INFER_DO.get(id);
    const fwd = new Request(request.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-idempotency-key": body.idempotency_key,
      },
      body: JSON.stringify(body),
    });
    return stub.fetch(fwd);
  },
};
