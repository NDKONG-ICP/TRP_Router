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
  const prompt =
    process.env.PATHC_PROMPT || "a black raven on a branch, silhouette, minimal";
  const seed = BigInt(process.env.PATHC_SEED || 4242);
  const w = Number(process.env.PATHC_WIDTH || 64);
  const h = Number(process.env.PATHC_HEIGHT || 64);

  console.log(label, "begin", { w, h, seed: seed.toString() });
  const b = await a.begin({ prompt, seed, steps: 1, width: w, height: h });
  if (b.err) throw new Error(String(b.err));
  let loadCalls = 0;
  let loadInstr = 0n;
  for (;;) {
    const st0 = await a.step(0);
    loadCalls++;
    console.log(
      label,
      "step0 load",
      JSON.stringify(st0, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (st0.err) throw new Error(String(st0.err));
    loadInstr += st0.ok.instructions;
    if (st0.ok.load_done) {
      console.log(label, "load complete", { loadCalls, loadInstr: loadInstr.toString() });
      break;
    }
    if (loadCalls > 500) throw new Error("load exceeded 500 update calls");
  }
  let genCalls = 0;
  let genInstr = 0n;
  for (;;) {
    const st1 = await a.step(1);
    genCalls++;
    console.log(
      label,
      "step1 generate",
      JSON.stringify(st1, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (st1.err) throw new Error(String(st1.err));
    genInstr += st1.ok.instructions;
    if (st1.ok.generate_done) {
      console.log(label, "generate complete", { genCalls, genInstr: genInstr.toString() });
      break;
    }
    if (genCalls > 500) throw new Error("generate exceeded 500 update calls");
  }
  const fin = await a.finish();
  console.log(label, "finish", JSON.stringify(fin, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  if (fin.err) throw new Error(String(fin.err));
  const pngRes = await a.get_png();
  if (pngRes.err) throw new Error(String(pngRes.err));
  return Buffer.from(pngRes.ok);
}

const a = await actor();
console.log("weights", (await a.weights_bytes_loaded()).toString());
console.log("status", await a.status());
const png = await runOnce(a, "run1");
const out = join(root, "tmp/onchain-0.png");
writeFileSync(out, png);
const sha = createHash("sha256").update(png).digest("hex");
console.log("Wrote", out, png.length, "sha256", sha);
const timings = await a.last_timings();
console.log("timings", JSON.stringify(timings, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
writeFileSync(
  join(root, "tmp/onchain-timings.json"),
  JSON.stringify({ png_sha256: sha, png_bytes: png.length, timings }, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  ),
);

const png2 = await runOnce(a, "run2");
const sha2 = createHash("sha256").update(png2).digest("hex");
console.log("deterministic", sha === sha2, "sha2", sha2);
