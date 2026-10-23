#!/usr/bin/env node
/**
 * Compare two PATHCPAR1 blobs (stage-aligned, max-abs-diff per tensor record).
 * Usage: node parity_compare.mjs host.pathc canister.pathc [--stage 1]
 */
import { readFileSync } from "fs";

const STAGE_NAMES = {
  0: "meta",
  1: "cond_crossattn",
  2: "uncond_crossattn",
  3: "cond_vector",
  4: "uncond_vector",
  10: "x_t",
  11: "sigma0",
  12: "unet_cond",
  13: "unet_uncond",
  20: "vae_rgb",
};

function parseBlob(buf) {
  if (buf.length < 16) throw new Error("file too short");
  const magic = buf.toString("utf8", 0, 8);
  if (magic !== "PATHCPAR") throw new Error(`bad magic: ${magic}`);
  const version = buf.readUInt32LE(8);
  const count = buf.readUInt32LE(12);
  if (version !== 1) throw new Error(`unsupported version ${version}`);
  const records = new Map();
  let off = 16;
  for (let i = 0; i < count && off + 40 <= buf.length; i++) {
    const stage = buf.readUInt32LE(off);
    off += 4;
    const ndim = buf.readUInt32LE(off);
    off += 4;
    const dims = [];
    for (let d = 0; d < 8; d++) {
      const v = Number(buf.readBigInt64LE(off));
      off += 8;
      if (d < ndim) dims.push(v);
    }
    const nbytes = buf.readUInt32LE(off);
    off += 4;
    if (off + nbytes > buf.length) break;
    const payload = buf.subarray(off, off + nbytes);
    off += nbytes;
    if (stage === 0) {
      records.set(stage, { stage, meta: payload.toString("utf8") });
      continue;
    }
    if (nbytes % 4 !== 0) continue;
    const f32 = new Float32Array(
      payload.buffer,
      payload.byteOffset,
      nbytes / 4
    );
    records.set(stage, { stage, dims, f32 });
  }
  return records;
}

function maxAbsDiff(a, b) {
  if (a.length !== b.length) {
    return { ok: false, reason: `length ${a.length} vs ${b.length}` };
  }
  let max = 0;
  let idx = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  return { ok: true, max, idx };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: parity_compare.mjs <host.pathc> <canister.pathc> [--stage N]");
    process.exit(2);
  }
  const hostPath = args[0];
  const chainPath = args[1];
  let onlyStage = null;
  const si = args.indexOf("--stage");
  if (si >= 0 && args[si + 1]) onlyStage = Number(args[si + 1]);

  const A = parseBlob(readFileSync(hostPath));
  const B = parseBlob(readFileSync(chainPath));

  const metaA = A.get(0)?.meta ?? "";
  const metaB = B.get(0)?.meta ?? "";
  if (metaA || metaB) {
    console.log("--- meta (host) ---\n" + metaA);
    console.log("--- meta (canister) ---\n" + metaB);
  }

  const stages = new Set([...A.keys(), ...B.keys()]);
  stages.delete(0);
  const sorted = [...stages].sort((x, y) => x - y);
  let failed = false;
  for (const stage of sorted) {
    if (onlyStage != null && stage !== onlyStage) continue;
    const name = STAGE_NAMES[stage] ?? `stage_${stage}`;
    const ra = A.get(stage);
    const rb = B.get(stage);
    if (!ra || !rb) {
      console.log(`${name}: MISSING host=${!!ra} canister=${!!rb}`);
      failed = true;
      continue;
    }
    const cmp = maxAbsDiff(ra.f32, rb.f32);
    if (!cmp.ok) {
      console.log(`${name}: ${cmp.reason}`);
      failed = true;
      continue;
    }
    const shape = ra.dims.join("x");
    console.log(
      `${name} [${shape}] max_abs_diff=${cmp.max.toExponential(6)} @index=${cmp.idx}`
    );
    if (cmp.max > 1e-5) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main();
