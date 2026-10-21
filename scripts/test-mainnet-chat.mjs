#!/usr/bin/env node
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const ROUTER = process.env.TRP_ROUTER_CANISTER_ID || "5723t-oaaaa-aaaao-bbquq-cai";

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

const agent = new HttpAgent({ host: "https://icp0.io" });
const router = Actor.createActor(idlFactory, { agent, canisterId: ROUTER });

const body = JSON.stringify({
  model: "trp/onchain-qwen-0.5b",
  messages: [{ role: "user", content: "Say hello in 5 words" }],
});

const res = await router.http_request_update({
  method: "POST",
  url: "/v1/chat/completions",
  headers: [["X-TRP-On-Chain", "true"]],
  body: Array.from(Buffer.from(body)),
});

const sse = Buffer.from(res.body).toString();
console.log("status", res.status_code);
if (Number(res.status_code) !== 200) {
  console.log(sse.slice(0, 400));
  process.exit(1);
}
let text = "";
for (const line of sse.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const p = line.slice(6).trim();
  if (p === "[DONE]") continue;
  try {
    const j = JSON.parse(p);
    text += j.choices?.[0]?.delta?.content || "";
  } catch {
    /* ignore */
  }
}
console.log("completion", JSON.stringify(text.trim()));
if (!text.trim()) process.exit(1);
console.log("MAINNET ONCHAIN CHAT OK");
