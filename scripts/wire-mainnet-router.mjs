#!/usr/bin/env node
/** Wire http_transform + optional provider keys on mainnet router. */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const net = process.env.DFX_NETWORK || "ic";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${net}`, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();

const transformId = dfx("canister id http_transform");
dfx(`canister call router_canister set_http_transform "(principal \\"${transformId}\\")"`);
console.log("set_http_transform", transformId);

const envPath = join(root, ".env");
if (existsSync(envPath)) {
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  const cf = env.CLOUDFLARE_ACCOUNT_ID;
  const cft = env.CLOUDFLARE_API_TOKEN;
  const gem = env.GEMINI_API_KEY;
  if (cf || cft || gem) {
    const opt = (v) => (v ? `(opt "${v.replace(/"/g, '\\"')}")` : "null");
    dfx(
      `canister call router_canister set_provider_keys "(${opt(cf)}, ${opt(cft)}, ${opt(gem)})"`,
    );
    console.log("set_provider_keys OK (from .env, values not logged)");
  } else {
    console.log("no provider keys in .env — Pollinations only");
  }
} else {
  console.log("no trp-router/.env — skip provider keys");
}
