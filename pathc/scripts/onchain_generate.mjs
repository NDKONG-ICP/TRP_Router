#!/usr/bin/env node
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const NET = process.env.DFX_NETWORK || "local";

const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${NET}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();

async function actor() {
  const canisterId = dfx("canister id diffusion_canister");
  const whoami = dfx("identity whoami");
  const pem = execSync(`dfx identity export ${whoami}`, {
    cwd: root,
    encoding: "utf8",
  });
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const host =
    process.env.DFX_HOST ||
    (NET === "ic"
      ? "https://icp0.io"
      : `http://127.0.0.1:${dfx("info webserver-port")}`);
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
  const st = await a.step(0);
  console.log(label, "step", st);
  if (st.err) throw new Error(String(st.err));
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
