#!/usr/bin/env node
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dfx = (cmd) =>
  execSync(`dfx ${cmd}`, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const gated = dfx('canister call router_canister pay_with_mock_trp_quote "(1_000_000 : nat)" --query');
if (!gated.includes("PAYMENTS_ENABLED")) {
  throw new Error("expected production gate on pay_with_mock_trp_quote");
}
console.log("M5 gate OK");

const stale = dfx('canister call router_canister dev_exercise_m5_stale_oracle "(1_000_000 : nat)"');
if (!stale.toLowerCase().includes("stale")) {
  throw new Error(`expected stale oracle err: ${stale}`);
}
console.log("M5 fail-closed oracle OK");

const live = dfx(
  "canister call router_canister dev_exercise_m5_oracle '(100_000 : nat, 100_000_000 : nat)'",
);
if (!live.includes("ok")) throw new Error(`oracle quote failed: ${live}`);
console.log("M5 quote math OK", live.split("\n")[0]);
console.log("M5 PASS");
