#!/usr/bin/env node
/** Chunked GGUF upload to llama_cpp_qwen25 (onicai file_upload_chunk). */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/llama_cpp_qwen25/llama_cpp_qwen25.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const CHUNK = 2_000_000;
const CANISTER_FILE = "models/model.gguf";
const HF_SHA =
  "ca59ca7f13d0e15a8cfa77bd17e65d24f6844b554a7b6c12e07a5f89ff76844e";

const modelPath =
  process.argv[2] ||
  join(root, "tmp/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf");

const NET = process.env.DFX_NETWORK || "local";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${NET}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();

const bytes = readFileSync(modelPath);
const hash = createHash("sha256").update(bytes).digest("hex");
if (hash !== HF_SHA) {
  throw new Error(`SHA-256 mismatch: ${hash} != ${HF_SHA}`);
}
console.log("local sha256 OK", hash, "bytes", bytes.length);

const canisterId = dfx("canister id llama_cpp_qwen25");
const whoami = dfx("identity whoami");
const pem = execSync(`dfx identity export ${whoami}`, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
});
const identity = Secp256k1KeyIdentity.fromPem(pem);
const host =
  process.env.DFX_HOST || (NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:8000");
const agent = new HttpAgent({ host, identity });
console.log("upload identity", whoami, "network", NET, "host", host);
if (NET !== "ic") {
  await agent.fetchRootKey();
}
const llama = Actor.createActor(idlFactory, { agent, canisterId });

const health = await llama.health();
console.log("health", health);

let offset = 0;
const prior = await llama.uploaded_file_details({ filename: CANISTER_FILE });
const priorOk = prior?.Ok ?? prior?.ok;
if (priorOk?.filesize != null) {
  const fs = Number(priorOk.filesize);
  if (fs > 0 && fs < bytes.length) {
    offset = fs;
    console.log("resuming upload at offset", offset, `(${((offset / bytes.length) * 100).toFixed(1)}%)`);
  } else if (fs >= bytes.length) {
    console.log("file already complete on canister", fs);
    offset = bytes.length;
  }
}
let i = Math.floor(offset / CHUNK);
while (offset < bytes.length) {
  const chunk = bytes.subarray(offset, offset + CHUNK);
  const res = await llama.file_upload_chunk({
    filename: CANISTER_FILE,
    chunk: Array.from(chunk),
    chunksize: BigInt(CHUNK),
    offset: BigInt(offset),
  });
  const ok = res.Ok ?? res.ok ?? (Array.isArray(res) ? res[0]?.Ok : null);
  if (!ok && !(res && (res.Err || res.err))) {
    // variant decode: { Ok: {...} } or [ { Ok: ... } ]
  }
  const variant = res?.Ok ? res : res?.[0]?.Ok ? res[0] : res;
  if (variant.Err || variant.err) {
    throw new Error(`upload chunk ${i}: ${JSON.stringify(variant)}`);
  }
  offset += chunk.length;
  i += 1;
  if (i % 20 === 0 || offset >= bytes.length) {
    console.log(`chunk ${i} offset ${offset} (${((offset / bytes.length) * 100).toFixed(1)}%)`);
  }
}

const details = await llama.uploaded_file_details({ filename: CANISTER_FILE });
console.log("uploaded_file_details", JSON.stringify(details, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
console.log("UPLOAD DONE");
