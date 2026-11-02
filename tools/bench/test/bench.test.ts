import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateCorpus } from "../src/corpus.js";
import { fixtureSites } from "../src/index.js";
import { runBench } from "../src/harness.js";
import { renderReport, evaluateGate } from "../src/report.js";
const corpus = validateCorpus(JSON.parse(readFileSync(new URL("../corpus/mini-auto-parts.json", import.meta.url), "utf8")));
describe("bench corpus + harness (18, fixture smoke)", () => {
  it("validates corpus and rejects dup ids", () => {
    expect(corpus.tasks.length).toBeGreaterThan(1);
    expect(() => validateCorpus({ version: 1, site_kind: "fixture", tasks: [...corpus.tasks, corpus.tasks[0]] })).toThrow();
  });
  it("both arms run against fixture sites, mapped uses fewer tokens, report renders", async () => {
    const finder = async (_d: string, q: string) => { const t = corpus.tasks.find((x) => x.question === q); return { found: !!t, steps: t ? [{ action: "navigate", url: t.expected_url_pattern }] : [], result_url_template: t?.expected_url_pattern ?? null }; };
    const results = await runBench(corpus, fixtureSites(), finder, 5);
    expect(results).toHaveLength(corpus.tasks.length * 5 * 2);
    expect(results.filter((r) => r.arm === "B").every((r) => r.success)).toBe(true);
    const md = renderReport(results, "2026-11-02");
    expect(md).toContain("Benchmark report"); expect(md).toContain("fixture");
    // Gate may fail on wall-time at ms scale; token+accuracy gate components asserted separately
    const gate = evaluateGate(results);
    for (const t of gate.perTask) { expect(t.medianTokensB).toBeLessThan(t.medianTokensA); expect(t.accB).toBeGreaterThanOrEqual(t.accA); }
  });
});
