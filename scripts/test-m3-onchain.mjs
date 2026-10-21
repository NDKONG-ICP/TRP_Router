#!/usr/bin/env node
/** M3: POST /v1/chat/completions → trp/onchain-qwen-0.5b (real on-chain llama). */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, "tmp");
mkdirSync(tmp, { recursive: true });

const dfx = (cmd) =>
  execSync(`dfx ${cmd}`, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const blobId = dfx("canister id blob_store");
const llamaId = dfx("canister id llama_cpp_qwen25");
const routerId = dfx("canister id router_canister");

dfx(`canister call router_canister init_router "(principal \\"${blobId}\\")"`);
dfx(`canister call router_canister set_llama_qwen25 "(principal \\"${llamaId}\\")"`);

const HeaderField = IDL.Tuple(IDL.Text, IDL.Text);
const HttpRequest = IDL.Record({
  method: IDL.Text,
  url: IDL.Text,
  headers: IDL.Vec(HeaderField),
  body: IDL.Vec(IDL.Nat8),
});
const HttpResponse = IDL.Record({
  status_code: IDL.Nat16,
  headers: IDL.Vec(HeaderField),
  body: IDL.Vec(IDL.Nat8),
  streaming_strategy: IDL.Opt(IDL.Null),
});

const idlFactory = ({ IDL: I }) =>
  I.Service({
    http_request_update: I.Func([HttpRequest], [HttpResponse], []),
  });

const agent = new HttpAgent({ host: process.env.DFX_HOST || "http://127.0.0.1:8000" });
await agent.fetchRootKey();
const router = Actor.createActor(idlFactory, { agent, canisterId: routerId });

const body = JSON.stringify({
  model: "trp/onchain-qwen-0.5b",
  messages: [{ role: "user", content: "Say hello in 5 words" }],
});
const res = await router.http_request_update({
  method: "POST",
  url: "/v1/chat/completions",
  headers: [],
  body: Array.from(Buffer.from(body)),
});

const text = Buffer.from(res.body).toString();
writeFileSync(join(tmp, "m3-chat-sse.txt"), text);

if (Number(res.status_code) !== 200) {
  throw new Error(`chat failed ${res.status_code}: ${text.slice(0, 300)}`);
}
if (text.includes("on-chain onicai tier STAGED") || text.includes("503")) {
  throw new Error(`still stubbed or error: ${text.slice(0, 300)}`);
}
const ct = res.headers?.find((h) => h[0].toLowerCase() === "content-type")?.[1] || "";
if (!ct.includes("text/event-stream")) {
  throw new Error(`expected SSE content-type, got ${ct}`);
}
if (!text.includes('"delta"') || !text.includes("data:")) {
  throw new Error(`expected SSE payload: ${text.slice(0, 200)}`);
}
if (!text.match(/data:.*content/)) {
  throw new Error("empty SSE completion");
}
console.log("M3 PASS on-chain chat (SSE)", text.slice(0, 280).replace(/\n/g, " "));
