import { DEFAULT_MATCHING_CONFIG, type MatchingConfig } from "./config.js";
import { normalizeDomain, normalizeQuestion } from "./normalize.js";
import { extractParams, canonicalQuestion, type ParamValue } from "./params.js";
import { composePath, buildSteps, type MatchingEdge, type MatchingNode } from "./compose.js";
import { computeConfidence } from "./confidence.js";
import { rankNodes, rankPathCache, type MatchingRepository } from "./retrieve.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { FakeEmbeddingProvider } from "./embeddings.js";

export type FindResult =
  | { mapped: true; found: true; steps: ReturnType<typeof buildSteps>; result_url_template: string | null; needs_live_check: ("price" | "stock" | "availability")[]; path_id: string; confidence: number; missing_params: string[]; canonical: string; params: Record<string, ParamValue>; via: "path_cache" | "composed"; retrieval_similarity: number }
  | { mapped: true; found: false; reason: "no_path" | "low_confidence"; canonical: string; confidence?: number }
  | { mapped: false; status: string };

function templatesBindOk(edges: MatchingEdge[], params: Record<string, unknown>, missing: string[]): boolean {
  if (missing.length) return false;
  for (const e of edges) if (e.url_template) for (const m of e.url_template.matchAll(/\{(\w+)\}/g)) {
    const k = m[1]; if (["id", "q", "category", "slug"].includes(k)) continue;
    if (!(k in params)) return false;
  }
  return true;
}
function stalenessPenalty(entry: { last_success_at?: string | null }, cfg: MatchingConfig, now: Date): number {
  if (!entry.last_success_at) return 0.2;
  const age = now.getTime() - new Date(entry.last_success_at).getTime();
  return Math.max(0, Math.min(1, age / cfg.cacheMaxAgeMs));
}

