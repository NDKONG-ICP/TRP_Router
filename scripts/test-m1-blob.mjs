#!/usr/bin/env node
/**
 * M1 acceptance: chunked upload >3 MiB, commit with SHA-256, read back via get_chunk + http_request.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash, randomBytes } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, "tmp");
mkdirSync(tmp, { recursive: true });

const CHUNK = 1_900_000;
const SIZE = 3_200_000;
const data = randomBytes(SIZE);
const hash = createHash("sha256").update(data).digest("hex");
writeFileSync(join(tmp, "m1-upload.bin"), data);

const dfx = (cmd) =>
  execSync(cmd, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).trim();

const canisterId = dfx("dfx canister id blob_store");
const host = process.env.DFX_HOST || "http://127.0.0.1:8000";

const BlobKind = IDL.Variant({
  Image: IDL.Null,
  Model: IDL.Null,
  Preset: IDL.Null,
  Reference: IDL.Null,
  Dataset: IDL.Null,
  Other: IDL.Null,
});

const idlFactory = ({ IDL: I }) => {
  const NewUpload = I.Record({
    content_type: I.Text,
    total_size: I.Nat64,
    kind: BlobKind,
    filename: I.Opt(I.Text),
  });
  const UploadProgress = I.Record({
    upload_id: I.Text,
    received: I.Nat64,
    chunks: I.Nat32,
  });
  const CommitResult = I.Variant({
    ok: I.Record({
      id: I.Text,
      content_type: I.Text,
      size: I.Nat64,
      kind: BlobKind,
      filename: I.Opt(I.Text),
      owner: I.Principal,
      created_at: I.Nat64,
      chunk_size: I.Nat32,
      chunk_count: I.Nat32,
    }),
    err: I.Text,
  });
  const HeaderField = I.Tuple(I.Text, I.Text);
  const HttpRequest = I.Record({
    method: I.Text,
    url: I.Text,
    headers: I.Vec(HeaderField),
    body: I.Vec(I.Nat8),
  });
  const StreamingCallbackResponse = I.Record({
    token: I.Opt(
      I.Record({ id: I.Text, index: I.Nat32 }),
    ),
    body: I.Vec(I.Nat8),
  });
  const StreamingStrategy = I.Variant({
    Callback: I.Record({
      token: I.Record({ id: I.Text, index: I.Nat32 }),
      callback: I.Func([I.Record({ id: I.Text, index: I.Nat32 })], [StreamingCallbackResponse], [
        "query",
      ]),
    }),
  });
  const HttpResponse = I.Record({
    status_code: I.Nat16,
    headers: I.Vec(HeaderField),
    body: I.Vec(I.Nat8),
    streaming_strategy: I.Opt(StreamingStrategy),
  });
  const StreamingToken = I.Record({ id: I.Text, index: I.Nat32 });
  return I.Service({
    begin_upload: I.Func([NewUpload], [I.Text], []),
    put_chunk: I.Func([I.Text, I.Nat32, I.Vec(I.Nat8)], [UploadProgress], []),
    commit_upload: I.Func([I.Text, I.Text], [CommitResult], []),
    get_chunk: I.Func([I.Text, I.Nat32], [I.Opt(I.Vec(I.Nat8))], ["query"]),
    http_request: I.Func([HttpRequest], [HttpResponse], ["query"]),
    http_request_streaming_callback: I.Func([StreamingToken], [StreamingCallbackResponse], [
      "query",
    ]),
  });
};

const agent = new HttpAgent({ host });
await agent.fetchRootKey();

const blobStore = Actor.createActor(idlFactory, {
  agent,
  canisterId,
});

const uploadId = await blobStore.begin_upload({
  content_type: "application/octet-stream",
  total_size: BigInt(SIZE),
  kind: { Other: null },
  filename: ["m1.bin"],
});

console.log("upload_id", uploadId);

let idx = 0;
for (let off = 0; off < data.length; off += CHUNK) {
  const slice = data.subarray(off, off + CHUNK);
  const progress = await blobStore.put_chunk(uploadId, idx, Array.from(slice));
  console.log("put_chunk", idx, "received", progress.received.toString());
  idx += 1;
}

const commit = await blobStore.commit_upload(uploadId, hash);
if ("err" in commit) {
  throw new Error(`commit failed: ${commit.err}`);
}
if (commit.ok.id !== hash) {
  throw new Error(`blob id mismatch: ${commit.ok.id} vs ${hash}`);
}
console.log("committed", commit.ok.id);

const assembled = Buffer.alloc(SIZE);
let chunkIndex = 0;
while (assembled.length > chunkIndex * CHUNK || chunkIndex === 0) {
  const opt = await blobStore.get_chunk(hash, chunkIndex);
  if (!opt || opt.length === 0) break;
  const chunk = Buffer.from(opt[0]);
  chunk.copy(assembled, chunkIndex * CHUNK);
  if (chunk.length < CHUNK) break;
  chunkIndex += 1;
}
if (!assembled.equals(data)) {
  throw new Error("get_chunk reassembly mismatch");
}
console.log("get_chunk OK", SIZE, "bytes");

const httpRes = await blobStore.http_request({
  method: "GET",
  url: `/blob/${hash}`,
  headers: [],
  body: [],
});
if (Number(httpRes.status_code) !== 200) {
  throw new Error(`http_request status ${httpRes.status_code}`);
}
const stratOpt = httpRes.streaming_strategy;
const strat = Array.isArray(stratOpt) ? stratOpt[0] : stratOpt;
if (!strat?.Callback) {
  throw new Error("expected streaming_strategy for >2 MiB blob");
}
const httpParts = [Buffer.from(httpRes.body)];
let token = strat.Callback.token;
while (token) {
  const cb = await blobStore.http_request_streaming_callback(token);
  httpParts.push(Buffer.from(cb.body));
  const next = cb.token;
  token = Array.isArray(next) ? next[0] : next;
}
const httpBody = Buffer.concat(httpParts);
if (!httpBody.equals(data)) {
  throw new Error(`http_request stream mismatch: ${httpBody.length} vs ${data.length}`);
}
console.log("http_request + streaming_callback OK", httpBody.length, "bytes");

writeFileSync(join(tmp, "m1-pass.json"), JSON.stringify({ hash, size: SIZE }, null, 2));
console.log("M1 PASS: hash", hash);
