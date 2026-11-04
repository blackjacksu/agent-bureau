import { writeFileSync } from "node:fs";
import { loadCorpus, type BenchTask } from "./corpus.js";
import { mcpArm, httpMcpFinder } from "./arms/mcp-arm.js";

/**
 * Cache-vs-index benchmark: three ways the server answers the same question.
 *
 * - cold: first-seen question -> HNSW vector top-k retrieval + path
 *   composition (the index-tree path). Wipe path_cache first for a true cold.
 * - warm: exact repeat -> 60s in-memory hash-table hit (Map keyed by the raw
 *   question; no retrieval runs at all).
 * - para: reworded repeat ("please ..." prefix) -> misses the hash cache by
 *   string but hits the vector path-cache by canonical question (HNSW
 *   question-embedding lookup, no composition).
 *
 * Usage: MCP_BASE_URL=... AGENTMAP_API_KEY=... node dist/cache-main.js corpus/*.json
 */
export type CacheArm = "cold" | "warm" | "para";
export interface CacheResult {
  task_id: string; domain: string; arm: CacheArm;
  found: boolean; wall_ms: number; tokens: number;
}

export async function runCacheBench(
  tasks: BenchTask[],
  finder: (domain: string, question: string) => Promise<{ found: boolean; steps?: unknown[]; result_url_template?: string | null; rawText?: string }>,
): Promise<CacheResult[]> {
  const out: CacheResult[] = [];
  for (const t of tasks) {
    const cold = await mcpArm(t.domain, t.question, finder);
    out.push({ task_id: t.id, domain: t.domain, arm: "cold", found: cold.found, wall_ms: cold.wall_ms, tokens: cold.tokens });
    const warm = await mcpArm(t.domain, t.question, finder);
    out.push({ task_id: t.id, domain: t.domain, arm: "warm", found: warm.found, wall_ms: warm.wall_ms, tokens: warm.tokens });
    const para = await mcpArm(t.domain, `please ${t.question}`, finder);
    out.push({ task_id: t.id, domain: t.domain, arm: "para", found: para.found, wall_ms: para.wall_ms, tokens: para.tokens });
  }
  return out;
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function renderCacheReport(results: CacheResult[]): string {
  const lines = [
    `# Cache benchmark — hash-table repeat vs HNSW index retrieval (${new Date().toISOString().slice(0, 10)})`,
    "",
    "Per task: `cold` = first-seen question (HNSW top-k + compose), `warm` = exact repeat (60s in-memory hash hit), `para` = reworded repeat (hash miss by string, vector path-cache hit by canonical question).",
    "",
    "| Domain | Arm | Found | Median ms | p95-ish max ms | Median tokens |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const domains = [...new Set(results.map((r) => r.domain))];
  for (const d of [...domains, "ALL"]) {
    for (const arm of ["cold", "warm", "para"] as CacheArm[]) {
      const rs = results.filter((r) => (d === "ALL" || r.domain === d) && r.arm === arm);
      const ok = rs.filter((r) => r.found);
      lines.push(`| ${d} | ${arm} | ${ok.length}/${rs.length} | ${median(ok.map((r) => r.wall_ms)).toFixed(0)} | ${Math.max(0, ...ok.map((r) => r.wall_ms)).toFixed(0)} | ${median(ok.map((r) => r.tokens)).toFixed(0)} |`);
    }
  }
  const coldAll = median(results.filter((r) => r.arm === "cold" && r.found).map((r) => r.wall_ms));
  const warmAll = median(results.filter((r) => r.arm === "warm" && r.found).map((r) => r.wall_ms));
  const paraAll = median(results.filter((r) => r.arm === "para" && r.found).map((r) => r.wall_ms));
  const ratio = (a: number, b: number) => (a > 0 && b >= 0 ? `${(a / Math.max(b, 0.1)).toFixed(1)}x` : "n/a");
  lines.push(
    "",
    `Warm hash-table repeat is ${ratio(coldAll, warmAll)} the cold HNSW median (${coldAll.toFixed(0)} ms -> ${warmAll.toFixed(0)} ms); reworded repeat via the vector path-cache is ${ratio(coldAll, paraAll)} (${paraAll.toFixed(0)} ms). Identical answers carry identical tokens; the token saving vs raw browsing is unchanged (see the speed bench).`,
  );
  return lines.join("\n");
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const base = process.env.MCP_BASE_URL;
  const key = process.env.AGENTMAP_API_KEY;
  if (!base || !key) { console.error("MCP_BASE_URL and AGENTMAP_API_KEY required"); process.exit(2); }
  const files = process.argv.slice(2);
  if (!files.length) { console.error("at least one corpus file required"); process.exit(2); }
  const tasks = files.flatMap((f) => loadCorpus(f).tasks);
  const results = await runCacheBench(tasks, httpMcpFinder(base, key));
  const md = renderCacheReport(results);
  const out = `docs/bench/${new Date().toISOString().slice(0, 10)}-cache.md`;
  writeFileSync(out, md + "\n");
  console.log(md);
  console.log(`wrote ${out} (${results.length} arm-runs)`);
}
