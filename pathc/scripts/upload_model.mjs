#!/usr/bin/env node
/** Chunked GGUF + TAESD upload via @dfinity/agent (avoids dfx argv limits). */
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const CHUNK = 1_900_000;

const NET = process.env.DFX_NETWORK || "local";
function readEnvPathc() {
  const p = join(root, ".env.pathc");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=['"]?([^'"]+)['"]?/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function defaultIdentityName() {
  const cfg = join(homedir(), ".config/dfx/identity.json");
  if (existsSync(cfg)) {
    try {
      return JSON.parse(readFileSync(cfg, "utf8")).default;
    } catch {
      /* ignore */
    }
  }
  return "default";
}

function loadIdentityPem() {
  const name = process.env.DFX_IDENTITY || defaultIdentityName();
  const pemPath = join(homedir(), ".config/dfx/identity", name, "identity.pem");
  if (!existsSync(pemPath)) {
    throw new Error(`Missing identity PEM: ${pemPath} (set DFX_IDENTITY)`);
  }
  return readFileSync(pemPath, "utf8");
}

async function agentActor() {
  const envFile = readEnvPathc();
  const canisterId =
    process.env.CANISTER_ID_DIFFUSION_CANISTER ||
    envFile.CANISTER_ID_DIFFUSION_CANISTER;
  if (!canisterId) {
    throw new Error("Set CANISTER_ID in pathc/.env.pathc (run dfx deploy once)");
  }
  const pem = loadIdentityPem();
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const host =
    process.env.DFX_HOST ||
    (NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:4943");
  const agent = new HttpAgent({ host, identity });
  if (NET !== "ic") await agent.fetchRootKey();
  return { actor: Actor.createActor(idlFactory, { agent, canisterId }), canisterId };
}

async function uploadFile(actor, method, path, resumeFrom = 0n) {
  const bytes = readFileSync(path);
  console.log(`Upload ${path} (${bytes.length} bytes) -> ${method}`);
  let offset = Number(resumeFrom);
  if (offset > 0) {
    console.log(`  resuming at offset ${offset}`);
  }
  let i = Math.floor(offset / CHUNK);
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
const wOff = await actor.weights_bytes_loaded();
const tOff = await actor.taesd_bytes_loaded();
await uploadFile(actor, "upload_weights_chunk", model, wOff);
try {
  await uploadFile(actor, "upload_taesd_chunk", taesd, tOff);
} catch (e) {
  console.warn("TAESD upload skipped or failed:", e.message);
}
console.log("weights_bytes_loaded", (await actor.weights_bytes_loaded()).toString());
console.log("taesd_bytes_loaded", (await actor.taesd_bytes_loaded()).toString());
console.log("UPLOAD DONE");
