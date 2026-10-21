#!/usr/bin/env node
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dfx = (cmd) =>
  execSync(`dfx ${cmd}`, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const stake = dfx('canister call router_canister dev_exercise_m6_stake "(10_000_000_000 : nat)"');
if (stake === "(0 : nat)") throw new Error("stake should accrue credits");
console.log("M6 stake credits OK", stake.trim());

const fee = dfx("canister call router_canister dev_exercise_m6_byok '(true)'");
if (!fee.includes("0")) throw new Error("BYOK should zero fee bps");
console.log("M6 BYOK OK", fee.trim());

const holder = dfx("canister call router_canister dev_exercise_m6_holder '(3 : nat32)'");
if (!holder.includes("true")) throw new Error("holder free tier consume failed");
console.log("M6 holder tier OK");
console.log("M6 PASS");
