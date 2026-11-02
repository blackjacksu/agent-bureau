// Plan 11: feedback intake, stale rules, anti-poisoning. Pure logic + per-agent tracker.
export const STALE_RATE = 0.7, STALE_MIN_ATTEMPTS = 10, STALE_WINDOW_DAYS = 7;
export const VERIFIED_WEIGHT = 5, UNVERIFIED_WEIGHT = 1;
export const DAILY_REPORT_CAPS: Record<string, number> = { free: 50, builder: 500, scale: 5000, verified_builder: 1000, verified_scale: 10000 };
export function smoothedRate(successes: number, attempts: number): number { return (successes + 9) / (attempts + 10); }
export function edgesExercised(edgeIds: string[], success: boolean, failedStepIndex?: number): string[] {
  if (success) return [...edgeIds];
  const last = Math.min(failedStepIndex ?? edgeIds.length - 1, edgeIds.length - 1);
  return edgeIds.slice(0, last + 1);
}
export function isThresholdStale(successes: number, attempts: number, attemptsInWindow: number): boolean {
  return attemptsInWindow >= STALE_MIN_ATTEMPTS && smoothedRate(successes, attempts) < STALE_RATE;
}
export interface AgentFeedbackStats { reports: number; corroborated: number; contradicted: number; day: string; dayCount: number; weight: number; flagged: boolean }
export class FeedbackTracker {
  private agents = new Map<string, AgentFeedbackStats>();
  constructor(private now: () => Date = () => new Date()) {}
  stats(agentId: string): AgentFeedbackStats {
    let s = this.agents.get(agentId);
    const day = this.now().toISOString().slice(0, 10);
    if (!s) { s = { reports: 0, corroborated: 0, contradicted: 0, day, dayCount: 0, weight: 1, flagged: false }; this.agents.set(agentId, s); }
    if (s.day !== day) { s.day = day; s.dayCount = 0; }
    return s;
  }
  /** Returns effective weight (0 when capped/decayed), and whether this report counts. */
  recordReport(agentId: string, verified: boolean, tier = "free"): { weight: number; counted: boolean } {
    const s = this.stats(agentId);
    const cap = DAILY_REPORT_CAPS[tier] ?? 50;
    if (s.dayCount >= cap) return { weight: 0, counted: false };
    s.dayCount++; s.reports++;
    if (s.weight === 0) return { weight: 0, counted: false };
    return { weight: verified ? VERIFIED_WEIGHT : UNVERIFIED_WEIGHT, counted: true };
  }
  recordCorroboration(agentId: string, corroborated: boolean): AgentFeedbackStats {
    const s = this.stats(agentId);
    if (corroborated) s.corroborated++; else s.contradicted++;
    const total = s.corroborated + s.contradicted;
    // 11.3: >30% contradicted over >=50 reports -> weight decayed to 0 + anomaly flag.
    if (total >= 50 && s.contradicted / total > 0.3) { s.weight = 0; s.flagged = true; }
    return s;
  }
  weightFor(agentId: string, verified: boolean): number {
    const s = this.stats(agentId);
    return s.weight === 0 ? 0 : verified ? VERIFIED_WEIGHT : UNVERIFIED_WEIGHT;
  }
}
export type CorroborationPlan =
  | { action: "corroborate"; jobs: { kind: "verify_url" | "reindex_branch"; reason: string }[] }
  | { action: "suspect"; jobs: [] }
  | { action: "none"; jobs: [] };
/** 11.2 immediate stale: verified single failure on well-proven edge needs corroboration, never instant stale. */
export function planFailure(success: boolean, verified: boolean, edgeSuccesses: number[]): CorroborationPlan {
  if (success) return { action: "none", jobs: [] };
  if (verified && edgeSuccesses.some((n) => n >= 20)) return { action: "corroborate", jobs: [{ kind: "verify_url", reason: "verified_failure_corroboration" }, { kind: "reindex_branch", reason: "verified_failure_corroboration" }] };
  if (!verified) return { action: "suspect", jobs: [] };
  return { action: "corroborate", jobs: [{ kind: "reindex_branch", reason: "failure" }] };
}
