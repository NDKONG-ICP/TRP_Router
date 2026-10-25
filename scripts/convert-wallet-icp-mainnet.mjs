#!/usr/bin/env node
/**
 * DEPRECATED — DO NOT RUN ON MAINNET.
 * Used wrong CMC subaccount encoding (block 39627835); see DFINITY-ICP-RECOVERY-SUPPORT.md.
 * Use NNS (II) → cycles wallet → Convert ICP to cycles, or dfx ledger top-up only.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { createHash } from "crypto";

const NET = process.env.DFX_NETWORK || "ic";
const HOST = NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:8000";
const WALLET = Principal.fromText(
  process.env.CYCLES_WALLET || "daf6l-jyaaa-aaaao-a4nba-cai",
);
const LEDGER = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const CMC = Principal.fromText("rkp4c-7iaaa-aaaaa-aaaca-cai");
const MEMO_TOP_UP = 1347768404n;
const FEE_E8S = 10000n;
const ICP_AMOUNT = process.env.ICP_CONVERT_AMOUNT || "7.29";

function loadIdentity() {
  const id = process.env.DFX_IDENTITY || "ic_deploy_plain";
  const pem = readFileSync(
    join(homedir(), ".config", "dfx", "identity", id, "identity.pem"),
    "utf8",
  );
  return Secp256k1KeyIdentity.fromPem(pem);
}

function accountIdentifier(principal, subaccount) {
  const sub = subaccount ?? Buffer.alloc(32);
  const blob = Buffer.concat([
    Buffer.from([0x0a]),
    principal.toUint8Array(),
    sub.length === 32 ? sub : Buffer.alloc(32),
  ]);
  const hash = createHash("sha224").update(blob).digest();
  const crc = crc32(hash);
  const out = Buffer.alloc(32);
  out.writeUInt32BE(crc, 0);
  hash.copy(out, 4);
  return out;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function icpToE8s(s) {
  const [w, f = ""] = String(s).trim().split(".");
  const frac = (f + "00000000").slice(0, 8);
  return BigInt(w) * 100000000n + BigInt(frac);
}

const walletIdl = ({ IDL: I }) =>
  I.Service({
    wallet_call: I.Func(
      [
        I.Record({
          canister: I.Principal,
          method_name: I.Text,
          args: I.Vec(I.Nat8),
          cycles: I.Nat64,
        }),
      ],
      [I.Vec(I.Nat8)],
      [],
    ),
  });

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

const cmcNotifyIdl = IDL.Service({
  notify_top_up: IDL.Func(
    [IDL.Record({ canister_id: IDL.Principal, block_index: IDL.Nat64 })],
    [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
    [],
  ),
});

async function main() {
  const identity = loadIdentity();
  const agent = new HttpAgent({ host: HOST, identity });
  if (NET === "ic") await agent.fetchRootKey();

  const wallet = Actor.createActor(walletIdl, { agent, canisterId: WALLET });
  const amountE8s = icpToE8s(ICP_AMOUNT);
  if (amountE8s <= FEE_E8S) throw new Error("amount too small");

  const toAccount = accountIdentifier(CMC, subaccountFromPrincipal(WALLET));
  const transferArgs = {
    memo: MEMO_TOP_UP,
    amount: { e8s: amountE8s - FEE_E8S * 2n },
    fee: { e8s: FEE_E8S },
    from_subaccount: [[]],
    to: Array.from(toAccount),
    created_at_time: [],
  };
  let transferArgBytes;
  try {
    transferArgBytes = new Uint8Array(
      IDL.encode([TransferArgs], [transferArgs]),
    );
  } catch (e) {
    throw new Error("encode transfer: " + (e.message || e));
  }

  console.log("wallet_call ledger.transfer for", ICP_AMOUNT, "ICP (TPUP)…");
  let callRes;
  try {
    callRes = await wallet.wallet_call({
    canister: LEDGER,
    method_name: "transfer",
    args: Array.from(transferArgBytes),
    cycles: 0n,
    });
  } catch (e) {
    throw new Error("wallet_call: " + (e.message || e));
  }
  const [blockRes] = IDL.decode([TransferResult], new Uint8Array(callRes));
  if ("Err" in blockRes) throw new Error("ledger transfer: " + JSON.stringify(blockRes.Err));
  const blockIndex = blockRes.Ok;
  console.log("ledger block index", blockIndex.toString());

  const notifyArgs = new Uint8Array(
    IDL.encode(
      [IDL.Record({ canister_id: IDL.Principal, block_index: IDL.Nat64 })],
      [{ canister_id: WALLET, block_index: blockIndex }],
    ),
  );
  console.log("wallet_call CMC.notify_top_up…");
  const notifyCall = await wallet.wallet_call({
    canister: CMC,
    method_name: "notify_top_up",
    args: Array.from(notifyArgs),
    cycles: 0n,
  });
  let notifyRes;
  try {
    [notifyRes] = IDL.decode(
      [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
      new Uint8Array(notifyCall),
    );
  } catch {
    [notifyRes] = IDL.decode([IDL.Nat64], new Uint8Array(notifyCall));
    notifyRes = { Ok: notifyRes };
  }
  if ("Err" in notifyRes) throw new Error("CMC notify: " + notifyRes.Err);
  console.log("minted cycles:", notifyRes.Ok.toString());
  console.log("WALLET ICP CONVERT OK");
}

function subaccountFromPrincipal(p) {
  const buf = Buffer.alloc(32);
  const bytes = p.toUint8Array();
  buf.set(bytes, 0);
  return buf;
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
