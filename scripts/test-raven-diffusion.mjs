#!/usr/bin/env node
/** Smoke POST /v1/images/generations model=raven-diffusion (slow on mainnet). */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = join(root, "ui-mockup", "config.js");
const ROUTER =
  process.env.TRP_ROUTER_CANISTER_ID ||
  (existsSync(cfgPath)
    ? readFileSync(cfgPath, "utf8").match(/routerCanisterId:\s*"([^"]+)"/)?.[1]
    : null) ||
  "5723t-oaaaa-aaaao-bbquq-cai";

const apiKey =
  process.env.TRP_PLAYGROUND_API_KEY ||
  (existsSync(cfgPath)
    ? readFileSync(cfgPath, "utf8").match(/apiKey:\s*"([^"]+)"/)?.[1]
    : null);

if (!apiKey) {
  console.error("Set TRP_PLAYGROUND_API_KEY or run wire-raven-diffusion.mjs first");
  process.exit(1);
}

const host = process.env.DFX_HOST || "https://icp0.io";
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
  upgrade: IDL.Opt(IDL.Bool),
});

const idlFactory = ({ IDL: I }) =>
  I.Service({
    http_request_update: I.Func([HttpRequest], [HttpResponse], []),
  });

const agent = new HttpAgent({ host });
const router = Actor.createActor(idlFactory, { agent, canisterId: ROUTER });

const body = JSON.stringify({
  model: "raven-diffusion",
  prompt: process.env.PATHC_PROMPT || "a black raven on a branch, silhouette, minimal",
  seed: Number(process.env.PATHC_SEED || 4242),
});

console.log("router", ROUTER, "generating (may take ~30–120s)…");
const t0 = Date.now();
const res = await router.http_request_update({
  method: "POST",
  url: "/v1/images/generations",
  headers: [["Authorization", `Bearer ${apiKey}`]],
  body: Array.from(Buffer.from(body)),
});

const text = Buffer.from(res.body).toString();
console.log("status", res.status_code, "elapsed_s", ((Date.now() - t0) / 1000).toFixed(1));
if (Number(res.status_code) !== 200) {
  console.log(text.slice(0, 800));
  process.exit(1);
}
const j = JSON.parse(text);
const row = j.data?.[0];
console.log("sha256", row?.sha256);
console.log("canister", row?.canister);
console.log("b64_len", row?.b64_json?.length);
console.log("RAVEN DIFFUSION OK");
