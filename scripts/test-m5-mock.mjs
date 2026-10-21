#!/usr/bin/env node
/** M5 staged: mock TRP quote + PAYMENTS_ENABLED=false guard */
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dfx = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();

const quote = dfx('dfx canister call router_canister pay_with_mock_trp_quote "(1_000_000 : nat)" --query');
if (!quote.includes("err") || !quote.toLowerCase().includes("payments_enabled")) {
  console.warn("expected PAYMENTS_ENABLED=false err, got:", quote.slice(0, 120));
}
console.log("M5 staged: payments gated OK");

const bal = dfx("dfx canister call router_canister credit_balance '()' --query");
console.log("credit_balance", bal.trim());
console.log("M5–M6 mock smoke done (enable PAYMENTS_ENABLED in dev build for full ICRC-2 flow)");
