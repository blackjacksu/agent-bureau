import type { BenchCorpus, BenchTask } from "./corpus.js";
import { rawBrowse } from "./raw-arm.js";
import { crawlArm, HttpCache, type CrawlFlags } from "./arms/crawl-arm.js";
import { browserArm } from "./arms/browser-arm.js";
import { mcpArm } from "./arms/mcp-arm.js";

export type SpeedArm = "A0" | "C1" | "C2" | "B";
export interface SpeedResult {
  task_id: string; domain: string; arm: SpeedArm; run: number; cache: "cold" | "warm";
  success: boolean; found?: boolean; tokens: number; wall_ms: number; pages: number; final_url: string | null; stop_reason?: string;
}
export interface SpeedArms {
  finder: Parameters<typeof mcpArm>[2];
  renderedFetch?: import("./arms/crawl-arm.js").FetchText;
  fetchText?: import("./arms/crawl-arm.js").FetchText;
  flags?: CrawlFlags;
}

/** Judge: ONLY place expected_url_pattern is consulted. Arms never receive it. */
export const judge = (task: BenchTask, finalUrl: string | null, visited: string[] = []) =>
  !!finalUrl && [finalUrl, ...visited].join(" ").toLowerCase().includes(task.expected_url_pattern.toLowerCase());

export async function runSpeedBench(corpus: BenchCorpus, arms: SpeedArms, runs = 5): Promise<SpeedResult[]> {
  const out: SpeedResult[] = [];
  const caches = new Map<string, HttpCache>();
  for (let run = 1; run <= runs; run++) {
    for (const task of corpus.tasks) {
      const start = `https://${task.domain}/`;
      const cacheState: "cold" | "warm" = run === 1 ? "cold" : "warm";
      // Per-arm caches: sharing across arms would let C2 inherit C1's warm state and fake a cold run.
      const cacheFor = (arm: string) => {
        const k = `${arm}:${task.domain}`;
        if (!caches.has(k)) caches.set(k, new HttpCache());
        return caches.get(k)!;
      };
      // Interleaved arms per task cancels network drift.
      const a0 = await rawBrowse(start, task.question, task.expected_url_pattern, { maxSteps: 5, fetchText: arms.fetchText });
      out.push({ task_id: task.id, domain: task.domain, arm: "A0", run, cache: cacheState, success: a0.success, tokens: a0.tokens, wall_ms: a0.wall_ms, pages: a0.pages, final_url: a0.final_url, stop_reason: a0.success ? "target" : "no_match" });

      const c1 = await crawlArm(start, task.question, { fetchText: arms.fetchText, flags: arms.flags, cache: cacheFor("C1") });
      out.push({ task_id: task.id, domain: task.domain, arm: "C1", run, cache: cacheState, success: judge(task, c1.final_url, c1.visited), tokens: c1.tokens, wall_ms: c1.wall_ms, pages: c1.pages, final_url: c1.final_url, stop_reason: c1.stop_reason });

      const c2 = await browserArm(start, task.question, { fetchText: arms.fetchText, renderedFetch: arms.renderedFetch, flags: arms.flags, cache: cacheFor('C2') });
      out.push({ task_id: task.id, domain: task.domain, arm: "C2", run, cache: cacheState, success: judge(task, c2.final_url, c2.visited), tokens: c2.tokens, wall_ms: c2.wall_ms, pages: c2.pages, final_url: c2.final_url, stop_reason: c2.stop_reason });

      const b = await mcpArm(task.domain, task.question, arms.finder);
      out.push({ task_id: task.id, domain: task.domain, arm: "B", run, cache: cacheState, success: judge(task, b.final_url), found: b.found, tokens: b.tokens, wall_ms: b.wall_ms, pages: 1, final_url: b.final_url, stop_reason: b.found ? "found" : "no_path" });
    }
  }
  return out;
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const p95 = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!; };

export interface ArmSummary { arm: SpeedArm; n: number; successRate: number; medianMs: number; p95Ms: number; medianTokens: number }
export function summarize(results: SpeedResult[], filter: (r: SpeedResult) => boolean = () => true): ArmSummary[] {
  return (["A0", "C1", "C2", "B"] as SpeedArm[]).map((arm) => {
    const rs = results.filter((r) => r.arm === arm && filter(r));
    const ok = rs.filter((r) => r.success);
    return { arm, n: rs.length, successRate: rs.length ? ok.length / rs.length : 0, medianMs: median(ok.map((r) => r.wall_ms)), p95Ms: p95(ok.map((r) => r.wall_ms)), medianTokens: median(ok.map((r) => r.tokens)) };
  });
}

/** Pre-registered verdict: crawl arm wins a scope only if faster (median ms) AND success within 5pts of B. */
export function verdict(results: SpeedResult[], scope: string, filter: (r: SpeedResult) => boolean) {
  const s = summarize(results, filter);
  const b = s.find((x) => x.arm === "B")!;
  const lines = s.map((x) => {
    const wins = x.arm !== "B" && x.medianMs < b.medianMs && x.successRate >= b.successRate - 0.05;
    return `| ${scope} | ${x.arm} | ${(x.successRate * 100).toFixed(0)}% | ${x.medianMs}ms | ${x.p95Ms}ms | ${x.medianTokens} | ${x.arm === "B" ? "— (champion)" : wins ? "**WIN**" : "lose"} |`;
  });
  return lines;
}

export function renderSpeedReport(results: SpeedResult[], opts: { date?: string; note?: string } = {}): string {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const domains = [...new Set(results.map((r) => r.domain))];
  const rows: string[] = [];
  rows.push(...verdict(results, "ALL (warm)", (r) => r.cache === "warm"));
  for (const d of domains) rows.push(...verdict(results, `${d} (warm)`, (r) => r.cache === "warm" && r.domain === d));
  rows.push(...verdict(results, "ALL (cold, run 1)", (r) => r.cache === "cold"));
  const fails = results.filter((r) => !r.success);
  return `# Speed benchmark — crawl vs MCP (${date})

${opts.note ?? "Arm A0: naive greedy crawler (existing). C1: optimized HTTP crawler (sitemap/search jump, ranking v2, early stop, warm HTTP cache). C2: C1 + browser fallback. B: MCP \`find\` (champion). Win = faster median time-to-correct-result AND success within 5pts of B. Tokens = bytes/4 ingested. MCP indexing cost is amortized separately, not in per-query time."}

| scope | arm | success | median | p95 | median tokens | vs B |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

Failures: ${fails.length}/${results.length} arm-runs unsuccessful (itemized in raw results, stop_reasons preserved).
`;
}
