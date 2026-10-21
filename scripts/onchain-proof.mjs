#!/usr/bin/env node
/** Direct on-chain inference proof (llama_cpp_qwen25). */
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/llama_cpp_qwen25/llama_cpp_qwen25.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, "tmp");
mkdirSync(tmp, { recursive: true });

const dfx = (cmd) =>
  execSync(`dfx ${cmd}`, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const whoami = dfx("identity whoami");
const pem = execSync(`dfx identity export ${whoami}`, { cwd: root, encoding: "utf8" });
const identity = Secp256k1KeyIdentity.fromPem(pem);
const canisterId = dfx("canister id llama_cpp_qwen25");
const agent = new HttpAgent({
  host: process.env.DFX_HOST || "http://127.0.0.1:8000",
  identity,
});
await agent.fetchRootKey();
const llama = Actor.createActor(idlFactory, { agent, canisterId });

const prompt =
  "<|im_start|>system\nYou are a helpful assistant.\n" +
  "<|im_start|>user\nSay hello in 5 words.\n" +
  "<|im_start|>assistant\n";

const baseArgs = [
  "--prompt-cache",
  "prompt.cache",
  "--prompt-cache-all",
  "--cache-type-k",
  "q8_0",
  "--repeat-penalty",
  "1.1",
  "--temp",
  "0.6",
  "-sp",
];

function unwrap(res) {
  if (res?.Ok) return res.Ok;
  if (res?.Err) throw new Error(JSON.stringify(res.Err));
  throw new Error(JSON.stringify(res));
}

let calls = 0;
let output = "";

// Ingest prompt in slices until prompt_remaining empty
let ingestPrompt = prompt;
while (ingestPrompt.length > 0) {
  calls += 1;
  const r = unwrap(
    await llama.run_update({
      args: [...baseArgs, "-p", ingestPrompt, "-n", "1"],
    }),
  );
  ingestPrompt = r.prompt_remaining || "";
  if (r.output) output += r.output;
  if (calls > 50) throw new Error("ingest loop limit");
}

// Generate tokens until EOG
while (true) {
  calls += 1;
  const r = unwrap(
    await llama.run_update({
      args: [...baseArgs, "-p", "", "-n", "512"],
    }),
  );
  if (r.output) output += r.output;
  if (r.generated_eog) break;
  if (calls > 80) break;
}

await llama.remove_prompt_cache({ args: ["--prompt-cache", "prompt.cache"] });

const transcript = [
  `canister_id=${canisterId}`,
  `model=trp/onchain-qwen-0.5b (Qwen2.5-0.5B-Instruct q8_0)`,
  `update_calls=${calls}`,
  `completion=${JSON.stringify(output.trim())}`,
].join("\n");

writeFileSync(join(tmp, "onchain-proof.txt"), transcript);
console.log(transcript);
if (!output.trim()) {
  throw new Error("empty on-chain completion");
}
console.log("ONCHAIN PROOF OK");
