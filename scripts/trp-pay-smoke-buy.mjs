#!/usr/bin/env node
/** Mainnet: ICRC-2 approve + trp_pay.buy_credits(0) for current dfx identity. */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";

const NET = process.env.DFX_NETWORK || "ic";
const HOST = NET === "ic" ? "https://icp-api.io" : "http://127.0.0.1:4943";
const LEDGER = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const PAY =
  process.env.TRP_PAY_CANISTER_ID ||
  "ujwwi-hiaaa-aaaao-bbrha-cai";

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

const payIdl = ({ IDL }) =>
  IDL.Service({
    quote: IDL.Func(
      [],
      [
        IDL.Vec(
          IDL.Record({
            index: IDL.Nat32,
            icp_e8s: IDL.Nat64,
            credits: IDL.Nat64,
          }),
        ),
      ],
      ["query"],
    ),
    buy_credits: IDL.Func(
      [IDL.Nat32],
      [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
      [],
    ),
    get_config: IDL.Func(
      [],
      [
        IDL.Record({
          payments_enabled: IDL.Bool,
          cycles_slice_e8s: IDL.Nat64,
        }),
      ],
      ["query"],
    ),
  });

const identityName = process.env.DFX_IDENTITY || "ic_deploy_plain";
const identity = loadPlainIdentity(identityName);
const agent = await HttpAgent.create({ host: HOST, identity });
const ledger = Actor.createActor(ledgerIdl, { agent, canisterId: LEDGER });
const pay = Actor.createActor(payIdl, {
  agent,
  canisterId: Principal.fromText(PAY),
});

const cfg = await pay.get_config();
console.log("trp_pay config:", cfg);

const acct = { owner: identity.getPrincipal(), subaccount: [] };
const bal = await ledger.icrc1_balance_of(acct);
console.log("caller balance e8s:", bal.toString());

const PACK_INDEX = Number(process.env.PACK_INDEX ?? "0");
const packs = await pay.quote();
const pack = packs.find((p) => Number(p.index) === PACK_INDEX);
if (!pack) {
  console.error(`No pack index ${PACK_INDEX} in quote()`);
  process.exit(2);
}
const packIcpE8s = BigInt(pack.icp_e8s);
const fee = BigInt(await ledger.icrc1_fee());
const need = packIcpE8s + fee;
if (bal < need) {
  console.error(
    `Need at least ${need} e8s on ${identity.getPrincipal().toText()}; have ${bal}`,
  );
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

console.log("pack", PACK_INDEX, "icp_e8s", packIcpE8s.toString());
const buy = await pay.buy_credits(PACK_INDEX);
if ("Err" in buy) {
  console.error("buy_credits failed", buy.Err);
  process.exit(1);
}
console.log("buy_credits OK, new balance", buy.Ok.toString());
