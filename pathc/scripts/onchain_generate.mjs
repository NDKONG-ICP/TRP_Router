#!/usr/bin/env node
import { createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { idlFactory } from "../src/declarations/diffusion_canister/diffusion_canister.did.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const NET = process.env.DFX_NETWORK || "local";

const MAX_LOAD_STEPS = Number(process.env.PATHC_MAX_LOAD_STEPS || 5000);
const MAX_GEN_STEPS = Number(process.env.PATHC_MAX_GEN_STEPS || 5000);
const CALL_TIMEOUT_MS = Number(process.env.PATHC_CALL_TIMEOUT_MS || 600_000);
const RETRIES = Number(process.env.PATHC_CALL_RETRIES || 8);
const RETRY_DELAY_MS = Number(process.env.PATHC_RETRY_DELAY_MS || 3000);
/** bit0=full_graph, bit1=v_prediction, bit8=Euler ancestral (default plain Euler) */
const DEBUG_FLAGS = Number(process.env.PATHC_DEBUG_FLAGS || 0);

function readEnvPathc() {
  const p = join(root, ".env.pathc");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=['"]?([^'"]+)['"]?/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function defaultIdentityName() {
  const cfg = join(homedir(), ".config/dfx/identity.json");
  if (existsSync(cfg)) {
    try {
      return JSON.parse(readFileSync(cfg, "utf8")).default;
    } catch {
      /* ignore */
    }
  }
  return "default";
}

function loadIdentityPem() {
  const name = process.env.DFX_IDENTITY || defaultIdentityName();
  const pemPath = join(homedir(), ".config/dfx/identity", name, "identity.pem");
  if (!existsSync(pemPath)) {
    throw new Error(`Missing identity PEM: ${pemPath}`);
  }
  return readFileSync(pemPath, "utf8");
}

async function actor() {
  const envFile = readEnvPathc();
  const canisterId =
    process.env.CANISTER_ID_DIFFUSION_CANISTER ||
    envFile.CANISTER_ID_DIFFUSION_CANISTER;
  if (!canisterId) throw new Error("Missing CANISTER_ID in .env.pathc");
  const pem = loadIdentityPem();
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const host =
    process.env.DFX_HOST ||
    (NET === "ic" ? "https://icp0.io" : "http://127.0.0.1:4943");
  const agent = new HttpAgent({
    host,
    identity,
    callOptions: { timeout: CALL_TIMEOUT_MS },
  });
  if (NET !== "ic") await agent.fetchRootKey();
  return Actor.createActor(idlFactory, { agent, canisterId });
}

function isTransient(err) {
  const s = String(err?.message || err || "");
  return (
    /timeout/i.test(s) ||
    /503|502|504|429/i.test(s) ||
    /connection/i.test(s) ||
    /unexpected/i.test(s)
  );
}

async function callWithRetry(label, fn) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (!isTransient(e) && !/call begin first/i.test(msg)) {
        throw e;
      }
      console.warn(label, `retry ${i + 1}/${RETRIES}:`, msg.slice(0, 200));
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw last;
}

function aggregateTimings(timings) {
  const byStage = {};
  if (!timings?.stage) return byStage;
  const stages = timings.stage;
  const n = stages.length;
  for (let i = 0; i < n; i++) {
    const stage = stages[i];
    const instr = BigInt(
      timings.instructions?.[i] ?? timings.instructions?.[String(i)] ?? 0,
    );
    const slices = Number(
      timings.update_calls?.[i] ?? timings.update_calls?.[String(i)] ?? 0,
    );
    if (!byStage[stage]) {
      byStage[stage] = { instructions: 0n, graph_slices: 0, update_calls: 0 };
    }
    byStage[stage].instructions += instr;
    byStage[stage].graph_slices += slices;
    byStage[stage].update_calls += 1;
  }
  return byStage;
}

function appendBenchmarksMarkdown({ w, h, genCalls, loadCalls, byStage, pngSha, pngBytes }) {
  const benchPath = join(root, "BENCHMARKS.md");
  const lines = [
    "",
    `### On-chain run ${new Date().toISOString().slice(0, 10)} (${w}×${h})`,
    "",
    "| phase | instructions (sum) | graph node slices (sum) | step(1) or step(0) updates |",
    "|-------|-------------------:|------------------------:|-----------------------------:|",
  ];
  for (const key of Object.keys(byStage).sort()) {
    const row = byStage[key];
    lines.push(
      `| ${key} | ${row.instructions.toString()} | ${row.graph_slices} | ${row.update_calls} |`,
    );
  }
  lines.push(
    "",
    `- **load** \`step(0)\` update calls: **${loadCalls}**`,
    `- **generate** \`step(1)\` update calls: **${genCalls}**`,
  );
  if (pngSha) {
    lines.push(`- PNG bytes: **${pngBytes}**, SHA-256: \`${pngSha}\``);
  }
  lines.push("");
  appendFileSync(benchPath, lines.join("\n"));
  console.log("Appended benchmark rows to", benchPath);
}

async function runOnce(a, label) {
  const prompt =
    process.env.PATHC_PROMPT || "a black raven on a branch, silhouette, minimal";
  const seed = BigInt(process.env.PATHC_SEED || 4242);
  const w = Number(process.env.PATHC_WIDTH || 16);
  const h = Number(process.env.PATHC_HEIGHT || 16);
  const steps = Number(process.env.PATHC_STEPS || 1);

  console.log(label, "begin (single session — do not upgrade canister mid-run)", {
    w,
    h,
    steps,
    seed: seed.toString(),
    maxGenSteps: MAX_GEN_STEPS,
    debug_flags: DEBUG_FLAGS,
  });
  const b = await callWithRetry(`${label} begin`, () =>
    a.begin({ prompt, seed, steps, width: w, height: h, debug_flags: DEBUG_FLAGS }),
  );
  if (b.err) throw new Error(String(b.err));

  let loadCalls = 0;
  let loadInstr = 0n;
  for (;;) {
    const st0 = await callWithRetry(`${label} step0`, () => a.step(0));
    loadCalls++;
    console.log(
      label,
      "step0 load",
      JSON.stringify(st0, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (st0.err) throw new Error(String(st0.err));
    loadInstr += st0.ok.instructions;
    if (st0.ok.load_done) {
      console.log(label, "load complete", { loadCalls, loadInstr: loadInstr.toString() });
      break;
    }
    if (loadCalls > MAX_LOAD_STEPS) {
      throw new Error(`load exceeded ${MAX_LOAD_STEPS} update calls`);
    }
  }

  let genCalls = 0;
  let genInstr = 0n;
  for (;;) {
    const st1 = await callWithRetry(`${label} step1`, () => a.step(1));
    genCalls++;
    console.log(
      label,
      "step1 generate",
      JSON.stringify(st1, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (st1.err) {
      const msg = String(st1.err);
      if (/call begin first/i.test(msg)) {
        throw new Error(
          `${msg} — session lost (canister upgrade/trap?). Do not dfx install during generate.`,
        );
      }
      throw new Error(msg);
    }
    genInstr += st1.ok.instructions;
    if (st1.ok.generate_done) {
      console.log(label, "generate complete", { genCalls, genInstr: genInstr.toString() });
      break;
    }
    if (genCalls > MAX_GEN_STEPS) {
      throw new Error(`generate exceeded ${MAX_GEN_STEPS} update calls`);
    }
  }

  const fin = await callWithRetry(`${label} finish`, () => a.finish());
  console.log(label, "finish", JSON.stringify(fin, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  if (fin.err) throw new Error(String(fin.err));
  const pngRes = await callWithRetry(`${label} get_png`, () => a.get_png());
  if (pngRes.err) throw new Error(String(pngRes.err));
  const png = Buffer.from(pngRes.ok);
  const timings = await a.last_timings();
  return { png, genCalls, loadCalls, timings, w, h };
}

const a = await actor();
console.log("weights", (await a.weights_bytes_loaded()).toString());
console.log("status", await a.status());

const { png, genCalls, loadCalls, timings, w, h } = await runOnce(a, "run1");
const out = join(root, "tmp/onchain-0.png");
writeFileSync(out, png);
const sha = createHash("sha256").update(png).digest("hex");
console.log("Wrote", out, png.length, "sha256", sha);
console.log("timings", JSON.stringify(timings, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const byStage = aggregateTimings(timings);
console.log("aggregated", JSON.stringify(byStage, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
writeFileSync(
  join(root, "tmp/onchain-timings.json"),
  JSON.stringify({ png_sha256: sha, png_bytes: png.length, genCalls, loadCalls, byStage, timings }, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  ),
);
appendBenchmarksMarkdown({ w, h, genCalls, loadCalls, byStage, pngSha: sha, pngBytes: png.length });

if (process.env.PATHC_SKIP_RUN2 !== "1") {
  const { png: png2 } = await runOnce(a, "run2");
  const sha2 = createHash("sha256").update(png2).digest("hex");
  console.log("deterministic", sha === sha2, "sha2", sha2);
} else {
  console.log("PATHC_SKIP_RUN2=1 — skipped determinism run2");
}
