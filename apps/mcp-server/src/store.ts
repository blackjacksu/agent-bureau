import { createHash, randomUUID } from "node:crypto";
import type { DbClient } from "@agentmap/db";
import { findKeysByPrefix, touchApiKey, enqueueJob } from "@agentmap/db";
import { normalizeDomain } from "./config.js";

export interface SiteRow { domain: string; status: string; map_version: number; last_indexed_at: string | null; offers_enabled?: boolean }
export interface NodeRow { id: string; domain: string; map_version: number; url_pattern: string; kind: string; description: string; stale: boolean; embedding?: number[] | string | null }
export interface EdgeRow { id: string; domain: string; map_version: number; from_node_id: string; to_node_id: string; action: string; selector: string | null; selector_fallbacks?: string[]; url_template: string | null; params_schema?: Record<string, unknown>; attempts: number; successes: number; stale: boolean }
export interface KeyRow { key_id: string; agent_id: string; operator_id: string; key_hash: string; key_prefix: string; scopes: string[]; revoked_at: string | null; tier: string; verified: boolean }
export interface PathRecord { id: string; domain: string; ordered_edge_ids: string[]; stale: boolean }
export interface PathCacheRow { id: string; domain: string; question_canonical: string; question_embedding?: number[] | string | null; ordered_edge_ids: string[]; stale: boolean; last_success_at?: string | null; hits?: number }

export interface Store {
  ping(): Promise<boolean>;
  getSite(domain: string): Promise<SiteRow | null>;
  ensureSiteQueued(domain: string): Promise<SiteRow>;
  recordDemand(domain: string, agentId: string | null, source: string): Promise<void>;
  queuePosition(domain: string): Promise<number | null>;
  listNodes(domain: string): Promise<NodeRow[]>;
  listEdges(domain: string): Promise<EdgeRow[]>;
  createPath(domain: string, canonical: string, edgeIds: string[]): Promise<PathRecord>;
  listPathCache?(domain: string): Promise<PathCacheRow[]>;
  recordPathCacheHit?(id: string): Promise<void>;
  upsertPathCache?(input: { domain: string; question_canonical: string; question_embedding: number[]; ordered_edge_ids: string[]; param_bindings: Record<string, unknown> }): Promise<PathRecord>;
  getPath(id: string): Promise<PathRecord | null>;
  recordOutcome(p: { path: PathRecord; success: boolean; failedStepIndex?: number; agentVerified: boolean; weight?: number; corroboratedBroken?: boolean }): Promise<{ branch_status: "ok" | "marked_stale" | "reindex_queued"; duplicate: boolean }>;
  isDuplicateOutcome(agentId: string, pathId: string, hash: string): Promise<boolean>;
  rememberOutcome(agentId: string, pathId: string, hash: string): Promise<void>;
  saveFeedbackNote(agentId: string, pathId: string, note: string): Promise<void>;
  markNodeVerified?(domain: string, url: string): Promise<void>;
  clearStaleForEdges?(edgeIds: string[]): Promise<void>;
  edgeSuccesses?(edgeIds: string[]): Promise<number[]>;
  listSweepSites?(): Promise<{ domain: string; demand_score: number; stale_fraction: number; last_swept_at?: string | null }[]>;
  enqueue(kind: string, payload: unknown): Promise<void>;
  findKeys(prefix: string): Promise<KeyRow[]>;
  touchKey(keyId: string): Promise<void>;
  addMySite(agentId: string, domain: string): Promise<void>;
  removeMySite(agentId: string, domain: string): Promise<void>;
  listMySites(agentId: string): Promise<SiteRow[]>;
  countMySites(agentId: string): Promise<number>;
}
export function outcomeHash(success: boolean, failed?: number) { return createHash("sha256").update(`${success}:${failed ?? ""}`).digest("hex"); }
function iso(v: unknown): string | null { if (!v) return null; return v instanceof Date ? v.toISOString() : String(v); }

