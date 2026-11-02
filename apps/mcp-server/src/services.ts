import { AgentMapError } from "@agentmap/contracts";
import type { Offer } from "@agentmap/contracts";
import { hashQuestion } from "@agentmap/db";
import { normalizeDomain } from "./config.js";
import type { Store, NodeRow, EdgeRow } from "./store.js";
import { outcomeHash } from "./store.js";
import { MatchingService, createEmbeddingProviderFromEnv, matchingConfigFromEnv, extractParams as matchingExtractParams, canonicalQuestion as matchingCanonical, renderTemplate as matchingRender, parseVector, type MatchingRepository } from "@agentmap/matching";

export interface EventSink { write(e: { agent_id: string | null; domain: string | null; type: string; path_id?: string | null; question_hash?: string | null; latency_ms?: number | null; metadata?: Record<string, unknown> }): void }
export class CollectingEventSink implements EventSink { events: any[] = []; write(e: any) { this.events.push(e); } }
export interface VerifierPort { check(url: string, fields?: string[]): Promise<any> }
export interface MatchingPort { find(store: Store, domain: string, question: string): Promise<any>; getPath?(store: Store, domain: string, goal: string): Promise<any> }
export type OffersPort = (args: { domain: string; question: string; agentTier: string }) => Promise<Offer[]>;

const STOP = new Set(["a", "an", "the", "for", "me", "find", "please", "i", "need", "to", "of", "on"]);
export function tokens(s: string) { return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)); }
export function extractParams(q: string, edges: EdgeRow[]) { const r = matchingExtractParams(q, edges as any); return { params: r.params, required: r.schema.required, missing_params: r.missing_params }; }
export function canonicalQuestion(q: string, params: Record<string, unknown>) { return matchingCanonical(q, params as any); }
export function storeToMatchingRepo(store: Store): MatchingRepository {
  const s:any = store;
  return {
    getSite: (d:string)=>store.getSite(d),
    listNodes: async (d:string)=>(await store.listNodes(d)).map((n:any)=>({...n, embedding: parseVector(n.embedding)})),
    listEdges: (d:string)=>store.listEdges(d) as any,
    listPathCache: s.listPathCache ? (d:string)=>s.listPathCache(d) : undefined,
    recordPathCacheHit: s.recordPathCacheHit ? (id:string)=>s.recordPathCacheHit(id) : undefined,
    upsertPathCache: s.upsertPathCache ? (input:any)=>s.upsertPathCache(input) : undefined,
    createPath: (d:string,c:string,ids:string[])=>store.createPath(d,c,ids),
  } as MatchingRepository;
}
export function createDefaultMatching(env: Record<string,string|undefined>=process.env): MatchingPort {
  const svcFor = (store:Store)=> { const provider = createEmbeddingProviderFromEnv(env); const cfg = matchingConfigFromEnv(env);
    // Token-hash (fake) embeddings have a compressed similarity scale vs hosted models:
    // a correct top hit scores ~0.5, under the hosted-calibrated 0.55 floor. Lower the floor
    // for fake providers only (explicit MATCHING_NODE_FLOOR always wins).
    if (provider.model.startsWith("fake/") && env.MATCHING_NODE_FLOOR == null) cfg.nodeFloor = 0.2;
    return new MatchingService(storeToMatchingRepo(store), provider, cfg); };
  return {
    async find(store:Store,domain:string,question:string){ const r:any= await svcFor(store).find(domain,question); if(!r.mapped) return null; if(!r.found) return {mapped:true,found:false,reason:r.reason,_canonical:r.canonical,_confidence:r.confidence}; const {_c,...rest}=r; return {...rest, offers: [] as Offer[], _canonical:r.canonical}; },
    async getPath(store:Store,domain:string,goal:string){ return svcFor(store).getPath(domain,goal); }
  };
}
export class DefaultMatching implements MatchingPort {
  private inner = createDefaultMatching();
  async find(store: Store, domain: string, question: string) { return this.inner.find(store, domain, question); }
  async getPath(store: Store, domain: string, goal: string) { return this.inner.getPath!(store, domain, goal); }
}
export const renderTemplate = matchingRender;

