#!/usr/bin/env node
/** On-chain chat proof via router (same path as M3 / mainnet SSE). */
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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

const sse = Buffer.from(res.body).toString();
if (Number(res.status_code) !== 200) {
  throw new Error(`chat failed ${res.status_code}: ${sse.slice(0, 300)}`);
}

let completion = "";
let updateCalls = 0;
for (const line of sse.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") continue;
  try {
    const j = JSON.parse(payload);
    if (j.on_chain_update_calls) updateCalls = Number(j.on_chain_update_calls);
    const delta = j.choices?.[0]?.delta?.content;
    if (delta) completion += delta;
  } catch {
    /* ignore */
  }
}

completion = completion.trim();
const transcript = [
  `router_canister=${routerId}`,
  `llama_canister=${llamaId}`,
  `model=trp/onchain-qwen-0.5b (Qwen2.5-0.5B-Instruct q8_0)`,
  `on_chain_update_calls=${updateCalls || "?"}`,
  `completion=${JSON.stringify(completion)}`,
].join("\n");

writeFileSync(join(tmp, "onchain-proof.txt"), transcript);
console.log(transcript);
if (!completion || completion.includes("<|") || completion.length > 120) {
  throw new Error(`unclean completion: ${completion.slice(0, 120)}`);
}
console.log("ONCHAIN PROOF OK");