export class InMemoryStore implements Store {
  sites = new Map<string, SiteRow>(); nodes: NodeRow[] = []; edges: EdgeRow[] = [];
  keys: KeyRow[] = []; keyHashes = new Map<string, string>();
  paths = new Map<string, PathRecord>(); pathCache: PathCacheRow[] = []; mySites = new Map<string, Set<string>>();
  demand: { domain: string; agent_id: string | null; source: string; at: number }[] = [];
  jobs: { kind: string; payload: unknown }[] = []; notes: { agentId: string; pathId: string; note: string }[] = [];
  outcomes = new Map<string, number>(); edgeStats = new Map<string, { attempts: number; successes: number; stale: boolean }>();
  suspects = new Map<string, number>(); nodeVerifiedAt = new Map<string, string>(); agentFlags: { agentId: string; kind: string }[] = [];
  async ping() { return true; }
  async getSite(d: string) { return this.sites.get(d) ?? null; }
  async ensureSiteQueued(domain: string) { let s = this.sites.get(domain); if (!s) { s = { domain, status: "queued", map_version: 0, last_indexed_at: null, offers_enabled: false }; this.sites.set(domain, s); } return s; }
  async recordDemand(domain: string, agentId: string | null, source: string) { await this.ensureSiteQueued(domain); this.demand.push({ domain, agent_id: agentId, source, at: Date.now() }); }
  async queuePosition(domain: string) { const queued = [...this.sites.values()].filter((s) => s.status === "queued"); queued.sort((a, b) => this.demand.filter((x) => x.domain === b.domain).length - this.demand.filter((x) => x.domain === a.domain).length); const i = queued.findIndex((s) => s.domain === domain); return i >= 0 ? i + 1 : null; }
  async listNodes(domain: string) { const s = this.sites.get(domain); if (!s) return []; return this.nodes.filter((n) => n.domain === domain && n.map_version === s.map_version && !n.stale); }
  async listEdges(domain: string) { const s = this.sites.get(domain); if (!s) return []; return this.edges.filter((e) => e.domain === domain && e.map_version === s.map_version); }
  async createPath(domain: string, _c: string, edgeIds: string[]) { const p: PathRecord = { id: randomUUID(), domain, ordered_edge_ids: [...edgeIds], stale: false }; this.paths.set(p.id, p); for (const id of edgeIds) if (!this.edgeStats.has(id)) { const e = this.edges.find((x) => x.id === id); this.edgeStats.set(id, { attempts: e?.attempts ?? 0, successes: e?.successes ?? 0, stale: e?.stale ?? false }); } return p; }
  async listPathCache(domain: string) { return this.pathCache.filter((c) => c.domain === domain); }
  async recordPathCacheHit(id: string) { const c = this.pathCache.find((x) => x.id === id.replace(/^p_/, "")); if (c) c.hits = (c.hits ?? 0) + 1; }
  async upsertPathCache(input: { domain: string; question_canonical: string; question_embedding: number[]; ordered_edge_ids: string[]; param_bindings: Record<string, unknown> }) { const existing = this.pathCache.find((c) => c.domain === input.domain && c.question_canonical === input.question_canonical); if (existing) return { id: existing.id, domain: existing.domain, ordered_edge_ids: existing.ordered_edge_ids, stale: false }; const rec: PathCacheRow = { id: randomUUID(), domain: input.domain, question_canonical: input.question_canonical, question_embedding: input.question_embedding, ordered_edge_ids: [...input.ordered_edge_ids], stale: false, last_success_at: new Date().toISOString(), hits: 0 }; this.pathCache.push(rec); const p: PathRecord = { id: rec.id, domain: rec.domain, ordered_edge_ids: rec.ordered_edge_ids, stale: false }; this.paths.set(p.id, p); return p; }
  async getPath(id: string) { return this.paths.get(id.replace(/^p_/, "")) ?? [...this.paths.values()].find((p) => p.id === id) ?? null; }
  async isDuplicateOutcome(a: string, p: string, h: string) { const t = this.outcomes.get(`${a}:${p}:${h}`); return !!t && Date.now() - t < 600_000; }
  async rememberOutcome(a: string, p: string, h: string) { this.outcomes.set(`${a}:${p}:${h}`, Date.now()); }
  async recordOutcome({ path, success, failedStepIndex, agentVerified, corroboratedBroken }: { path: PathRecord; success: boolean; failedStepIndex?: number; agentVerified: boolean; weight?: number; corroboratedBroken?: boolean }) {
    for (const id of path.ordered_edge_ids) if (!this.edgeStats.has(id)) { const e = this.edges.find((x) => x.id === id); this.edgeStats.set(id, { attempts: e?.attempts ?? 0, successes: e?.successes ?? 0, stale: e?.stale ?? false }); }
    const ids = success ? path.ordered_edge_ids : path.ordered_edge_ids.slice(0, (failedStepIndex ?? path.ordered_edge_ids.length - 1) + 1);
    let stale = false;
    for (const id of ids) { const st = this.edgeStats.get(id) ?? { attempts: 0, successes: 0, stale: false }; st.attempts++; if (success) st.successes++; const rate = (st.successes + 9) / (st.attempts + 10); if (!success && st.attempts >= 10 && rate < 0.7) { st.stale = true; stale = true; } if (!success && corroboratedBroken) { st.stale = true; stale = true; } this.edgeStats.set(id, st); const e = this.edges.find((x) => x.id === id); if (e) { e.attempts = st.attempts; e.successes = st.successes; e.stale = st.stale; } }
    if (!success && !agentVerified) for (const id of ids) this.suspects.set(id, (this.suspects.get(id) ?? 0) + 1);
    if (stale) { const pc = this.pathCache.find((c) => c.id === path.id); if (pc) pc.stale = true; const p = this.paths.get(path.id); if (p) p.stale = true; }
    if (!success) { await this.enqueue("reindex_branch", { domain: path.domain, node_id: path.ordered_edge_ids[0] ?? path.id }); return { branch_status: stale ? "marked_stale" as const : "reindex_queued" as const, duplicate: false }; }
    return { branch_status: "ok" as const, duplicate: false };
  }
  async markNodeVerified(domain: string, url: string) { let path = "/"; try { path = new URL(url).pathname; } catch {} const n = this.nodes.find((x) => x.domain === domain && (path.startsWith(x.url_pattern.split("{")[0]!) || x.url_pattern === path)); if (n) this.nodeVerifiedAt.set(n.id, new Date().toISOString()); }
  async clearStaleForEdges(edgeIds: string[]) { for (const id of edgeIds) { const st = this.edgeStats.get(id); if (st) st.stale = false; const e = this.edges.find((x) => x.id === id); if (e) e.stale = false; } for (const p of this.paths.values()) if (p.ordered_edge_ids.some((id) => edgeIds.includes(id))) p.stale = false; for (const c of this.pathCache) if (c.ordered_edge_ids.some((id) => edgeIds.includes(id))) c.stale = false; }
  async edgeSuccesses(edgeIds: string[]) { return edgeIds.map((id) => this.edgeStats.get(id)?.successes ?? this.edges.find((e) => e.id === id)?.successes ?? 0); }
  async listSweepSites() { return [...this.sites.values()].filter((s) => s.status === "mapped").map((s) => { const es = this.edges.filter((e) => e.domain === s.domain); return { domain: s.domain, demand_score: this.demand.filter((d) => d.domain === s.domain).length, stale_fraction: es.length ? es.filter((e) => e.stale).length / es.length : 0, last_swept_at: null }; }); }
  async saveFeedbackNote(agentId: string, pathId: string, note: string) { this.notes.push({ agentId, pathId, note }); }
  async enqueue(kind: string, payload: unknown) { this.jobs.push({ kind, payload }); }
  async findKeys(prefix: string) { return this.keys.filter((k) => k.key_prefix === prefix); }
  async touchKey(_id: string) {}
  async addMySite(agentId: string, domain: string) { await this.ensureSiteQueued(domain); if (!this.mySites.has(agentId)) this.mySites.set(agentId, new Set()); this.mySites.get(agentId)!.add(domain); }
  async removeMySite(agentId: string, domain: string) { this.mySites.get(agentId)?.delete(domain); }
  async listMySites(agentId: string) { const out: SiteRow[] = []; for (const d of this.mySites.get(agentId) ?? []) { const s = await this.getSite(d); if (s) out.push(s); } return out; }
  async countMySites(agentId: string) { return this.mySites.get(agentId)?.size ?? 0; }
  seedFixture() {
    const domain = "shop.example"; this.sites.set(domain, { domain, status: "mapped", map_version: 1, last_indexed_at: new Date().toISOString(), offers_enabled: false });
    const ids = { home: randomUUID(), search: randomUUID(), cat: randomUUID(), prod: randomUUID() };
    this.nodes.push(
      { id: ids.home, domain, map_version: 1, url_pattern: "/", kind: "home", description: "home storefront", stale: false },
      { id: ids.search, domain, map_version: 1, url_pattern: "/search?q={q}", kind: "search", description: "search brake pads products", stale: false },
      { id: ids.cat, domain, map_version: 1, url_pattern: "/brakes/{category}", kind: "category", description: "brake pads category front brakes", stale: false },
      { id: ids.prod, domain, map_version: 1, url_pattern: "/product/{id}", kind: "product", description: "brake pads product", stale: false });
    const e = (from: string, to: string, action: string, url: string | null): EdgeRow => ({ id: randomUUID(), domain, map_version: 1, from_node_id: from, to_node_id: to, action, selector: url ? null : "[data-testid=go]", url_template: url, params_schema: action === "set_vehicle" ? { required: ["year", "make", "model"] } : {}, attempts: 20, successes: 19, stale: false });
    this.edges.push(e(ids.home, ids.search, "navigate", "https://shop.example/search?q={q}"), e(ids.search, ids.cat, "navigate", "https://shop.example/brakes/brake-pads"), e(ids.cat, ids.prod, "navigate", "https://shop.example/product/{id}"));
    return this;
  }
}

