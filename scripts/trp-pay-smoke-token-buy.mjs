#!/usr/bin/env node
/** Mainnet: ICRC-2 approve + trp_pay.buy_credits_token(pack, symbol) for current dfx identity. */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";

const NET = process.env.DFX_NETWORK || "ic";
const HOST = NET === "ic" ? "https://icp-api.io" : "http://127.0.0.1:4943";
const PAY =
  process.env.TRP_PAY_CANISTER_ID ||
  "ujwwi-hiaaa-aaaao-bbrha-cai";
const PACK_INDEX = Number(process.env.PACK_INDEX ?? "5");
const SYMBOL = process.env.SYMBOL || "ckBTC";

const TOKEN_LEDGERS = {
  ckBTC: "mxzaz-hqaaa-aaaar-qaada-cai",
  ckETH: "ss2fx-dyaaa-aaaar-qacoq-cai",
  ckUSDC: "xevnm-gaaaa-aaaar-qafnq-cai",
};

function loadPlainIdentity(name) {
  const pemPath = join(homedir(), ".config", "dfx", "identity", name, "identity.pem");
  return Secp256k1KeyIdentity.fromPem(readFileSync(pemPath, "utf8"));
}

const ledgerIdl = ({ IDL }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  return IDL.Service({
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc2_approve: IDL.Func(
      [
        IDL.Record({
          from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
          spender: Account,
          amount: IDL.Nat,
          expires_at: IDL.Opt(IDL.Nat64),
          fee: IDL.Opt(IDL.Nat),
          memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
          created_at_time: IDL.Opt(IDL.Nat64),
        }),
      ],
      [
        IDL.Variant({
          Ok: IDL.Nat,
          Err: IDL.Variant({ GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }),
        }),
      ],
      [],
    ),
  });
};

const payIdl = ({ IDL }) => {
  const QuoteOk = IDL.Record({
    ts: IDL.Nat64,
    token_amount: IDL.Nat,
    icp_value_e8s: IDL.Nat64,
  });
  return IDL.Service({
    quote_token: IDL.Func(
      [IDL.Nat32, IDL.Text],
      [IDL.Variant({ Ok: QuoteOk, Err: IDL.Text })],
      [],
    ),
    buy_credits_token: IDL.Func(
      [IDL.Nat32, IDL.Text],
      [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
      [],
    ),
    credit_balance: IDL.Func([IDL.Principal], [IDL.Nat64], ["query"]),
    get_convert_config: IDL.Func(
      [],
      [
        IDL.Record({
          auto_convert_enabled: IDL.Bool,
          slippage_bps: IDL.Nat16,
        }),
      ],
      ["query"],
    ),
  });
};

const ledgerText = TOKEN_LEDGERS[SYMBOL];
if (!ledgerText) {
  console.error(`Unknown SYMBOL=${SYMBOL}; use ckBTC, ckETH, or ckUSDC`);
  process.exit(2);
}

const identityName = process.env.DFX_IDENTITY || "ic_deploy_plain";
const identity = loadPlainIdentity(identityName);
const agent = await HttpAgent.create({ host: HOST, identity });
const pay = Actor.createActor(payIdl, {
  agent,
  canisterId: Principal.fromText(PAY),
});
const ledger = Actor.createActor(ledgerIdl, {
  agent,
  canisterId: Principal.fromText(ledgerText),
});

const caller = identity.getPrincipal();
console.log("caller:", caller.toText());
console.log("pack:", PACK_INDEX, "symbol:", SYMBOL);

const cc = await pay.get_convert_config();
console.log("auto_convert_enabled:", cc.auto_convert_enabled);

const before = await pay.credit_balance(caller);
console.log("credits before:", before.toString());

const q = await pay.quote_token(PACK_INDEX, SYMBOL);
if ("Err" in q) {
  console.error("quote_token failed:", q.Err);
  process.exit(1);
}
console.log("quote:", q.Ok);

const fee = BigInt(await ledger.icrc1_fee());
const tokenAmt = BigInt(q.Ok.token_amount);
const need = tokenAmt + fee;
const acct = { owner: caller, subaccount: [] };
const bal = await ledger.icrc1_balance_of(acct);
console.log("token balance:", bal.toString(), "need:", need.toString());
if (bal < need) {
  console.error("Insufficient token balance");
  process.exit(2);
}

const approveRes = await ledger.icrc2_approve({
  from_subaccount: [],
  spender: { owner: Principal.fromText(PAY), subaccount: [] },
  amount: need,
  expires_at: [],
  fee: [],
  memo: [],
  created_at_time: [],
});
if ("Err" in approveRes) {
  console.error("approve failed", approveRes);
  process.exit(1);
}
console.log("approve block", approveRes.Ok.toString());

const buy = await pay.buy_credits_token(PACK_INDEX, SYMBOL);
if ("Err" in buy) {
  console.error("buy_credits_token failed", buy.Err);
  process.exit(1);
}
const after = await pay.credit_balance(caller);
console.log("buy OK, credits after:", after.toString(), "(delta", Number(after - before), ")");
