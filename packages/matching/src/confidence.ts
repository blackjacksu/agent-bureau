import type { MatchingConfig } from "./config.js";
import { smoothedRate, type MatchingEdge } from "./compose.js";
export function computeConfidence(cfg: MatchingConfig, input: { retrievalSimilarity: number; edges: MatchingEdge[]; paramCoverage: number; stalenessPenalty?: number }): number {
  const minRate = input.edges.length ? Math.min(...input.edges.map(smoothedRate)) : 0.9;
  const raw = cfg.weights.retrieval * Math.max(0, Math.min(1, input.retrievalSimilarity)) + cfg.weights.edgeSuccess * minRate + cfg.weights.paramCoverage * input.paramCoverage - cfg.weights.stalenessPenalty * (input.stalenessPenalty ?? 0);
  // Weights sum to 0.95 by design (plan 8.7); perfect signals should approach 1, so normalise by weight sum when no penalty.
  const denom = cfg.weights.retrieval + cfg.weights.edgeSuccess + cfg.weights.paramCoverage;
  const scaled = denom > 0 ? (cfg.weights.retrieval * Math.max(0, Math.min(1, input.retrievalSimilarity)) + cfg.weights.edgeSuccess * minRate + cfg.weights.paramCoverage * input.paramCoverage) / denom - cfg.weights.stalenessPenalty * (input.stalenessPenalty ?? 0) : raw;
  void raw;
  return Math.max(0, Math.min(1, scaled));
}
