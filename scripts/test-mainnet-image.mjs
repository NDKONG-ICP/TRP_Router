#!/usr/bin/env node
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const ROUTER = process.env.TRP_ROUTER_CANISTER_ID || "5723t-oaaaa-aaaao-bbquq-cai";
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
});

const idlFactory = ({ IDL: I }) =>
  I.Service({
    http_request_update: I.Func([HttpRequest], [HttpResponse], []),
  });

const agent = new HttpAgent({ host });
const router = Actor.createActor(idlFactory, { agent, canisterId: ROUTER });

const body = JSON.stringify({
  prompt: "TRP mainnet smoke: gold raven silhouette on obsidian",
  model: "trp/flux",
  size: "512x512",
});

const res = await router.http_request_update({
  method: "POST",
  url: "/v1/images/generations",
  headers: [],
  body: Array.from(Buffer.from(body)),
});

const text = Buffer.from(res.body).toString();
console.log("status", res.status_code);
console.log(text.slice(0, 500));
if (Number(res.status_code) !== 200) process.exit(1);
const j = JSON.parse(text);
const url = j.data?.[0]?.url;
if (!url?.startsWith("/blob/")) throw new Error("missing blob url");
console.log("provider", j.provider);
console.log("blob", url);
console.log("MAINNET IMAGE OK");
