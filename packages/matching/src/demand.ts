import type { MatchingConfig } from "./config.js";
export interface DemandSignal { domain: string; agent_id?: string | null; source: string; created_at?: string | Date | number }
export function demandScore(signals: DemandSignal[], cfg: MatchingConfig, now = new Date()): number {
  let s = 0;
  for (const sig of signals) {
    const at = sig.created_at ? new Date(sig.created_at as any).getTime() : now.getTime();
    const ageDays = Math.max(0, (now.getTime() - at) / 86400000);
    s += (cfg.demand.weights[sig.source] ?? 1) * Math.pow(cfg.demand.decayPerDay, ageDays);
  }
  return s;
}
export function evaluateDemand(signals: DemandSignal[], cfg: MatchingConfig, now = new Date(), opts: { mySitesPriority?: boolean } = {}): { score: number; shouldEnqueue: boolean; reason: string | null; distinctAgents: number; signals7d: number } {
  const score = demandScore(signals, cfg, now);
  const distinctAgents = new Set(signals.map((s) => s.agent_id).filter(Boolean)).size;
  const signals7d = signals.filter((s) => now.getTime() - (s.created_at ? new Date(s.created_at as any).getTime() : now.getTime()) <= 7 * 86400000).length;
  if (opts.mySitesPriority) return { score, shouldEnqueue: true, reason: "my_sites_priority", distinctAgents, signals7d };
  if (distinctAgents >= cfg.demand.distinctAgentThreshold) return { score, shouldEnqueue: true, reason: "distinct_agents", distinctAgents, signals7d };
  if (signals7d >= cfg.demand.signalsPer7dThreshold) return { score, shouldEnqueue: true, reason: "signals_7d", distinctAgents, signals7d };
  return { score, shouldEnqueue: false, reason: null, distinctAgents, signals7d };
}
/** Ensures threshold crossing enqueues exactly once per domain until reset. */
export class DemandTracker {
  private enqueued = new Set<string>();
  constructor(private cfg: MatchingConfig) {}
  evaluate(domain: string, signals: DemandSignal[], now = new Date(), opts: { mySitesPriority?: boolean } = {}) {
    const r = evaluateDemand(signals, this.cfg, now, opts);
    const shouldEnqueueNow = r.shouldEnqueue && !this.enqueued.has(domain);
    if (shouldEnqueueNow) this.enqueued.add(domain);
    return { ...r, shouldEnqueue: shouldEnqueueNow, alreadyEnqueued: r.shouldEnqueue && !shouldEnqueueNow };
  }
  reset(domain: string) { this.enqueued.delete(domain); }
}
