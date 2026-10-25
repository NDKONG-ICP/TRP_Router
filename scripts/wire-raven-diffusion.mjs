#!/usr/bin/env node
/** Wire Path C diffusion + playground API key on router (post-upgrade). */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const net = process.env.DFX_NETWORK || "ic";
const identity = process.env.DFX_IDENTITY || "ic_deploy_plain";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${net} --identity ${identity}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", TERM: "xterm-256color", DFX_WARNING: "-mainnet_plaintext_identity" },
  }).trim();

const diffusion =
  process.env.PATHC_DIFFUSION_CANISTER_ID || "7chv3-5iaaa-aaaao-bbq3a-cai";

dfx(`canister call router_canister set_diffusion_canister "(principal \\"${diffusion}\\")"`);
console.log("set_diffusion_canister", diffusion);

let llamaId = "5ryw3-vqaaa-aaaao-bbqvq-cai";
try {
  llamaId = dfx("canister id llama_cpp_qwen25");
} catch {
  /* default mainnet id */
}
dfx(`canister call router_canister set_llama_qwen25 "(principal \\"${llamaId}\\")"`);
console.log("set_llama_qwen25", llamaId);

let apiKey = process.env.TRP_PLAYGROUND_API_KEY;
const cfgPath = join(root, "ui-mockup", "config.js");
if (!apiKey && existsSync(cfgPath)) {
  const prev = readFileSync(cfgPath, "utf8");
  const m = prev.match(/apiKey:\s*"([^"]+)"/);
  if (m) apiKey = m[1];
}
if (!apiKey) {
  apiKey = "trp_pg_" + randomBytes(18).toString("hex");
  console.log("generated TRP_PLAYGROUND_API_KEY (save for ui config.js):", apiKey);
}
const escaped = apiKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
dfx(`canister call router_canister register_playground_api_key "(\\"${escaped}\\")"`);
console.log("register_playground_api_key OK");

try {
  const pay = dfx("canister id trp_pay");
  dfx(`canister call router_canister set_trp_pay "(principal \\"${pay}\\")"`);
  console.log("set_trp_pay", pay);
} catch {
  console.log("set_trp_pay skipped (deploy trp_pay first)");
}

const routerId = dfx("canister id router_canister");
let meterId = "6gk2j-eiaaa-aaaao-bbq5a-cai";
try {
  meterId = dfx("canister id trp_meter");
} catch {
  /* optional */
}
let payId = "";
try {
  payId = dfx("canister id trp_pay");
} catch {
  /* deploy trp_pay first */
}
const body = `window.TRP_PLAYGROUND = {
  routerPostUrl: "https://${routerId}.raw.icp0.io/v1",
  routerCanisterId: "${routerId}",
  apiKey: "${apiKey}",
  diffusionCanisterId: "${diffusion}",
  diffusionModuleSha: "d89a560af45e5a39b5e2ef1572152215b0c78c7690e3af997cb2ff780694c513",
  ravenNftCanisterId: "62oay-tiaaa-aaaao-bbq7a-cai",
  trpMeterCanisterId: "${meterId}",
  trpPayCanisterId: "${payId}",
  icpLedgerCanisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
};
`;
import { writeFileSync } from "fs";
writeFileSync(cfgPath, body);
console.log("wrote", cfgPath);
