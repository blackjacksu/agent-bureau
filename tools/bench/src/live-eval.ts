import { writeFileSync } from "node:fs";
import { loadCorpus } from "./corpus.js";
import { httpMcpFinder } from "./arms/mcp-arm.js";

/**
 * Live Arm-B evaluation (mapped arm only): found rate + expected_url_pattern hit rate + find latency.
 * Usage: MCP_BASE_URL=... AGENTMAP_API_KEY=... node dist/live-eval.js corpus/*.json [--runs 2]
 * Pattern hit = any returned step url / result_url_template contains the corpus token (string match; see arm-b report).
 */
const base = process.env.MCP_BASE_URL, key = process.env.AGENTMAP_API_KEY;
if (!base || !key) { console.error("MCP_BASE_URL and AGENTMAP_API_KEY required"); process.exit(2); }
const args = process.argv.slice(2);
const ri = args.indexOf("--runs");
const runs = ri >= 0 ? Number(args.splice(ri, 2)[1]) : 2;
if (!args.length) { console.error("at least one corpus file required"); process.exit(2); }
const tasks = args.flatMap((f) => loadCorpus(f).tasks);
const finder = httpMcpFinder(base, key);
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
type Row = { found: boolean; hit: boolean; ms: number };
const byDomain = new Map<string, Row[]>(); const warm = new Map<string, number[]>();
for (let run = 1; run <= runs; run++) {
  for (const t of tasks) {
    const t0 = performance.now(); let r: any = {};
    try { r = await finder(t.domain, t.question); } catch { r = {}; }
    const ms = performance.now() - t0;
    const urls = [r.result_url_template, ...(r.steps ?? []).map((s: any) => s?.url)].filter(Boolean).join(" ").toLowerCase();
    const row = { found: !!r.found, hit: !!r.found && urls.includes(t.expected_url_pattern.toLowerCase()), ms };
    (byDomain.get(t.domain) ?? byDomain.set(t.domain, []).get(t.domain)!).push(row);
    if (run > 1) (warm.get(t.domain) ?? warm.set(t.domain, []).get(t.domain)!).push(ms);
  }
}
const lines = [`# Live Arm-B evaluation (${new Date().toISOString().slice(0, 10)})`, "", `${tasks.length} tasks x ${runs} runs, mapped arm only (\`find\`).`, "",
  "| Domain | Calls | Found | Pattern hit | find median (all) | find median (warm) | find p95 (all) |", "| --- | --- | --- | --- | --- | --- | --- |"];
let F = 0, H = 0, N = 0;
for (const [d, rows] of byDomain) {
  const f = rows.filter((r) => r.found).length, h = rows.filter((r) => r.hit).length; F += f; H += h; N += rows.length;
  const ms = rows.map((r) => r.ms);
  lines.push(`| ${d} | ${rows.length} | ${f} (${Math.round(100 * f / rows.length)}%) | ${h} (${Math.round(100 * h / rows.length)}%) | ${pct(ms, .5).toFixed(0)} ms | ${pct(warm.get(d) ?? ms, .5).toFixed(0)} ms | ${pct(ms, .95).toFixed(0)} ms |`);
}
lines.push(`| **Total** | ${N} | ${F} (${Math.round(100 * F / N)}%) | ${H} (${Math.round(100 * H / N)}%) | | | |`);
const out = `docs/bench/${new Date().toISOString().slice(0, 10)}-live-eval.md`;
writeFileSync(out, lines.join("\n") + "\n"); console.log(lines.join("\n")); console.log(`wrote ${out}`);
