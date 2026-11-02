import { randomUUID } from "node:crypto";
import type { NodeKind } from "../discover/classify.js";
import { classifyKind } from "../discover/classify.js";
import { rankSelectors } from "../discover/classify.js";
import { canonicalizeUrl, toUrlPattern, placeholderNames } from "./url-template.js";
import type { PageSnapshot } from "../discover/page.js";
import type { SiteConfig } from "../sites/site-config.js";

export interface BuiltNode {
  id: string; domain: string; map_version: number; url_pattern: string; kind: NodeKind;
  description: string; embedding?: number[]; embedding_model?: string; stale: false;
  example_url: string;
}
export interface BuiltEdge {
  id: string; domain: string; map_version: number; from_node_id: string; to_node_id: string;
  action: string; selector: string | null; selector_fallbacks: string[]; url_template: string | null;
  params_schema: Record<string, unknown>; attempts: number; successes: number; stale: false;
  observed: "probe" | "static";
}
export interface BuiltGraph { domain: string; map_version: number; nodes: BuiltNode[]; edges: BuiltEdge[] }

function descriptionFor(kind: NodeKind, pattern: string, config: SiteConfig): string {
  return `${kind} page at ${pattern} on ${config.domain}`;
}
function paramsSchemaFor(template: string): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  for (const p of placeholderNames(template)) schema[p] = { type: "string" };
  return schema;
}

/** Plan 7.5.1: assemble + dedupe nodes by (url_pattern,kind), edges from links/forms/facets. */
export function buildGraph(domain: string, version: number, pages: PageSnapshot[], config: SiteConfig): BuiltGraph {
  const nodeByKey = new Map<string, BuiltNode>();
  const nodeFor = (rawUrl: string, snap?: PageSnapshot): BuiltNode => {
    const canonical = canonicalizeUrl(rawUrl, config.trackingParams);
    const pattern = toUrlPattern(canonical, config.trackingParams);
    const kind = classifyKind(canonical, {
      hasSearchForm: snap?.forms.some((f) => f.isSearch), hasFacets: (snap?.facets.length ?? 0) > 0,
      hasProductSchema: snap?.hasProductSchema, headings: snap?.headings,
    }, config.kindRules);
    const key = `${pattern}|${kind}`;
    let node = nodeByKey.get(key);
    if (!node) {
      node = { id: randomUUID(), domain, map_version: version, url_pattern: pattern, kind, description: descriptionFor(kind, pattern, config), stale: false, example_url: canonical };
      nodeByKey.set(key, node);
    }
    return node;
  };
  // First pass: nodes for fetched pages
  for (const p of pages) nodeFor(p.url, p);
  const edges: BuiltEdge[] = []; const edgeKeys = new Set<string>();
  const addEdge = (e: Omit<BuiltEdge, "id" | "domain" | "map_version" | "attempts" | "successes" | "stale">) => {
    const key = `${e.from_node_id}>${e.to_node_id}|${e.action}|${e.url_template ?? ""}|${e.selector ?? ""}|${JSON.stringify(e.params_schema)}`;
    if (edgeKeys.has(key)) return; edgeKeys.add(key);
    edges.push({ ...e, id: randomUUID(), domain, map_version: version, attempts: 0, successes: 0, stale: false });
  };
  for (const page of pages) {
    const from = nodeFor(page.url, page);
    for (const link of page.links) {
      let target: URL; try { target = new URL(link.href); } catch { continue; }
      if (target.hostname.replace(/^www\./, "") !== new URL(page.url).hostname.replace(/^www\./, "")) continue;
      const to = nodeFor(link.href);
      const template = to.url_pattern.includes("{") ? to.url_pattern : canonicalizeUrl(link.href, config.trackingParams);
      // url_template is absolute-ish path template; store full template when pattern has placeholders else canonical URL
      const ranked = rankSelectors(link.selectorHints);
      addEdge({ from_node_id: from.id, to_node_id: to.id, action: "navigate", selector: ranked.primary, selector_fallbacks: ranked.fallbacks, url_template: template.startsWith("http") ? template : `${new URL(page.url).origin}${template}`, params_schema: paramsSchemaFor(template), observed: "static" });
    }
    for (const form of page.forms) {
      if (!form.isSearch) continue;
      const param = config.searchParam ?? "q";
      const actionUrl = new URL(form.action);
      const template = `${actionUrl.pathname}?${param}={${param}}`;
      const toPattern = template;
      // Ensure a search node exists for template
      const canonicalSearch = `${actionUrl.origin}${actionUrl.pathname}?${param}=x`;
      const to = nodeFor(canonicalSearch);
      to.url_pattern = toPattern; // learned search template
      const ranked = rankSelectors(form.selectorHints);
      addEdge({ from_node_id: from.id, to_node_id: to.id, action: "navigate", selector: ranked.primary, selector_fallbacks: ranked.fallbacks, url_template: `${actionUrl.origin}${template}`, params_schema: { [param]: { type: "string" } }, observed: "probe" });
    }
    for (const facet of page.facets) {
      addEdge({ from_node_id: from.id, to_node_id: from.id, action: "filter", selector: `[data-facet="${facet.name}"]`, selector_fallbacks: [], url_template: null, params_schema: { [facet.name]: { type: "string", enum: facet.options } }, observed: "static" });
    }
    if (config.vehiclePicker && /vehicle/i.test(page.url)) {
      addEdge({ from_node_id: from.id, to_node_id: from.id, action: "set_vehicle", selector: null, selector_fallbacks: [], url_template: `${new URL(page.url).origin}/vehicle?year={year}&make={make}&model={model}`, params_schema: { year: { type: "integer" }, make: { type: "string" }, model: { type: "string" } }, observed: "static" });
    }
  }
  let nodes = [...nodeByKey.values()];
  nodes = dropOrphans(nodes, edges);
  const kept = new Set(nodes.map((n) => n.id));
  return { domain, map_version: version, nodes, edges: edges.filter((e) => kept.has(e.from_node_id) && kept.has(e.to_node_id)) };
}

