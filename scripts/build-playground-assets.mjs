#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "playground");
mkdirSync(out, { recursive: true });
const buildId = String(Math.floor(Date.now() / 1000));
for (const f of [
  "trp-core.js",
  "playground.js",
  "chat-panel.js",
  "models-catalog.js",
  "wallet-page.js",
]) {
  cpSync(join(root, "ui-mockup", f), join(out, f));
}
let html = readFileSync(join(root, "ui-mockup", "index.html"), "utf8");
html = html.replace(
  /<meta name="viewport"/,
  `<meta name="trp-playground-build" content="${buildId}">\n<meta name="viewport"`,
);
html = html.replace(
  /(<script src=")(config\.js|trp-core\.js|playground\.js|chat-panel\.js|models-catalog\.js|wallet-page\.js)("><\/script>)/g,
  `$1$2?v=${buildId}$3`,
);
writeFileSync(join(out, "index.html"), html);
for (const f of ["docs.html"]) {
  const p = join(root, "ui-mockup", f);
  if (existsSync(p)) cpSync(p, join(out, f));
}
const assetsSrc = join(root, "ui-mockup", "assets");
if (existsSync(assetsSrc)) {
  cpSync(assetsSrc, join(out, "assets"), { recursive: true });
}
const cfg = join(root, "ui-mockup", "config.js");
cpSync(
  existsSync(cfg) ? cfg : join(root, "ui-mockup", "config.example.js"),
  join(out, "config.js"),
);
const assetsPolicy = join(root, "ui-mockup", ".ic-assets.json5");
if (existsSync(assetsPolicy)) {
  cpSync(assetsPolicy, join(out, ".ic-assets.json5"));
}
console.log("playground assets ->", out, "build", buildId);
