/**
 * tokens_saved_estimate (ADR-0002): savings vs the measured raw-browsing baseline
 * for the same (domain, task class). Returns null when no committed real bench
 * baseline exists — never invent a number.
 */
export interface BaselineTable { [domain: string]: { [taskClass: string]: number } }

export function estimateTokensSaved(input: {
  domain: string;
  taskClass: string;
  mappedResponseText: string;
  baselines: BaselineTable;
}): number | null {
  const domainBaselines = input.baselines[input.domain];
  if (!domainBaselines) return null;
  const baseline = domainBaselines[input.taskClass];
  if (baseline == null) return null;
  const mappedTokens = Math.ceil(input.mappedResponseText.length / 4);
  return Math.max(0, baseline - mappedTokens);
}

/** Parse a bench report's Arm A medians into a BaselineTable (task id -> median tokens). */
export function baselinesFromBenchRows(rows: { domain: string; taskClass: string; armAMedianTokens: number }[]): BaselineTable {
  const out: BaselineTable = {};
  for (const r of rows) (out[r.domain] ??= {})[r.taskClass] = r.armAMedianTokens;
  return out;
}
