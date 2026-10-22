#!/usr/bin/env node
/** Status without dfx (dfx color panic workaround). */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env.pathc"), "utf8");
const canisterId = env.match(/CANISTER_ID_DIFFUSION_CANISTER='([^']+)'/)?.[1];
const host = process.env.DFX_HOST || "http://127.0.0.1:4943";
const agent = new HttpAgent({ host });
await agent.fetchRootKey();
const a = Actor.createActor(idlFactory, { agent, canisterId });
console.log("host", host, "canister", canisterId);
console.log("status", await a.status());
console.log("weights", (await a.weights_bytes_loaded()).toString());
console.log("taesd", (await a.taesd_bytes_loaded()).toString());
