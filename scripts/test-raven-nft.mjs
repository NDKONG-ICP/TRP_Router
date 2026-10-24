// End-to-end smoke test: generate a real Raven Diffusion image via the router,
// mint it as an ICRC-7 NFT on raven_nft, then verify ownership, metadata, and
// that the image is served over HTTP. Runs against mainnet.
//
//   node scripts/test-raven-nft.mjs
//
// Uses a fresh (non-admin) identity to exercise the real self-mint path.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { IDL } from "@dfinity/candid";

const NFT_CANISTER = "62oay-tiaaa-aaaao-bbq7a-cai";
const HOST = "https://icp-api.io";

// ── read playground config (router url, api key, module sha) ──
const cfgText = readFileSync(new URL("../ui-mockup/config.js", import.meta.url), "utf8");
function cfg(key) {
  const m = cfgText.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
  return m ? m[1] : null;
}
const routerPostUrl = cfg("routerPostUrl");
const apiKey = cfg("apiKey");
const moduleSha = cfg("diffusionModuleSha");

// ── candid interface (subset) ──
const idlFactory = ({ IDL }) => {
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const Value = IDL.Rec();
  Value.fill(
    IDL.Variant({
      Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8),
      Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
    })
  );
  const MintRequest = IDL.Record({
    prompt: IDL.Text, seed: IDL.Nat64, module_hash: IDL.Text,
    sha256: IDL.Text, image: IDL.Vec(IDL.Nat8), to: IDL.Opt(Account),
  });
  const MintResult = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text });
  return IDL.Service({
    mint: IDL.Func([MintRequest], [MintResult], []),
    icrc7_total_supply: IDL.Func([], [IDL.Nat], ["query"]),
    icrc7_owner_of: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Vec(IDL.Opt(Account))], ["query"]),
    icrc7_token_metadata: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Vec(IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, Value))))], ["query"]),
    icrc7_tokens_of: IDL.Func([Account, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)], [IDL.Vec(IDL.Nat)], ["query"]),
  });
};

async function main() {
  const prompt = "a black raven on a branch, silhouette, minimal";
  const seed = 4242;

  console.log("1) generate on-chain via router…");
  const res = await fetch(routerPostUrl + "/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-oc-api-key": apiKey },
    body: JSON.stringify({ model: "raven-diffusion", prompt, seed }),
  });
  if (!res.ok) throw new Error("generate failed: " + res.status + " " + (await res.text()).slice(0, 200));
  const j = await res.json();
  const row = j.data[0];
  const b64 = row.b64_json;
  const claimedSha = row.sha256;
  const image = Buffer.from(b64, "base64");
  const localSha = createHash("sha256").update(image).digest("hex");
  console.log(`   bytes=${image.length} sha256=${localSha} (router claim: ${claimedSha}) match=${localSha === claimedSha}`);

  console.log("2) mint NFT (fresh non-admin identity)…");
  const identity = Secp256k1KeyIdentity.generate();
  const owner = identity.getPrincipal().toText();
  const agent = await HttpAgent.create({ identity, host: HOST });
  const actor = Actor.createActor(idlFactory, { agent, canisterId: NFT_CANISTER });
  const mintRes = await actor.mint({
    prompt, seed: BigInt(seed), module_hash: moduleSha, sha256: localSha,
    image: Array.from(image), to: [],
  });
  if ("Err" in mintRes) throw new Error("mint failed: " + mintRes.Err);
  const tokenId = mintRes.Ok;
  console.log(`   minted token #${tokenId} to ${owner}`);

  console.log("3) verify ownership + metadata + supply…");
  const supply = await actor.icrc7_total_supply();
  const ownerOf = await actor.icrc7_owner_of([tokenId]);
  const meta = await actor.icrc7_token_metadata([tokenId]);
  const ownerPrincipal = ownerOf[0][0].owner.toText();
  console.log(`   total_supply=${supply}  owner_of(#${tokenId})=${ownerPrincipal}  ownerMatch=${ownerPrincipal === owner}`);
  const metaPairs = meta[0][0].map(([k, v]) => [k, Object.values(v)[0]]);
  console.log("   metadata:");
  for (const [k, v] of metaPairs) console.log(`     ${k}: ${String(v).slice(0, 80)}`);

  console.log("4) fetch the on-chain image over HTTP…");
  const imgUrl = `https://${NFT_CANISTER}.raw.icp0.io/token/${tokenId}.png`;
  const imgRes = await fetch(imgUrl);
  const imgBytes = Buffer.from(await imgRes.arrayBuffer());
  const servedSha = createHash("sha256").update(imgBytes).digest("hex");
  console.log(`   ${imgUrl}\n   status=${imgRes.status} ct=${imgRes.headers.get("content-type")} bytes=${imgBytes.length} shaMatch=${servedSha === localSha}`);

  const ok = localSha === claimedSha && ownerPrincipal === owner && servedSha === localSha && imgRes.status === 200;
  console.log(ok ? "\nRAVEN NFT OK ✅" : "\nRAVEN NFT FAILED ❌");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
