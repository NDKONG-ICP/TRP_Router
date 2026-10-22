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
const env = readFileSync(join(root, ".env.pathc"), "utf8");
const canisterId = env.match(/CANISTER_ID_DIFFUSION_CANISTER='([^']+)'/)[1];
const pem = readFileSync(
  join(homedir(), ".config/dfx/identity/ic_deploy_plain/identity.pem"),
  "utf8",
);
const agent = new HttpAgent({
  host: "http://127.0.0.1:4943",
  identity: Secp256k1KeyIdentity.fromPem(pem),
});
await agent.fetchRootKey();
const a = Actor.createActor(idlFactory, { agent, canisterId });

await a.begin({
  prompt: "load-only",
  seed: 0n,
  steps: 1,
  width: 64,
  height: 64,
});

let calls = 0;
let totalInstr = 0n;
while (calls < 500) {
  const r = await a.step(0);
  calls++;
  if (r.err) throw new Error(String(r.err));
  const ok = r.ok;
  totalInstr += ok.instructions;
  console.log(
    `step0 #${calls} load_done=${ok.load_done} tensors=${ok.tensors_this_call} instr=${ok.instructions} wall_ms=${ok.wall_ms}`,
  );
  if (ok.load_done) {
    console.log("LOAD COMPLETE", { calls, totalInstr: totalInstr.toString() });
    break;
  }
}
