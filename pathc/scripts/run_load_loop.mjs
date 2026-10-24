#!/usr/bin/env node
/** Call step(0) until load_done or error. */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NET = process.env.DFX_NETWORK || "local";
const envPath = join(root, ".env.pathc");
const env = readFileSync(envPath, "utf8");
const canisterId =
  process.env.CANISTER_ID_DIFFUSION_CANISTER ||
  env.match(/CANISTER_ID_DIFFUSION_CANISTER='([^']+)'/)?.[1];
if (!canisterId) throw new Error("Set CANISTER_ID_DIFFUSION_CANISTER");
const idName = process.env.DFX_IDENTITY || "ic_deploy_plain";
const pem = readFileSync(
  join(homedir(), ".config/dfx/identity", idName, "identity.pem"),
  "utf8",
);
const host =
  process.env.DFX_HOST ||
  (NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:4943");
const agent = new HttpAgent({
  host,
  identity: Secp256k1KeyIdentity.fromPem(pem),
});
if (NET !== "ic") await agent.fetchRootKey();
const a = Actor.createActor(idlFactory, { agent, canisterId });

if (process.env.PATHC_SKIP_BEGIN !== "1") {
  await a.begin({
    prompt: "load-only",
    seed: 0n,
    steps: 1,
    width: 64,
    height: 64,
    debug_flags: Number(process.env.PATHC_DEBUG_FLAGS || 0),
  });
} else {
  console.log("PATHC_SKIP_BEGIN=1 — resume load with step(0) only");
}

const CAP = 40_000_000_000n;
let calls = 0;
let totalInstr = 0n;
let maxInstr = 0n;
let totalWall = 0n;
let prevLoadedTotal = null;
let stallCount = 0;

while (calls < 3000) {
  const r = await a.step(0);
  calls++;
  if (r.err) throw new Error(String(r.err));
  const ok = r.ok;
  totalInstr += ok.instructions;
  totalWall += ok.wall_ms;
  if (ok.instructions > maxInstr) maxInstr = ok.instructions;
  if (ok.instructions > CAP) {
    throw new Error(`step(0) exceeded 40B cap: ${ok.instructions}`);
  }

  const loadedTotal = Number(ok.tensors_loaded_total ?? 0);
  const total = Number(ok.tensors_total ?? 0);
  if (prevLoadedTotal !== null && loadedTotal === prevLoadedTotal && !ok.load_done) {
    stallCount++;
    if (stallCount >= 3) {
      throw new Error(
        `load stalled: tensors_loaded_total stuck at ${loadedTotal}/${total} for ${stallCount} calls`,
      );
    }
  } else {
    stallCount = 0;
  }
  prevLoadedTotal = loadedTotal;

  const gguf = Number(ok.gguf_tensors ?? 0);
  console.log(
    `step0 #${calls} load_done=${ok.load_done} this_call=${ok.tensors_this_call} eager=${loadedTotal}/${total} gguf=${gguf} instr=${ok.instructions} wall_ms=${ok.wall_ms}`,
  );
  if (ok.load_done) {
    console.log("LOAD COMPLETE", {
      calls,
      totalInstr: totalInstr.toString(),
      maxInstr: maxInstr.toString(),
      totalWallMs: totalWall.toString(),
      under40B: maxInstr <= CAP,
      tensors_total: total,
    });
    break;
  }
}
if (calls >= 3000) {
  throw new Error("load exceeded 3000 update calls without load_done");
}
