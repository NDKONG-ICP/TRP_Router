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

let apiKey = process.env.TRP_PLAYGROUND_API_KEY;
if (!apiKey) {
  apiKey = "trp_pg_" + randomBytes(18).toString("hex");
  console.log("generated TRP_PLAYGROUND_API_KEY (save for ui config.js):", apiKey);
}
const escaped = apiKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
dfx(`canister call router_canister register_playground_api_key "(\\"${escaped}\\")"`);
console.log("register_playground_api_key OK");

const cfgPath = join(root, "ui-mockup", "config.js");
const routerId = dfx("canister id router_canister");
const body = `window.TRP_PLAYGROUND = {
  routerPostUrl: "https://${routerId}.icp0.io/v1",
  routerCanisterId: "${routerId}",
  apiKey: "${apiKey}",
  diffusionCanisterId: "${diffusion}",
  diffusionModuleSha: "2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a",
};
`;
import { writeFileSync } from "fs";
writeFileSync(cfgPath, body);
console.log("wrote", cfgPath);
