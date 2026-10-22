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

/** Candid text literal; outer shell uses single quotes so inner " are safe. */
const opt = (v) => {
  if (!v) return "null";
  const esc = String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `(opt "${esc}")`;
};

const shellArg = (candidTuple) => `'${candidTuple.replace(/'/g, `'\\''`)}'`;

if (env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_API_TOKEN || env.GEMINI_API_KEY) {
  dfx(
    `canister call router_canister set_provider_keys ${shellArg(
      `(${opt(env.CLOUDFLARE_ACCOUNT_ID)}, ${opt(env.CLOUDFLARE_API_TOKEN)}, ${opt(env.GEMINI_API_KEY)})`,
    )}`,
  );
}
if (env.GROQ_API_KEY || env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY) {
  dfx(
    `canister call router_canister set_chat_vault_keys ${shellArg(
      `(${opt(env.GROQ_API_KEY)}, ${opt(env.OPENROUTER_API_KEY)}, ${opt(env.ANTHROPIC_API_KEY)})`,
    )}`,
  );
}
console.log("vault keys applied (values not logged)");
