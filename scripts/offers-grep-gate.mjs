#!/usr/bin/env node
// Plan 16.6.4 CI grep-gate: affiliate_url_template writes only inside packages/offers.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.argv[2] ?? process.cwd();
const skip = new Set(["node_modules", ".git", "dist"]);
const hits = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (skip.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|js|mjs|sql)$/.test(e)) {
      const rel = relative(root, p);
      if (rel.startsWith("packages/offers/") || rel === "scripts/offers-grep-gate.mjs") continue;
      const text = readFileSync(p, "utf8");
      text.split("\n").forEach((line, i) => { if (/affiliate_url_template/.test(line) && /(INSERT|UPDATE|SET\s|=\s|:\s)/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`); });
    }
  }
}
walk(root);
if (hits.length) { console.error("offers grep-gate FAILED (affiliate_url_template write outside packages/offers):\n" + hits.join("\n")); process.exit(1); }
console.log("offers grep-gate passed");
