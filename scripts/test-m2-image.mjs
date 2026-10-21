#!/usr/bin/env node
/** M2: POST /v1/images/generations (zero keys → Pollinations) + moderation block */
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
  execSync(cmd, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const host = process.env.DFX_HOST || "http://127.0.0.1:8000";
const routerId = dfx("dfx canister id router_canister");
const blobId = dfx("dfx canister id blob_store");

dfx(`dfx canister call router_canister init_router "(principal \\"${blobId}\\")"`);

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
    http_request: I.Func([HttpRequest], [HttpResponse], ["query"]),
  });

const agent = new HttpAgent({ host });
await agent.fetchRootKey();
const router = Actor.createActor(idlFactory, { agent, canisterId: routerId });

const blockBody = JSON.stringify({ prompt: "csam test", model: "trp/image-standard" });
const blockRes = await router.http_request_update({
  method: "POST",
  url: "/v1/images/generations",
  headers: [],
  body: Array.from(Buffer.from(blockBody)),
});
const blockJson = JSON.parse(Buffer.from(blockRes.body).toString());
if (Number(blockRes.status_code) === 200) {
  throw new Error("moderation should block disallowed prompt");
}
console.log("M4 moderation block OK", blockJson.error?.slice(0, 60));

const genBody = JSON.stringify({
  prompt: "TRP router smoke test red chili pepper still life",
  model: "trp/image-standard",
  size: "1024x1024",
});
const genRes = await router.http_request_update({
  method: "POST",
  url: "/v1/images/generations",
  headers: [],
  body: Array.from(Buffer.from(genBody)),
});
const genText = Buffer.from(genRes.body).toString();
writeFileSync(join(tmp, "m2-image-response.json"), genText);
if (Number(genRes.status_code) !== 200) {
  throw new Error(`image gen failed ${genRes.status_code}: ${genText}`);
}
const genJson = JSON.parse(genText);
const blobPath = genJson.data?.[0]?.url;
const provider = genJson.provider;
if (!blobPath?.startsWith("/blob/")) {
  throw new Error(`missing blob url: ${genText.slice(0, 300)}`);
}
console.log("M2 image OK provider", provider, "url", blobPath);

const statusRes = await router.http_request({
  method: "GET",
  url: "/v1/status",
  headers: [],
  body: [],
});
const status = JSON.parse(Buffer.from(statusRes.body).toString());
writeFileSync(join(tmp, "m2-status.json"), JSON.stringify(status, null, 2));
console.log("status providers", status.providers?.map((p) => p.name).join(", "));

console.log("M2 PASS");
