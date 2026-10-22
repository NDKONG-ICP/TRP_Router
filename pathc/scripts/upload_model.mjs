#!/usr/bin/env node
/** Chunked GGUF + TAESD upload via @dfinity/agent (avoids dfx argv limits). */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const CHUNK = 1_900_000;

const NET = process.env.DFX_NETWORK || "local";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${NET}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();

async function agentActor() {
  const canisterId = dfx("canister id diffusion_canister");
  const whoami = dfx("identity whoami");
  const pem = execSync(`dfx identity export ${whoami}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const host =
    process.env.DFX_HOST ||
    (NET === "ic"
      ? "https://icp0.io"
      : `http://127.0.0.1:${dfx("info webserver-port")}`);
  const agent = new HttpAgent({ host, identity });
  if (NET !== "ic") await agent.fetchRootKey();
  return { actor: Actor.createActor(idlFactory, { agent, canisterId }), canisterId };
}

async function uploadFile(actor, method, path) {
  const bytes = readFileSync(path);
  console.log(`Upload ${path} (${bytes.length} bytes) -> ${method}`);
  let offset = 0;
  let i = 0;
  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, offset + CHUNK);
    const res = await actor[method]({
      offset: BigInt(offset),
      chunk: Array.from(chunk),
    });
    const err = res.err ?? res.Err;
    if (err) throw new Error(`${method} @${offset}: ${err}`);
    offset += chunk.length;
    i += 1;
    if (i % 10 === 0 || offset >= bytes.length) {
      console.log(`  ${offset}/${bytes.length} (${((100 * offset) / bytes.length).toFixed(1)}%)`);
    }
  }
}

const model =
  process.argv[2] || join(root, "models/sd_turbo-f16-q8_0.gguf");
const taesd = process.argv[3] || join(root, "models/taesd.safetensors");

const { actor } = await agentActor();
console.log("status", await actor.status());
await uploadFile(actor, "upload_weights_chunk", model);
try {
  await uploadFile(actor, "upload_taesd_chunk", taesd);
} catch (e) {
  console.warn("TAESD upload skipped or failed:", e.message);
}
console.log("weights_bytes_loaded", (await actor.weights_bytes_loaded()).toString());
console.log("taesd_bytes_loaded", (await actor.taesd_bytes_loaded()).toString());
console.log("UPLOAD DONE");
