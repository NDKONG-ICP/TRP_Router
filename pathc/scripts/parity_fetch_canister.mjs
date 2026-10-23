#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadIdentityPem() {
  const name = process.env.DFX_IDENTITY || "default";
  const pemPath = join(homedir(), ".config/dfx/identity", name, "identity.pem");
  return readFileSync(pemPath, "utf8");
}

async function actor() {
  const envPath = join(root, ".env.pathc");
  let canisterId = process.env.CANISTER_ID_DIFFUSION_CANISTER;
  if (!canisterId && existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/CANISTER_ID_DIFFUSION_CANISTER=['"]?([^'"]+)/);
      if (m) canisterId = m[1];
    }
  }
  if (!canisterId) throw new Error("missing CANISTER_ID_DIFFUSION_CANISTER");
  const identity = Secp256k1KeyIdentity.fromPem(loadIdentityPem());
  const host = process.env.DFX_HOST || "http://127.0.0.1:4943";
  const agent = new HttpAgent({ host, identity });
  await agent.fetchRootKey();
  return Actor.createActor(idlFactory, { agent, canisterId });
}

const cmd = process.argv[2];
const outPath = process.argv[3];

const a = await actor();

if (cmd === "status") {
  if (typeof a.parity_status !== "function") {
    console.error("canister missing parity_status — deploy wasm with parity harness first");
    process.exit(1);
  }
  const s = await a.parity_status();
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

if (cmd !== "embeds" && cmd !== "unet") {
  console.error("Usage: parity_fetch_canister.mjs status|embeds|unet [out.pathc]");
  process.exit(2);
}

if (typeof a.get_parity_blob !== "function") {
  console.error("canister missing get_parity_blob — deploy updated wasm first");
  process.exit(1);
}

const res = await a.get_parity_blob(cmd);
if (res.err) {
  console.error(res.err);
  process.exit(1);
}
const blob = Buffer.from(res.ok);
if (!outPath) {
  process.stdout.write(blob);
} else {
  writeFileSync(outPath, blob);
  console.log(`wrote ${outPath} (${blob.length} bytes)`);
}