import { FeedbackTracker, planFailure, edgesExercised } from "./feedback.js";
import { metrics as globalMetrics, type MetricsRegistry } from "./observability.js";
export type CorroboratorPort = (args: { domain: string; path_id: string; url?: string }) => Promise<boolean>;
export class Services {
  readonly feedback = new FeedbackTracker();
  constructor(private store: Store, private events: EventSink, private opts: { verifier: VerifierPort; matching?: MatchingPort; offers?: OffersPort; offersEnabled?: boolean; abstain?: number; corroborator?: CorroboratorPort; metrics?: MetricsRegistry }) {}
  private m() { return this.opts.metrics ?? globalMetrics; }
  private siteOut(s: any) { return { mapped: s.status === "mapped", map_version: s.status === "mapped" ? s.map_version : null, last_indexed_at: s.last_indexed_at ?? null, status: s.status }; }
  async isMapped(agentId: string, input: { domain: string }) {
    const domain = normalizeDomain(input.domain); let site = await this.store.getSite(domain);
    if (!site) { await this.store.recordDemand(domain, agentId, "is_mapped_miss"); site = await this.store.getSite(domain); }
    else if (site.status !== "mapped") await this.store.recordDemand(domain, agentId, "is_mapped_miss");
    this.events.write({ agent_id: agentId, domain, type: "query", metadata: {} });
    return this.siteOut(site);
  }
  async find(agent: { agentId: string; tier: string }, input: { domain: string; question: string }) {
    const domain = normalizeDomain(input.domain); const site = await this.store.getSite(domain);
    if (site && (site.status === "opted_out" || site.status === "blocked")) throw new AgentMapError("domain_blocked", `domain ${domain} is blocked`);
    if (!site || site.status !== "mapped") { await this.store.recordDemand(domain, agent.agentId, "find_miss"); const s = await this.store.getSite(domain); this.events.write({ agent_id: agent.agentId, domain, type: "query", question_hash: hashQuestion(input.question.toLowerCase()), metadata: {} }); return { mapped: false, status: s?.status ?? "queued", queue_position: await this.store.queuePosition(domain) }; }
    const matching = this.opts.matching ?? new DefaultMatching();
    const result: any = await matching.find(this.store, domain, input.question);
    if (!result) return { mapped: false, status: site.status, queue_position: await this.store.queuePosition(domain) };
    if (result.found) {
      let offers: Offer[] = [];
      if (this.opts.offersEnabled && this.opts.offers) { const t0 = Date.now(); try { offers = await Promise.race([this.opts.offers({ domain, question: input.question, agentTier: agent.tier }), new Promise<Offer[]>((r) => setTimeout(() => r([]), 100))]); } catch { offers = []; this.events.write({ agent_id: agent.agentId, domain, type: "query", metadata: { error_code: "offers_hook_failed" } }); this.m().inc("offers_hook_failed_total", { domain }); } this.m().observe("offers_hook_latency_ms", Date.now() - t0, { domain }); }
      const { _canonical, canonical: _c2, params: _p2, via: _v2, retrieval_similarity: _r2, ...rest } = result;
      this.m().observe("matching_confidence", typeof rest.confidence === "number" ? rest.confidence : 0, { domain });
      this.events.write({ agent_id: agent.agentId, domain, type: "query", question_hash: hashQuestion(_canonical ?? input.question.toLowerCase()), metadata: {} });
      this.events.write({ agent_id: agent.agentId, domain, type: "path_used", path_id: parseUuid(String(rest.path_id ?? "")), metadata: {} });
      if (offers.length) this.events.write({ agent_id: agent.agentId, domain, type: "offers_served", metadata: { offer_ids: offers.map((o) => o.offer_id), domain, via: "find" } });
      return { ...rest, offers };
    }
    this.events.write({ agent_id: agent.agentId, domain, type: "query", question_hash: hashQuestion(input.question.toLowerCase()), metadata: {} });
    return result;
  }
  async getPath(_agent: { agentId: string }, input: { domain: string; goal: string }) {
    const domain = normalizeDomain(input.domain); const site = await this.store.getSite(domain);
    if (!site || site.status !== "mapped") throw new AgentMapError("not_found", `domain ${domain} is not mapped`);
    this.events.write({ agent_id: _agent.agentId, domain, type: "query", metadata: {} });
    { const m:any = this.opts.matching ?? new DefaultMatching(); if (m.getPath) { const viaMatching:any = await m.getPath(this.store, domain, input.goal); if (viaMatching) { this.events.write({ agent_id: _agent.agentId, domain, type: "path_used", metadata: {} }); return viaMatching; } throw new AgentMapError("not_found", `no path to node: ${input.goal}`); } }
    const [nodes, edges] = await Promise.all([this.store.listNodes(domain), this.store.listEdges(domain)]);
    const target = nodes.find((n) => n.id === input.goal) ?? nodes.map((n) => ({ n, s: tokens(input.goal).filter((t) => tokens(`${n.url_pattern} ${n.description}`).includes(t)).length })).sort((a, b) => b.s - a.s)[0]?.n;
    if (!target) throw new AgentMapError("not_found", `unknown node: ${input.goal}`);
    const entry = nodes.find((n) => n.kind === "home") ?? nodes[0]; if (!entry) throw new AgentMapError("not_found", "no graph nodes");
    const adj = new Map<string, EdgeRow[]>(); for (const e of edges.filter((x) => !x.stale)) { if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, []); adj.get(e.from_node_id)!.push(e); }
    const q: { id: string; via: EdgeRow[] }[] = [{ id: entry.id, via: [] }]; const seen = new Set([entry.id]); let via: EdgeRow[] | null = entry.id === target.id ? [] : null;
    while (q.length && !via) { const cur = q.shift()!; for (const e of adj.get(cur.id) ?? []) { if (seen.has(e.to_node_id)) continue; seen.add(e.to_node_id); const v = [...cur.via, e]; if (e.to_node_id === target.id) { via = v; break; } q.push({ id: e.to_node_id, via: v }); } }
    if (!via) throw new AgentMapError("not_found", `no path to node: ${input.goal}`);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return { steps: via.map((e) => ({ action: e.action as any, ...(e.url_template ? { url: e.url_template } : {}), ...(e.selector ? { selector: e.selector } : {}), purpose: `${e.action} to ${nodeById.get(e.to_node_id)?.url_pattern ?? e.to_node_id}` })), from_node: entry.id, to_node: target.id, result_url_template: via[via.length - 1]?.url_template ?? null };
  }
  async liveCheck(agent: { agentId: string }, input: { url: string; fields?: string[] }) {
    const out = await this.opts.verifier.check(input.url, input.fields);
    const host = safeHost(input.url);
    // 11.2: every use is a test — successful live_check refreshes terminal node last_verified_at.
    if (out.status === "ok" && host && this.store.markNodeVerified) await this.store.markNodeVerified(host, input.url).catch(() => {});
    this.events.write({ agent_id: agent.agentId, domain: host, type: "live_check", metadata: { source: out.source } });
    return out;
  }
  async reportOutcome(agent: { agentId: string; verified: boolean; tier?: string }, input: { domain: string; path_id: string; success: boolean; failed_step_index?: number; note?: string }) {
    const domain = normalizeDomain(input.domain); const path = await this.store.getPath(input.path_id);
    if (!path || path.domain !== domain) throw new AgentMapError("not_found", `unknown path_id: ${input.path_id}`);
    const h = outcomeHash(input.success, input.failed_step_index);
    if (await this.store.isDuplicateOutcome(agent.agentId, input.path_id, h)) return { acknowledged: true as const, branch_status: "ok" as const };
    const { weight, counted } = this.feedback.recordReport(agent.agentId, agent.verified, agent.tier ?? "free");
    this.m().inc("feedback_reports_total", { domain, result: input.success ? "success" : "failure" });
    let corroboratedBroken = false;
    if (!input.success && counted) {
      const successes = this.store.edgeSuccesses ? await this.store.edgeSuccesses(edgesExercised(path.ordered_edge_ids, false, input.failed_step_index)) : [];
      const plan = planFailure(false, agent.verified, successes);
      if (plan.action === "corroborate") {
        await this.store.enqueue("verify_url", { domain, path_id: parseUuid(input.path_id), url: `https://${domain}/` });
        if (this.opts.corroborator) {
          corroboratedBroken = await this.opts.corroborator({ domain, path_id: input.path_id }).catch(() => false);
          const st = this.feedback.recordCorroboration(agent.agentId, corroboratedBroken);
          if (st.flagged) this.m().inc("agent_feedback_flagged_total", { domain });
        }
      }
    }
    // Weight 0 (capped/decayed) agents: ack but do not count (11.3 separates feedback from query privilege).
    const res = counted && weight > 0 ? await this.store.recordOutcome({ path, success: input.success, failedStepIndex: input.failed_step_index, agentVerified: agent.verified, weight, corroboratedBroken }) : { branch_status: "ok" as const, duplicate: false };
    await this.store.rememberOutcome(agent.agentId, input.path_id, h);
    if (input.note) await this.store.saveFeedbackNote(agent.agentId, input.path_id, input.note);
    this.events.write({ agent_id: agent.agentId, domain, type: "outcome", path_id: parseUuid(input.path_id), metadata: { success: input.success } });
    if (!input.success && input.failed_step_index != null) this.events.write({ agent_id: agent.agentId, domain, type: "step_failed", path_id: parseUuid(input.path_id), metadata: { failed_step_index: input.failed_step_index } });
    return { acknowledged: true as const, branch_status: res.branch_status };
  }
  /** Recovery (11.2): reindex publish healed the branch — clear stale so find serves it again. */
  async healBranch(path_id: string) { const path = await this.store.getPath(path_id); if (path && this.store.clearStaleForEdges) await this.store.clearStaleForEdges(path.ordered_edge_ids); }
  async requestMapping(agent: { agentId: string }, input: { domain: string }) {
    const domain = normalizeDomain(input.domain); const site = await this.store.getSite(domain);
    if (site?.status === "mapped") return { queued: false, queue_position: null, already_mapped: true };
    if (site && (site.status === "opted_out" || site.status === "blocked")) throw new AgentMapError("domain_blocked", `domain ${domain} is blocked`);
    await this.store.recordDemand(domain, agent.agentId, "request_mapping");
    this.events.write({ agent_id: agent.agentId, domain, type: "query", metadata: {} });
    return { queued: true, queue_position: await this.store.queuePosition(domain), already_mapped: false };
  }
  async mySites(agent: { agentId: string }, input: { action: "add" | "remove" | "list"; domains?: string[] }) {
    const domains = (input.domains ?? []).map(normalizeDomain);
    if (input.action === "add") { if ((await this.store.countMySites(agent.agentId)) + domains.length > 100) throw new AgentMapError("invalid_input", "my_sites cap 100 exceeded"); for (const d of domains) { await this.store.addMySite(agent.agentId, d); await this.store.recordDemand(d, agent.agentId, "my_sites"); } }
    if (input.action === "remove") for (const d of domains) await this.store.removeMySite(agent.agentId, d);
    const sites = await this.store.listMySites(agent.agentId);
    this.events.write({ agent_id: agent.agentId, domain: domains[0] ?? null, type: "query", metadata: {} });
    return { sites: sites.map((s) => ({ domain: s.domain, status: s.status as any, map_version: s.status === "mapped" ? s.map_version : null })) };
  }
  /** find_offers (plan 16.4): registered only when OFFERS_ENABLED. Never blocks, never serves opted-out domains (provider enforces). */
  async findOffers(agent: { agentId: string; tier: string }, input: { domain: string; question?: string }) {
    const domain = normalizeDomain(input.domain);
    const site = await this.store.getSite(domain);
    if (site?.status === "opted_out") return { offers: [] as Offer[] };
    if (!this.opts.offersEnabled || !this.opts.offers) return { offers: [] as Offer[] };
    const offers = await Promise.race([
      this.opts.offers({ domain, question: input.question ?? "", agentTier: agent.tier }),
      new Promise<Offer[]>((r) => setTimeout(() => r([]), 100)),
    ]).catch(() => [] as Offer[]);
    if (offers.length) this.events.write({ agent_id: agent.agentId, domain, type: "offers_served", metadata: { offer_ids: offers.map((o) => o.offer_id), domain, via: "find_offers" } });
    return { offers: offers.slice(0, 3) };
  }
}
export function safeHost(url: string) { try { return new URL(url).hostname; } catch { return null; } }
export function parseUuid(p: string) { const raw = p.replace(/^p_/, ""); return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null; }
