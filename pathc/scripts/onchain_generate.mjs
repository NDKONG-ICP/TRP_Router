#!/usr/bin/env node
import { createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
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
    throw new Error(`Missing identity PEM: ${pemPath}`);
  }
  return readFileSync(pemPath, "utf8");
}

async function actor() {
  const envFile = readEnvPathc();
  const canisterId =
    process.env.CANISTER_ID_DIFFUSION_CANISTER ||
    envFile.CANISTER_ID_DIFFUSION_CANISTER;
  if (!canisterId) throw new Error("Missing CANISTER_ID in .env.pathc");
  const pem = loadIdentityPem();
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const host =
    process.env.DFX_HOST ||
    (NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:4943");
  const agent = new HttpAgent({ host, identity });
  if (NET !== "ic") await agent.fetchRootKey();
  return Actor.createActor(idlFactory, { agent, canisterId });
}

async function runOnce(a, label) {
  const prompt = process.env.PATHC_PROMPT || "a raven, pixel art";
  const seed = BigInt(process.env.PATHC_SEED || 42);
  const w = Number(process.env.PATHC_WIDTH || 128);
  const h = Number(process.env.PATHC_HEIGHT || 128);

  console.log(label, "begin");
  const b = await a.begin({ prompt, seed, steps: 1, width: w, height: h });
  if (b.err) throw new Error(String(b.err));
  const st0 = await a.step(0);
  console.log(label, "step0 load", st0);
  if (st0.err) throw new Error(String(st0.err));
  const st1 = await a.step(1);
  console.log(label, "step1 generate", st1);
  if (st1.err) throw new Error(String(st1.err));
  const fin = await a.finish();
  console.log(label, "finish", fin);
  if (fin.err) throw new Error(String(fin.err));
  const pngRes = await a.get_png();
  if (pngRes.err) throw new Error(String(pngRes.err));
  const png = Buffer.from(pngRes.ok);
  return png;
}

const a = await actor();
console.log("status", await a.status());
const png = await runOnce(a, "run1");
const out = join(root, "tmp/onchain-0.png");
writeFileSync(out, png);
console.log("Wrote", out, png.length, "sha256", createHash("sha256").update(png).digest("hex"));
console.log("timings", await a.last_timings());

const png2 = await runOnce(a, "run2");
console.log("deterministic", png.equals(png2));
