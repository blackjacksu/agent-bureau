import type { RunResult } from "./harness.js";
import { median } from "./harness.js";
export interface BenchGate { passed: boolean; perTask: { task_id: string; passed: boolean; medianTokensA: number; medianTokensB: number; accA: number; accB: number }[] }
/** Plan 18.3 gate: warm runs 2-5, median B tokens/time below A, accuracy >= A, per task (never averaged away). */
export function evaluateGate(results: RunResult[]): BenchGate {
  const ids = [...new Set(results.map((r) => r.task_id))];
  const perTask = ids.map((id) => {
    const warm = results.filter((r) => r.task_id === id && r.run >= 2 && r.run <= 5);
    const a = warm.filter((r) => r.arm === "A"), b = warm.filter((r) => r.arm === "B");
    const accA = a.length ? a.filter((r) => r.success).length / a.length : 0;
    const accB = b.length ? b.filter((r) => r.success).length / b.length : 0;
    const mA = median(a.map((r) => r.tokens)), mB = median(b.map((r) => r.tokens));
    const tA = median(a.map((r) => r.wall_ms)), tB = median(b.map((r) => r.wall_ms));
    return { task_id: id, passed: mB < mA && tB <= Math.max(tA, 1) && accB >= accA, medianTokensA: mA, medianTokensB: mB, accA, accB };
  });
  return { passed: perTask.every((t) => t.passed), perTask };
}
export function renderReport(results: RunResult[], date = new Date().toISOString().slice(0, 10)): string {
  const gate = evaluateGate(results);
  const rows = gate.perTask.map((t) => `| ${t.task_id} | ${t.medianTokensA} | ${t.medianTokensB} | ${(t.accA * 100).toFixed(0)}% | ${(t.accB * 100).toFixed(0)}% | ${t.passed ? "pass" : "FAIL"} |`).join("\n");
  return `# Benchmark report ${date}\n\nfixture-bench smoke (mini sites only; real 3-5 sites blocked on owner Q2 — not the Phase 0 gate evidence).\n\n| task | median tokens A (raw) | median tokens B (mapped) | accuracy A | accuracy B | gate |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\nGate (plan 18.3, warm runs 2-5, per-task): **${gate.passed ? "PASS" : "FAIL"}**\n`;
}
