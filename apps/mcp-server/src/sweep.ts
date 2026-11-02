// Plan 11.4 scheduled freshness + 11.2 recovery helpers (pure planning, enqueue via Store).
import type { Store } from "./store.js";
export interface SweepSiteInfo { domain: string; demand_score: number; stale_fraction: number; last_swept_at?: string | null }
export function staleFraction(staleEdges: number, totalEdges: number): number { return totalEdges ? staleEdges / totalEdges : 0; }
export function staleAlert(domains: SweepSiteInfo[]): SweepSiteInfo[] { return domains.filter((d) => d.stale_fraction > 0.05); }
/** Top decile weekly; every mapped site monthly. Returns domains due a sweep_site job. */
export function planSweep(sites: SweepSiteInfo[], now = new Date()): string[] {
  const sorted = [...sites].sort((a, b) => b.demand_score - a.demand_score);
  const decile = Math.max(1, Math.ceil(sorted.length * 0.1));
  const due = new Set<string>();
  const ageDays = (d?: string | null) => (d ? (now.getTime() - new Date(d).getTime()) / 86400000 : Infinity);
  sorted.slice(0, decile).forEach((s) => { if (ageDays(s.last_swept_at) >= 7) due.add(s.domain); });
  sorted.forEach((s) => { if (ageDays(s.last_swept_at) >= 30) due.add(s.domain); });
  return [...due];
}
export async function runSweep(store: Store & { listSweepSites?: () => Promise<SweepSiteInfo[]> }, now = new Date()): Promise<string[]> {
  if (!store.listSweepSites) return [];
  const domains = planSweep(await store.listSweepSites(), now);
  for (const domain of domains) await store.enqueue("sweep_site", { domain });
  return domains;
}
