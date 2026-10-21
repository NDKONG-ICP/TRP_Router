#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const net = process.env.DFX_NETWORK || "ic";
const dfx = (cmd) =>
  execSync(`dfx ${cmd} --network ${net}`, { cwd: root, encoding: "utf8" }).trim();

const envPath = join(root, ".env");
if (!existsSync(envPath)) {
  console.log("no .env — skip");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const opt = (v) => (v ? `(opt "${String(v).replace(/"/g, '\\"')}")` : "null");
if (env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_API_TOKEN || env.GEMINI_API_KEY) {
  dfx(
    `canister call router_canister set_provider_keys "(${opt(env.CLOUDFLARE_ACCOUNT_ID)}, ${opt(env.CLOUDFLARE_API_TOKEN)}, ${opt(env.GEMINI_API_KEY)})"`,
  );
}
if (env.GROQ_API_KEY || env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY) {
  dfx(
    `canister call router_canister set_chat_vault_keys "(${opt(env.GROQ_API_KEY)}, ${opt(env.OPENROUTER_API_KEY)}, ${opt(env.ANTHROPIC_API_KEY)})"`,
  );
}
console.log("vault keys applied (values not logged)");
