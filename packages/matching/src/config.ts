export interface MatchingConfig {
  cacheAccept: number; nodeFloor: number; abstainThreshold: number; maxHops: number;
  weights: { retrieval: number; edgeSuccess: number; paramCoverage: number; stalenessPenalty: number };
  kindPrior: Record<string, number>;
  cacheMaxAgeMs: number;
  demand: { decayPerDay: number; distinctAgentThreshold: number; signalsPer7dThreshold: number; weights: Record<string, number> };
}
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  cacheAccept: 0.86, nodeFloor: 0.55, abstainThreshold: 0.45, maxHops: 6,
  weights: { retrieval: 0.5, edgeSuccess: 0.25, paramCoverage: 0.2, stalenessPenalty: 0.15 },
  kindPrior: { product: 1.0, category: 0.95, search: 0.9, filter: 0.85, other: 0.6, home: 0.5, cart: 0.4 },
  cacheMaxAgeMs: 30 * 24 * 3600 * 1000,
  demand: { decayPerDay: 0.9, distinctAgentThreshold: 5, signalsPer7dThreshold: 20,
    weights: { request_mapping: 1, my_sites: 2, is_mapped_miss: 1, find_miss: 1 } },
};
export function matchingConfigFromEnv(env: Record<string, string | undefined> = process.env): MatchingConfig {
  const num = (k: string, d: number) => { const v = env[k]; const n = v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
  const c = structuredClone(DEFAULT_MATCHING_CONFIG);
  c.cacheAccept = num("MATCHING_CACHE_ACCEPT", c.cacheAccept);
  c.nodeFloor = num("MATCHING_NODE_FLOOR", c.nodeFloor);
  c.abstainThreshold = num("MATCHING_ABSTAIN_THRESHOLD", c.abstainThreshold);
  c.maxHops = num("MATCHING_MAX_HOPS", c.maxHops);
  c.demand.distinctAgentThreshold = num("INDEX_DEMAND_DISTINCT_AGENTS", c.demand.distinctAgentThreshold);
  c.demand.signalsPer7dThreshold = num("INDEX_DEMAND_SIGNALS_7D", c.demand.signalsPer7dThreshold);
  return c;
}
