#!/usr/bin/env node
/** Mainnet: 0.01 ICP CMC top-up smoke (same encoding as trp_pay payment_route). */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";

const NET = process.env.DFX_NETWORK || "ic";
const HOST = NET === "ic" ? "https://icp-api.io" : "http://127.0.0.1:4943";
const LEDGER = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const CMC = Principal.fromText("rkp4c-7iaaa-aaaaa-aaaca-cai");
const DIFFUSION = Principal.fromText(
  process.env.PATHC_DIFFUSION_CANISTER_ID || "7chv3-5iaaa-aaaao-bbq3a-cai",
);
const BURN_E8S = BigInt(process.env.SMOKE_BURN_E8S || "10000000"); // 0.01 ICP
const MEMO_TOP_UP = 1347768404n;
const FEE = 10000n;

function loadIdentity(name) {
  const pemPath = join(homedir(), ".config", "dfx", "identity", name, "identity.pem");
  return Secp256k1KeyIdentity.fromPem(readFileSync(pemPath, "utf8"));
}

function cmcTopUpSubaccount(target) {
  const sub = new Uint8Array(32);
  sub[0] = 0x0a;
  const bytes = target.toUint8Array();
  sub.set(bytes.subarray(0, Math.min(31, bytes.length)), 1);
  return sub;
}

function diffusionCycles() {
  const out = execSync(
    `dfx canister status ${DIFFUSION.toText()} --network ${NET} 2>/dev/null | grep Balance`,
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", TERM: "xterm-256color" } },
  );
  return out.trim();
}

const ledgerIdl = ({ IDL }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const TransferError = IDL.Variant({
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });
  return IDL.Service({
    icrc1_transfer: IDL.Func(
      [
        IDL.Record({
          from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
          to: Account,
          amount: IDL.Nat,
          fee: IDL.Opt(IDL.Nat),
          memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
          created_at_time: IDL.Opt(IDL.Nat64),
        }),
      ],
      [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })],
      [],
    ),
  });
};

const cmcIdl = ({ IDL }) =>
  IDL.Service({
    notify_top_up: IDL.Func(
      [IDL.Record({ canister_id: IDL.Principal, block_index: IDL.Nat64 })],
      [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })],
      [],
    ),
  });

const identityName = process.env.DFX_IDENTITY || "ic_deploy_plain";
const identity = loadIdentity(identityName);
const agent = await HttpAgent.create({ host: HOST, identity });
const ledger = Actor.createActor(ledgerIdl, { agent, canisterId: LEDGER });
const cmc = Actor.createActor(cmcIdl, { agent, canisterId: CMC });

console.log("caller", identity.getPrincipal().toText());
console.log("diffusion cycles before:", diffusionCycles());

const memo = new Uint8Array(8);
const view = new DataView(memo.buffer);
view.setBigUint64(0, MEMO_TOP_UP, true);

const transferArg = {
  from_subaccount: [],
  to: {
    owner: CMC,
    subaccount: [Array.from(cmcTopUpSubaccount(DIFFUSION))],
  },
  amount: BURN_E8S,
  fee: [FEE],
  memo: [Array.from(memo)],
  created_at_time: [],
};

const tx = await ledger.icrc1_transfer(transferArg);
if ("Err" in tx) {
  console.error("icrc1_transfer failed", tx.Err);
  process.exit(1);
}
const blockIndex = BigInt(tx.Ok);
console.log("ledger block index", blockIndex.toString());

const notify = await cmc.notify_top_up({
  canister_id: DIFFUSION,
  block_index: blockIndex,
});
if ("Err" in notify) {
  console.error("notify_top_up failed", notify.Err);
  process.exit(1);
}
console.log("notify_top_up OK, cycles minted", notify.Ok.toString());
console.log("diffusion cycles after:", diffusionCycles());
