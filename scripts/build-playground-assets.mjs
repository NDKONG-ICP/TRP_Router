#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "playground");
mkdirSync(out, { recursive: true });
for (const f of ["index.html", "playground.js"]) {
  cpSync(join(root, "ui-mockup", f), join(out, f));
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
console.log("playground assets ->", out);