export class PgStore implements Store {
  constructor(private db: DbClient) {}
  async ping() { try { await this.db.query("SELECT 1"); return true; } catch { return false; } }
  async getSite(domain: string) { const r = await this.db.query(`SELECT * FROM site WHERE domain=$1`, [domain]); const s = r.rows[0]; return s ? { domain: s.domain, status: s.status, map_version: s.map_version, last_indexed_at: iso(s.last_indexed_at), offers_enabled: !!s.offers_enabled } : null; }
  async ensureSiteQueued(domain: string) { await this.db.query(`INSERT INTO site(domain,status) VALUES($1,'queued') ON CONFLICT(domain) DO NOTHING`, [domain]); return (await this.getSite(domain))!; }
  async recordDemand(domain: string, agentId: string | null, source: string) { await this.ensureSiteQueued(domain); await this.db.query(`INSERT INTO demand_signal(domain,agent_id,source) VALUES($1,$2,$3)`, [domain, agentId, source]); }
  async queuePosition(domain: string) { const r = await this.db.query(`SELECT domain, demand_score FROM site WHERE status='queued' ORDER BY demand_score DESC, domain ASC`); const i = r.rows.findIndex((x: any) => x.domain === domain); return i >= 0 ? i + 1 : null; }
  async listNodes(domain: string) { const s = await this.getSite(domain); if (!s) return []; const r = await this.db.query(`SELECT * FROM node WHERE domain=$1 AND map_version=$2 AND stale=false`, [domain, s.map_version]); return r.rows; }
  async listEdges(domain: string) { const s = await this.getSite(domain); if (!s) return []; const r = await this.db.query(`SELECT * FROM edge WHERE domain=$1 AND map_version=$2`, [domain, s.map_version]); return r.rows.map((e: any) => ({ ...e, selector_fallbacks: e.selector_fallbacks ?? [] })); }
  async createPath(domain: string, canonical: string, edgeIds: string[]) { const r = await this.db.query(`INSERT INTO path_cache(domain,question_canonical,ordered_edge_ids) VALUES($1,$2,$3) RETURNING *`, [domain, canonical, edgeIds]); return { id: r.rows[0].id, domain, ordered_edge_ids: edgeIds, stale: !!r.rows[0].stale }; }
  async getPath(id: string) { const raw = id.replace(/^p_/, ""); const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw) ? raw : null; if (!uuid) return null; const r = await this.db.query(`SELECT * FROM path_cache WHERE id=$1`, [uuid]); const p = r.rows[0]; return p ? { id: p.id, domain: p.domain, ordered_edge_ids: p.ordered_edge_ids, stale: !!p.stale } : null; }
  async isDuplicateOutcome(agentId: string, pathId: string, h: string) { const raw = pathId.replace(/^p_/, ""); if (!/^[0-9a-f-]{36}$/i.test(raw)) return false; const r = await this.db.query(`SELECT 1 FROM event WHERE agent_id=$1 AND path_id=$2 AND type='outcome' AND metadata->>'outcome_hash'=$3 AND created_at>now()-interval '10 minutes' LIMIT 1`, [agentId, raw, h]); return r.rows.length > 0; }
  async rememberOutcome() {}
  async recordOutcome({ path, success, failedStepIndex, corroboratedBroken }: { path: PathRecord; success: boolean; failedStepIndex?: number; agentVerified: boolean; weight?: number; corroboratedBroken?: boolean }) {
    const ids = success ? path.ordered_edge_ids : path.ordered_edge_ids.slice(0, (failedStepIndex ?? path.ordered_edge_ids.length - 1) + 1);
    let stale = false;
    await this.db.transaction(async (tx) => {
      for (const id of ids) { await tx.query(`UPDATE edge SET attempts=attempts+1, successes=successes+$2, updated_at=now() WHERE id=$1`, [id, success ? 1 : 0]); }
      if (success) await tx.query(`UPDATE path_cache SET hits=hits+1, successes=successes+1, last_success_at=now() WHERE id=$1`, [path.id]);
      else { const r = await tx.query(`SELECT id FROM edge WHERE id=ANY($1) AND attempts>=10 AND (successes+9)::float/(attempts+10)<0.7`, [ids]); if (r.rows.length || corroboratedBroken) { stale = true; await tx.query(`UPDATE edge SET stale=true WHERE id=ANY($1)`, [ids]); await tx.query(`UPDATE path_cache SET stale=true WHERE id=$1`, [path.id]); } }
    });
    if (!success) await this.enqueue("reindex_branch", { domain: path.domain, node_id: ids[0] ?? path.id });
    return { branch_status: stale ? "marked_stale" as const : success ? "ok" as const : "reindex_queued" as const, duplicate: false };
  }
  async markNodeVerified(domain: string, url: string) { let p = "/"; try { p = new URL(url).pathname; } catch {} await this.db.query(`UPDATE node SET last_verified_at=now() WHERE domain=$1 AND $2 LIKE url_pattern || '%'`, [domain, p]).catch(() => {}); }
  async clearStaleForEdges(edgeIds: string[]) { await this.db.query(`UPDATE edge SET stale=false WHERE id=ANY($1)`, [edgeIds]); await this.db.query(`UPDATE path_cache SET stale=false WHERE ordered_edge_ids && $1`, [edgeIds]); }
  async edgeSuccesses(edgeIds: string[]) { if (!edgeIds.length) return []; const r = await this.db.query(`SELECT id, successes FROM edge WHERE id=ANY($1)`, [edgeIds]); const m = new Map(r.rows.map((x: any) => [x.id, x.successes])); return edgeIds.map((id) => m.get(id) ?? 0); }
  async listSweepSites() { const r = await this.db.query(`SELECT s.domain, s.demand_score, COALESCE(avg(CASE WHEN e.stale THEN 1 ELSE 0 END),0) AS stale_fraction FROM site s LEFT JOIN edge e ON e.domain=s.domain WHERE s.status='mapped' GROUP BY s.domain, s.demand_score`); return r.rows.map((x: any) => ({ domain: x.domain, demand_score: Number(x.demand_score), stale_fraction: Number(x.stale_fraction), last_swept_at: null })); }
  async listPathCache(domain: string) { const r = await this.db.query(`SELECT * FROM path_cache WHERE domain=$1 AND stale=false`, [domain]); return r.rows.map((x: any) => ({ id: x.id, domain: x.domain, question_canonical: x.question_canonical, question_embedding: x.question_embedding, ordered_edge_ids: x.ordered_edge_ids, stale: !!x.stale, last_success_at: iso(x.last_success_at), hits: x.hits })); }
  async recordPathCacheHit(id: string) { const raw = id.replace(/^p_/, ""); if (/^[0-9a-f-]{36}$/i.test(raw)) await this.db.query(`UPDATE path_cache SET hits=hits+1 WHERE id=$1`, [raw]); }
  async upsertPathCache(input: { domain: string; question_canonical: string; question_embedding: number[]; ordered_edge_ids: string[]; param_bindings: Record<string, unknown> }) { const vec = `[${input.question_embedding.join(",")}]`; const existing = await this.db.query(`SELECT * FROM path_cache WHERE domain=$1 AND question_canonical=$2 LIMIT 1`, [input.domain, input.question_canonical]); if (existing.rows[0]) return { id: existing.rows[0].id, domain: input.domain, ordered_edge_ids: input.ordered_edge_ids, stale: false }; const r = await this.db.query(`INSERT INTO path_cache(domain,question_canonical,question_embedding,ordered_edge_ids,param_bindings) VALUES($1,$2,$3::vector,$4,$5) RETURNING *`, [input.domain, input.question_canonical, vec, input.ordered_edge_ids, JSON.stringify(input.param_bindings)]); return { id: r.rows[0].id, domain: input.domain, ordered_edge_ids: input.ordered_edge_ids, stale: !!r.rows[0].stale }; }
  async saveFeedbackNote(agentId: string, pathId: string, note: string) { const raw = pathId.replace(/^p_/, ""); await this.db.query(`INSERT INTO feedback_note(agent_id,path_id,note) VALUES($1,$2,$3)`, [agentId, /^[0-9a-f-]{36}$/i.test(raw) ? raw : null, note]); }
  async enqueue(kind: string, payload: unknown) { await enqueueJob(this.db, kind, payload); }
  async findKeys(prefix: string) { const rows = await findKeysByPrefix(this.db, prefix); return rows.map((r: any) => ({ key_id: r.key_id, agent_id: r.agent_id, operator_id: r.operator_id, key_hash: r.key_hash, key_prefix: r.key_prefix, scopes: r.scopes ?? ["tools"], revoked_at: iso(r.revoked_at), tier: r.tier, verified: !!r.verified })); }
  async touchKey(keyId: string) { await touchApiKey(this.db, keyId); }
  async addMySite(agentId: string, domain: string) { await this.ensureSiteQueued(domain); await this.db.query(`INSERT INTO my_site(agent_id,domain) VALUES($1,$2) ON CONFLICT DO NOTHING`, [agentId, domain]); }
  async removeMySite(agentId: string, domain: string) { await this.db.query(`DELETE FROM my_site WHERE agent_id=$1 AND domain=$2`, [agentId, domain]); }
  async listMySites(agentId: string) { const r = await this.db.query(`SELECT s.* FROM my_site m JOIN site s ON s.domain=m.domain WHERE m.agent_id=$1 ORDER BY m.domain`, [agentId]); return r.rows.map((s: any) => ({ domain: s.domain, status: s.status, map_version: s.map_version, last_indexed_at: iso(s.last_indexed_at) })); }
  async countMySites(agentId: string) { const r = await this.db.query(`SELECT count(*)::int AS c FROM my_site WHERE agent_id=$1`, [agentId]); return r.rows[0]?.c ?? 0; }
}
export { normalizeDomain };