export class MatchingService {
  constructor(private repo: MatchingRepository, private embeddings: EmbeddingProvider = new FakeEmbeddingProvider(), private cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG, private aliases: Record<string, string> = {}) {}
  async find(domainRaw: string, questionRaw: string, now = new Date()) {
    const domain = normalizeDomain(domainRaw);
    const site = await this.repo.getSite(domain);
    if (!site || site.status !== "mapped") return { mapped: false as const, status: site?.status ?? "queued" };
    const norm = normalizeQuestion(questionRaw);
    const [nodes, edges] = await Promise.all([this.repo.listNodes(domain), this.repo.listEdges(domain)]);
    const liveNodes = nodes.filter((n) => !n.stale); const liveEdges = edges.filter((e) => !e.stale);
    const edgeById = new Map(liveEdges.map((e) => [e.id, e])); const nodeById = new Map(liveNodes.map((n) => [n.id, n]));
    // First pass extraction with all edges to canonicalize (schema refined per-path later)
    const prelim = extractParams(norm.text, liveEdges, this.aliases);
    const canonical = canonicalQuestion(norm.text, prelim.params);
    const qEmb = await this.embeddings.embed(canonical || norm.lower);
    // PathCache first
    if (this.repo.listPathCache) {
      const ranked = await rankPathCache(this.embeddings, qEmb, await this.repo.listPathCache(domain));
      for (const hit of ranked) {
        if (hit.similarity < this.cfg.cacheAccept) continue;
        const pathEdges = hit.entry.ordered_edge_ids.map((id) => edgeById.get(id));
        if (pathEdges.some((e) => !e) || !pathEdges.length) continue;
        const ex = extractParams(norm.text, pathEdges as MatchingEdge[], this.aliases);
        if (!templatesBindOk(pathEdges as MatchingEdge[], ex.params, ex.missing_params)) continue;
        const confidence = computeConfidence(this.cfg, { retrievalSimilarity: hit.similarity, edges: pathEdges as MatchingEdge[], paramCoverage: ex.coverage, stalenessPenalty: stalenessPenalty(hit.entry, this.cfg, now) });
        if (confidence < this.cfg.abstainThreshold) return { mapped: true as const, found: false as const, reason: "low_confidence" as const, canonical, confidence };
        await this.repo.recordPathCacheHit?.(hit.entry.id);
        const can2 = canonicalQuestion(norm.text, ex.params);
        return { mapped: true as const, found: true as const, steps: buildSteps(pathEdges as MatchingEdge[], liveNodes, ex.params), result_url_template: (pathEdges[pathEdges.length - 1] as MatchingEdge).url_template ?? null, needs_live_check: ["price", "stock"] as ("price" | "stock")[], path_id: `p_${hit.entry.id}`, confidence: Number(confidence.toFixed(3)), missing_params: ex.missing_params, canonical: can2, params: ex.params, via: "path_cache" as const, retrieval_similarity: hit.similarity };
      }
    }
    // Node fallback
    const ranked = (await rankNodes(this.embeddings, qEmb, liveNodes, this.cfg.kindPrior)).filter((r) => r.similarity >= this.cfg.nodeFloor).slice(0, 8);
    if (!ranked.length) return { mapped: true as const, found: false as const, reason: "no_path" as const, canonical };
    const entries = liveNodes.filter((n) => n.kind === "home" || n.kind === "search");
    const entryIds = entries.length ? entries.map((n) => n.id) : liveNodes.slice(0, 1).map((n) => n.id);
    let composed: { edges: MatchingEdge[]; sim: number; target: MatchingNode } | null = null;
    for (const cand of ranked) {
      const path = composePath(liveNodes, liveEdges, entryIds, cand.node.id, this.cfg.maxHops);
      if (path && path.length <= this.cfg.maxHops) { composed = { edges: path, sim: cand.similarity, target: cand.node }; break; }
    }
    if (!composed) return { mapped: true as const, found: false as const, reason: "no_path" as const, canonical };
    const ex = extractParams(norm.text, composed.edges, this.aliases);
    const can2 = canonicalQuestion(norm.text, ex.params);
    const confidence = computeConfidence(this.cfg, { retrievalSimilarity: composed.sim, edges: composed.edges, paramCoverage: ex.coverage });
    if (confidence < this.cfg.abstainThreshold) return { mapped: true as const, found: false as const, reason: "low_confidence" as const, canonical: can2, confidence: Number(confidence.toFixed(3)) };
    // PathCache write-back / path creation
    let pathId: string;
    const emb2 = await this.embeddings.embed(can2);
    if (this.repo.upsertPathCache) { const rec = await this.repo.upsertPathCache({ domain, question_canonical: can2, question_embedding: emb2, ordered_edge_ids: composed.edges.map((e) => e.id), param_bindings: ex.params }); pathId = rec.id; }
    else if (this.repo.createPath) { const rec = await this.repo.createPath(domain, can2, composed.edges.map((e) => e.id)); pathId = rec.id; }
    else pathId = composed.edges.map((e) => e.id).join("-") || composed.target.id;
    void nodeById;
    return { mapped: true as const, found: true as const, steps: buildSteps(composed.edges, liveNodes, ex.params), result_url_template: composed.edges[composed.edges.length - 1]?.url_template ?? null, needs_live_check: ["price", "stock"] as ("price" | "stock")[], path_id: pathId.startsWith("p_") ? pathId : `p_${pathId}`, confidence: Number(confidence.toFixed(3)), missing_params: ex.missing_params, canonical: can2, params: ex.params, via: "composed" as const, retrieval_similarity: composed.sim };
  }
  async getPath(domainRaw: string, goal: string) {
    const domain = normalizeDomain(domainRaw);
    const site = await this.repo.getSite(domain);
    if (!site || site.status !== "mapped") return null;
    const [nodes, edges] = await Promise.all([this.repo.listNodes(domain), this.repo.listEdges(domain)]);
    const liveNodes = nodes.filter((n) => !n.stale);
    let target = liveNodes.find((n) => n.id === goal);
    if (!target) {
      const emb = await this.embeddings.embed(normalizeQuestion(goal).lower);
      const ranked = await rankNodes(this.embeddings, emb, liveNodes, this.cfg.kindPrior);
      target = ranked[0]?.node;
    }
    if (!target) return null;
    const entry = liveNodes.find((n) => n.kind === "home") ?? liveNodes[0];
    if (!entry) return null;
    const via = entry.id === target.id ? [] : composePath(liveNodes, edges, [entry.id], target.id, this.cfg.maxHops);
    if (!via) return null;
    return { steps: buildSteps(via, liveNodes, {}), from_node: entry.id, to_node: target.id, result_url_template: via[via.length - 1]?.url_template ?? null };
  }
}
