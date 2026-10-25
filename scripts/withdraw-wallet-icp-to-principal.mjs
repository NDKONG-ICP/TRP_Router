#!/usr/bin/env node
/**
 * Withdraw ICP from cycles wallet ledger balance → a recipient AccountIdentifier
 * (e.g. your II principal's default ledger account).
 *
 * Usage:
 *   II_PRINCIPAL=ucw6l-... node scripts/withdraw-wallet-icp-to-principal.mjs
 *   ICP_AMOUNT=7.29 (optional, default 7.29)
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { HttpAgent } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

const HOST = "https://icp0.io";
const WALLET = Principal.fromText(
  process.env.CYCLES_WALLET || "daf6l-jyaaa-aaaao-a4nba-cai",
);
const LEDGER = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const TO_PRINCIPAL = Principal.fromText(
  process.env.II_PRINCIPAL ||
    "ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe",
);
const ICP_AMOUNT = process.env.ICP_AMOUNT || "7.29";
const FEE_E8S = 10000n;

function loadIdentity() {
  const id = process.env.DFX_IDENTITY || "ic_deploy_plain";
  const pem = readFileSync(
    join(homedir(), ".config", "dfx", "identity", id, "identity.pem"),
    "utf8",
  );
  return Secp256k1KeyIdentity.fromPem(pem);
}

function accountIdentifierForPrincipal(principalText) {
  const hex = execSync(
    `dfx ledger account-id --of-principal ${principalText} --network ic`,
    {
      encoding: "utf8",
      env: { ...process.env, DFX_WARNING: "-mainnet_plaintext_identity" },
    },
  ).trim();
  return Buffer.from(hex, "hex");
}

function icpToE8s(s) {
  const [w, f = ""] = String(s).trim().split(".");
  const frac = (f + "00000000").slice(0, 8);
  return BigInt(w) * 100000000n + BigInt(frac);
}

const Tokens = IDL.Record({ e8s: IDL.Nat64 });
const TransferArgs = IDL.Record({
  memo: IDL.Nat64,
  amount: Tokens,
  fee: Tokens,
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: IDL.Vec(IDL.Nat8),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const TransferError = IDL.Variant({
  BadFee: IDL.Record({ expected_fee: Tokens }),
  InsufficientFunds: IDL.Record({ balance: Tokens }),
  TxTooOld: IDL.Record({ allowed_window_nanos: IDL.Nat64 }),
  TxCreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  TxDuplicate: IDL.Record({ duplicate_of: IDL.Nat64 }),
});
const TransferResult = IDL.Variant({ Ok: IDL.Nat64, Err: TransferError });

const WalletCallArg = IDL.Record({
  canister: IDL.Principal,
  method_name: IDL.Text,
  args: IDL.Vec(IDL.Nat8),
  cycles: IDL.Nat64,
});

async function walletCall(agent, record) {
  const arg = IDL.encode([WalletCallArg], [record]);
  try {
    const response = await agent.call(WALLET, {
      methodName: "wallet_call",
      arg,
      effectiveCanisterId: WALLET,
    });
    if (response.status !== "replied") {
      throw new Error(
        "wallet_call failed: " +
          JSON.stringify({
            status: response.status,
            reject_code: response.reject_code,
            reject_message: response.reject_message,
          }),
      );
    }
    return new Uint8Array(response.reply);
  } catch (e) {
    throw new Error("wallet_call: " + (e.message || JSON.stringify(e)));
  }
}

async function main() {
  const identity = loadIdentity();
  const agent = new HttpAgent({ host: HOST, identity });
  await agent.fetchRootKey();

  const toAccount = accountIdentifierForPrincipal(TO_PRINCIPAL.toText());
  console.log("Recipient principal:", TO_PRINCIPAL.toText());
  console.log("Recipient account-id:", toAccount.toString("hex"));

  const amountE8s = icpToE8s(ICP_AMOUNT);
  const sendE8s = amountE8s - FEE_E8S;
  if (sendE8s <= 0n) throw new Error("amount too small after fee");

  const transferArgs = {
    memo: 0n,
    amount: { e8s: sendE8s },
    fee: { e8s: FEE_E8S },
    from_subaccount: [],
    to: Array.from(toAccount),
    created_at_time: [],
  };
  const transferArgBytes = IDL.encode([TransferArgs], [transferArgs]);

  console.log("Withdrawing", ICP_AMOUNT, "ICP via wallet_call → ledger.transfer …");
  const reply = await walletCall(agent, {
    canister: LEDGER,
    method_name: "transfer",
    args: Array.from(new Uint8Array(transferArgBytes)),
    cycles: 0n,
  });
  const [blockRes] = IDL.decode([TransferResult], reply);
  if ("Err" in blockRes) {
    throw new Error("ledger transfer: " + JSON.stringify(blockRes.Err));
  }
  console.log("OK — ledger block index", blockRes.Ok.toString());
  console.log("ICP should appear on II account within ~1 minute.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
