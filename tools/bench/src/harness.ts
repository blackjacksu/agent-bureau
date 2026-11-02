import type { BenchCorpus, BenchTask } from "./corpus.js";
import { estimateTokens } from "./corpus.js";
export interface FixturePage { url: string; html: string; links: { text: string; href: string }[] }
export interface FixtureSite { domain: string; pages: FixturePage[] }
export interface RunResult { task_id: string; arm: "A" | "B"; run: number; success: boolean; tokens: number; wall_ms: number; tool_calls: number; reached_url: string | null }
/** Arm A: raw browsing — walk fixture pages by link-text matching, paying full HTML tokens per page. */
export function runArmA(site: FixtureSite, task: BenchTask, run = 1): RunResult {
  const t0 = performance.now(); let tokens = 0, calls = 0;
  const words = task.question.toLowerCase().split(/\W+/).filter(Boolean);
  let page = site.pages[0]!; tokens += estimateTokens(page.html); calls++;
  const seen = new Set<string>([page.url]);
  for (let hop = 0; hop < 5; hop++) {
    if (page.url.includes(task.expected_url_pattern)) break;
    const next = page.links.map((l) => ({ l, s: words.filter((w) => l.text.toLowerCase().includes(w) || l.href.toLowerCase().includes(w)).length })).sort((a, b) => b.s - a.s)[0]?.l;
    if (!next || seen.has(next.href)) break;
    seen.add(next.href); page = site.pages.find((p) => p.url === next.href) ?? page; tokens += estimateTokens(page.html); calls++;
  }
  return { task_id: task.id, arm: "A", run, success: page.url.includes(task.expected_url_pattern), tokens, wall_ms: Math.max(0, performance.now() - t0), tool_calls: calls, reached_url: page.url };
}
/** Arm B: mapped — consume compact find steps (injected finder), paying only step tokens. */
export async function runArmB(task: BenchTask, run: number, finder: (domain: string, question: string) => Promise<{ found: boolean; steps?: unknown[]; result_url_template?: string | null }>): Promise<RunResult> {
  const t0 = performance.now();
  const r = await finder(task.domain, task.question);
  const text = JSON.stringify(r.steps ?? []);
  const reached = r.result_url_template ?? (r.found ? task.expected_url_pattern : null);
  return { task_id: task.id, arm: "B", run, success: !!r.found && !!reached && reached.includes(task.expected_url_pattern), tokens: estimateTokens(text + task.question), wall_ms: Math.max(0, performance.now() - t0), tool_calls: 1 + (r.steps?.length ?? 0), reached_url: reached };
}
export async function runBench(corpus: BenchCorpus, sites: Map<string, FixtureSite>, finder: Parameters<typeof runArmB>[2], runs = 5): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const task of corpus.tasks) {
    const site = sites.get(task.domain); if (!site) throw new Error(`bench: no fixture site for ${task.domain}`);
    for (let run = 1; run <= runs; run++) { out.push(runArmA(site, task, run)); out.push(await runArmB(task, run, finder)); }
  }
  return out;
}
export function median(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; }
