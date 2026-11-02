import { readFileSync } from "node:fs";
export interface BenchTask { id: string; domain: string; question: string; expected_url_pattern: string; required_params: string[] }
export interface BenchCorpus { version: 1; site_kind: "fixture" | "real"; tasks: BenchTask[] }
export function validateCorpus(c: unknown): BenchCorpus {
  const o = c as BenchCorpus;
  if (!o || o.version !== 1 || !Array.isArray(o.tasks) || !o.tasks.length) throw new Error("corpus: version/tasks required");
  if (o.site_kind !== "fixture" && o.site_kind !== "real") throw new Error("corpus: site_kind fixture|real");
  for (const t of o.tasks) { if (!t.id || !t.domain || !t.question || !t.expected_url_pattern || !Array.isArray(t.required_params)) throw new Error(`corpus: bad task ${JSON.stringify(t)}`); }
  const ids = new Set(o.tasks.map((t) => t.id)); if (ids.size !== o.tasks.length) throw new Error("corpus: duplicate task id");
  return o;
}
export function loadCorpus(path: string): BenchCorpus { return validateCorpus(JSON.parse(readFileSync(path, "utf8"))); }
export function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