/** Drop nodes unreachable from home in <=6 hops, except product reachable via a search node. */
export function dropOrphans(nodes: BuiltNode[], edges: BuiltEdge[]): BuiltNode[] {
  const home = nodes.find((n) => n.kind === "home"); if (!home) return nodes;
  const adj = new Map<string, string[]>();
  for (const e of edges) { if (e.from_node_id === e.to_node_id) continue; adj.set(e.from_node_id, [...(adj.get(e.from_node_id) ?? []), e.to_node_id]); }
  const reachable = new Set<string>([home.id]); let frontier = [home.id];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) for (const t of adj.get(id) ?? []) if (!reachable.has(t)) { reachable.add(t); next.push(t); }
    frontier = next;
  }
  const searchIds = new Set(nodes.filter((n) => n.kind === "search" && reachable.has(n.id)).map((n) => n.id));
  const viaSearch = new Set<string>();
  if (searchIds.size) for (const e of edges) if (searchIds.has(e.from_node_id)) viaSearch.add(e.to_node_id);
  return nodes.filter((n) => reachable.has(n.id) || (n.kind === "product" && viaSearch.has(n.id)) || n.id === home.id);
}

export interface ValidationResult { ok: boolean; errors: string[] }
/** Plan 7.5.3 pre-publish validation. selectorCheck is injected spot-check (10 sampled edges in caller). */
export function validateGraph(graph: BuiltGraph, selectorCheck?: (edge: BuiltEdge) => boolean): ValidationResult {
  const errors: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (!ids.has(e.from_node_id) || !ids.has(e.to_node_id)) errors.push(`edge ${e.id} target missing`);
    if (e.url_template) {
      for (const p of placeholderNames(e.url_template)) if (!(p in e.params_schema)) errors.push(`edge ${e.id} template placeholder {${p}} not in params_schema`);
    }
    if (!e.url_template && !e.selector) errors.push(`edge ${e.id} has neither url_template nor selector`);
  }
  const home = graph.nodes.find((n) => n.kind === "home");
  if (!home) errors.push("no home node");
  if (!graph.nodes.some((n) => n.kind === "search" || n.kind === "category")) errors.push("no search or category path");
  if (home) {
    const reachable = new Set([home.id]); const q = [home.id];
    while (q.length) { const cur = q.shift()!; for (const e of graph.edges) if (e.from_node_id === cur && !reachable.has(e.to_node_id)) { reachable.add(e.to_node_id); q.push(e.to_node_id); } }
    if (reachable.size <= 1 && graph.nodes.length > 1) errors.push("home cannot reach any node");
  }
  if (selectorCheck) {
    const sampled = graph.edges.filter((e) => e.selector).slice(0, 10);
    for (const e of sampled) if (!selectorCheck(e)) errors.push(`selector spot-check failed for edge ${e.id}`);
  }
  return { ok: errors.length === 0, errors };
}
