import { cosine, type EmbeddingProvider } from "./embeddings.js";
import type { MatchingNode } from "./compose.js";
export interface PathCacheEntry { id: string; domain: string; question_canonical: string; question_embedding?: number[] | null; ordered_edge_ids: string[]; stale?: boolean; last_success_at?: string | null; hits?: number }
export interface MatchingRepository {
  getSite(domain: string): Promise<{ domain: string; status: string; map_version: number } | null>;
  listNodes(domain: string): Promise<MatchingNode[]>;
  listEdges(domain: string): Promise<import("./compose.js").MatchingEdge[]>;
  listPathCache?(domain: string): Promise<PathCacheEntry[]>;
  recordPathCacheHit?(id: string): Promise<void>;
  upsertPathCache?(input: { domain: string; question_canonical: string; question_embedding: number[]; ordered_edge_ids: string[]; param_bindings: Record<string, unknown> }): Promise<{ id: string }>;
  createPath?(domain: string, canonical: string, edgeIds: string[]): Promise<{ id: string }>;
}
export async function nodeEmbedding(provider: EmbeddingProvider, n: MatchingNode): Promise<number[]> {
  if (n.embedding?.length) return n.embedding;
  return provider.embed(`${n.kind} ${n.url_pattern} ${n.description}`);
}
export async function rankNodes(provider: EmbeddingProvider, qEmb: number[], nodes: MatchingNode[], kindPrior: Record<string, number>) {
  const out: { node: MatchingNode; similarity: number; score: number }[] = [];
  for (const n of nodes.filter((x) => !x.stale)) {
    const sim = cosine(qEmb, await nodeEmbedding(provider, n));
    out.push({ node: n, similarity: sim, score: sim * (kindPrior[n.kind] ?? 0.6) });
  }
  return out.sort((a, b) => b.score - a.score);
}
export async function rankPathCache(provider: EmbeddingProvider, qEmb: number[], entries: PathCacheEntry[]) {
  const out: { entry: PathCacheEntry; similarity: number }[] = [];
  for (const e of entries.filter((x) => !x.stale)) {
    const emb = e.question_embedding?.length ? e.question_embedding : await provider.embed(e.question_canonical);
    out.push({ entry: e, similarity: cosine(qEmb, emb) });
  }
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
