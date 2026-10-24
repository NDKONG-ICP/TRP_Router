#!/usr/bin/env node
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const net = process.env.DFX_NETWORK || "ic";
const id = process.env.DFX_IDENTITY || "ic_deploy_plain";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${net} --identity ${id}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", TERM: "xterm-256color", DFX_WARNING: "-mainnet_plaintext_identity" },
  }).trim();

const router = dfx("canister id router_canister");
const meter = dfx("canister id trp_meter");

dfx(`canister call trp_meter init_meter "(10 : nat32, 100 : nat64)"`);
dfx(`canister call trp_meter set_router "(principal \\"${router}\\")"`);
dfx(`canister call router_canister set_trp_meter "(principal \\"${meter}\\")"`);
console.log("wired meter", meter, "↔ router", router);
