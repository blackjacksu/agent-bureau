import type { MatchingConfig } from "./config.js";
export interface MatchingNode { id: string; domain?: string; url_pattern: string; kind: string; description: string; embedding?: number[] | null; stale?: boolean; last_verified_at?: string | null }
export interface MatchingEdge { id: string; domain?: string; from_node_id: string; to_node_id: string; action: string; selector?: string | null; selector_fallbacks?: string[]; url_template?: string | null; params_schema?: Record<string, unknown> | null; attempts?: number; successes?: number; stale?: boolean }
export function smoothedRate(e: { attempts?: number; successes?: number }): number { return ((e.successes ?? 0) + 9) / ((e.attempts ?? 0) + 10); }
export function edgeWeight(e: MatchingEdge): number { return 1 + (1 - smoothedRate(e)) + (e.url_template ? 0 : 0.1); }
/** Dijkstra preferring few hops, url_template and high success_rate. Max hops enforced. */
export function composePath(nodes: MatchingNode[], edges: MatchingEdge[], fromIds: string[], targetId: string, maxHops = 6): MatchingEdge[] | null {
  if (fromIds.includes(targetId)) return [];
  const adj = new Map<string, MatchingEdge[]>();
  for (const e of edges.filter((x) => !x.stale)) { if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, []); adj.get(e.from_node_id)!.push(e); }
  for (const list of adj.values()) list.sort((a, b) => edgeWeight(a) - edgeWeight(b));
  type State = { id: string; via: MatchingEdge[]; cost: number };
  const best = new Map<string, number>(); const queue: State[] = fromIds.map((id) => ({ id, via: [], cost: 0 }));
  for (const id of fromIds) best.set(id, 0);
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.via.length - b.via.length);
    const cur = queue.shift()!;
    if (cur.id === targetId) return cur.via;
    if (cur.via.length >= maxHops) continue;
    for (const e of adj.get(cur.id) ?? []) {
      const cost = cur.cost + edgeWeight(e);
      if (cost < (best.get(e.to_node_id) ?? Infinity) - 1e-9) { best.set(e.to_node_id, cost); queue.push({ id: e.to_node_id, via: [...cur.via, e], cost }); }
    }
  }
  return null;
}
export function renderTemplate(t: string, params: Record<string, unknown>): string {
  return t.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? encodeURIComponent(String(params[k])) : m));
}
export function buildSteps(edges: MatchingEdge[], nodes: MatchingNode[], params: Record<string, unknown>) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const to = byId.get(e.to_node_id);
    const url = e.url_template ? renderTemplate(e.url_template, params) : undefined;
    const pv = Object.keys(params).length ? Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ") : "";
    return { action: e.action as any, ...(url ? { url } : {}), ...(e.selector ? { selector: e.selector } : {}), ...(e.selector_fallbacks?.length ? { selector_fallbacks: e.selector_fallbacks } : {}), ...(Object.keys(params).length ? { params: { ...params } } : {}), purpose: e.action === "set_vehicle" && pv ? `Set vehicle to ${pv}` : `${e.action} to ${to?.url_pattern ?? e.to_node_id}${pv ? ` (${pv})` : ""}` };
  });
}
export type { MatchingConfig };
