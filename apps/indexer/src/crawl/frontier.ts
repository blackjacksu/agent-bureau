import { canonicalizeUrl } from "../emit/url-template.js";
import { parseRobots, evaluateGate, detectBotWall, isRobotsAllowed, type ParsedRobots } from "./robots.js";
import { buildGraph, validateGraph, type BuiltGraph } from "../emit/graph-builder.js";
import type { PageFetcher } from "./browser-pool.js";
import type { PageSnapshot } from "../discover/page.js";
import { discoverSitemapUrls } from "./sitemap.js";
import { resolveLimits, type SiteConfig } from "../sites/site-config.js";

export interface EmbedPort { embed(text: string): Promise<number[]>; model?: string }
export interface GraphStorePort {
  currentVersion(domain: string): Promise<number>;
  publish(graph: BuiltGraph, robots: ParsedRobots | null): Promise<void>;
  markStatus?(domain: string, status: string, robots?: ParsedRobots | null): Promise<void>;
}
export interface CrawlDeps {
  fetcher: PageFetcher;
  store?: GraphStorePort;
  embed?: EmbedPort;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  legalReviewRequired?: ReadonlySet<string>;
  legalCleared?: boolean;
  siteStatus?: string | null;
  selectorCheck?: (e: any) => boolean;
}
export type CrawlResult =
  | { status: "published"; graph: BuiltGraph; pagesFetched: number; probesRun: number }
  | { status: "blocked"; reason: string; pagesFetched: number }
  | { status: "opted_out" | "legal_hold" | "failed"; reason: string; pagesFetched: number };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Plan 7.2-7.5 bounded crawl loop. One domain, per-domain concurrency 1 by construction. */
export async function crawlSite(config: SiteConfig, baseUrl: string, deps: CrawlDeps): Promise<CrawlResult> {
  const sleep = deps.sleep ?? realSleep; const now = deps.now ?? Date.now;
  const limits = resolveLimits(config);
  const origin = new URL(baseUrl).origin;
  // Robots first (before any page fetch)
  let robots: ParsedRobots | null = null;
  if (deps.fetcher.fetchText) {
    try { const r = await deps.fetcher.fetchText(`${origin}/robots.txt`); if (r.status < 400) robots = parseRobots(r.text); } catch { robots = null; }
  }
  const gate = evaluateGate({ domain: config.domain, siteStatus: deps.siteStatus, robots, legalReviewRequired: deps.legalReviewRequired, legalCleared: deps.legalCleared });
  if (gate.action === "opted_out") { await deps.store?.markStatus?.(config.domain, "opted_out", robots); return { status: "opted_out", reason: "opted_out", pagesFetched: 0 }; }
  if (gate.action === "legal_hold") return { status: "legal_hold", reason: gate.reason, pagesFetched: 0 };
  if (gate.action === "blocked") { await deps.store?.markStatus?.(config.domain, "blocked", robots); return { status: "blocked", reason: gate.reason, pagesFetched: 0 }; }
  const delayMs = Math.max(gate.crawlDelaySec, limits.interPageDelaySec) * 1000;

  const start = now();
  const seen = new Set<string>(); const pages: PageSnapshot[] = [];
  let failures = 0; let attempts = 0; let probesRun = 0;
  interface Item { url: string; depth: number; prominence: number }
  const frontier: Item[] = [];
  const enqueue = (url: string, depth: number, prominence: number) => {
    let can: string; try { can = canonicalizeUrl(new URL(url, origin).toString(), config.trackingParams); } catch { return; }
    const u = new URL(can); if (u.origin !== origin) return;
    if (robots && !isAllowedPath(robots, u.pathname)) return;
    if (seen.has(can)) return; seen.add(can); frontier.push({ url: can, depth, prominence });
  };
  enqueue(baseUrl, 0, 0);
  for (const s of config.seedUrls) enqueue(new URL(s, origin).toString(), 0, 1);
  // Sitemap seeding (Angle 3): diverse URLs at depth 1, after link-discovered depth-1 pages, within maxPages.
  if (config.useSitemap !== false && deps.fetcher.fetchText) {
    try {
      const ft = deps.fetcher.fetchText.bind(deps.fetcher);
      const found = await discoverSitemapUrls(ft, origin, robots?.sitemaps ?? [], { maxUrls: config.sitemapMaxUrls ?? 300, sleep, delayMs: delayMs });
      found.forEach((u, i) => enqueue(u, 1, 1000 + i));
    } catch { /* sitemap discovery is best-effort */ }
  }

  const fetchWithRetries = async (url: string): Promise<PageSnapshot> => {
    let lastErr: unknown;
    for (let i = 0; i <= limits.retriesPerPage; i++) {
      try { return await deps.fetcher.fetch(url); } catch (e) { lastErr = e; if (i < limits.retriesPerPage) await sleep(i === 0 ? 2000 : 8000); }
    }
    throw lastErr;
  };

  while (frontier.length) {
    frontier.sort((a, b) => a.depth - b.depth || a.prominence - b.prominence);
    const item = frontier.shift()!;
    if (pages.length >= limits.maxPages) break;
    if (item.depth > limits.maxDepth) continue;
    if (now() - start > limits.maxWallTimeMs) break;
    if (pages.length > 0 || attempts > 0) await sleep(delayMs);
    attempts++;
    let snap: PageSnapshot;
    try { snap = await fetchWithRetries(item.url); } catch { failures++; if (attempts >= 5 && failures / attempts > limits.errorBudget) return { status: "failed", reason: "error_budget_exhausted", pagesFetched: pages.length }; continue; }
    if (detectBotWall({ status: snap.status, html: snap.html, title: snap.title }) || snap.botWall) {
      await deps.store?.markStatus?.(config.domain, "blocked", robots);
      return { status: "blocked", reason: "bot_protection", pagesFetched: pages.length };
    }
    if (snap.status >= 500) { failures++; if (attempts >= 5 && failures / attempts > limits.errorBudget) return { status: "failed", reason: "error_budget_exhausted", pagesFetched: pages.length }; continue; }
    if (snap.status >= 400) { failures++; continue; }
    pages.push(snap);
    if (item.depth < limits.maxDepth) snap.links.forEach((l, i) => enqueue(l.href, item.depth + 1, i));
  }

  // Interaction probes: search queries against learned search action (bounded 2-3)
  const searchFormPage = pages.find((p) => p.forms.some((f) => f.isSearch));
  if (searchFormPage && config.probeQueries.length) {
    const form = searchFormPage.forms.find((f) => f.isSearch)!;
    const param = config.searchParam ?? "q";
    for (const q of config.probeQueries.slice(0, 3)) {
      if (pages.length >= limits.maxPages) break;
      const url = `${new URL(form.action).origin}${new URL(form.action).pathname}?${param}=${encodeURIComponent(q)}`;
      if (seen.has(canonicalizeUrl(url, config.trackingParams))) continue;
      seen.add(canonicalizeUrl(url, config.trackingParams));
      await sleep(delayMs);
      try { const snap = await deps.fetcher.fetch(url); if (snap.status < 400 && !snap.botWall) { pages.push(snap); probesRun++; } } catch { /* probe failure is not fatal */ }
    }
  }

  if (!pages.length) return { status: "failed", reason: "no_pages_fetched", pagesFetched: 0 };
  const current = deps.store ? await deps.store.currentVersion(config.domain) : 0;
  const graph = buildGraph(config.domain, current + 1, pages, config);

  if (deps.embed) {
    let embedFailures = 0;
    for (const n of graph.nodes) {
      try { n.embedding = await deps.embed.embed(`${n.kind} ${n.url_pattern} ${n.description}`); n.embedding_model = deps.embed.model; }
      catch { embedFailures++; }
    }
    if (graph.nodes.length && embedFailures / graph.nodes.length > 0.05) return { status: "failed", reason: "embedding_failure_over_5pct", pagesFetched: pages.length };
  }
  const validation = validateGraph(graph, deps.selectorCheck);
  if (!validation.ok) return { status: "failed", reason: `validation_failed: ${validation.errors.join("; ")}`, pagesFetched: pages.length };
  if (deps.store) await deps.store.publish(graph, robots);
  return { status: "published", graph, pagesFetched: pages.length, probesRun };
}

function isAllowedPath(robots: ParsedRobots, path: string): boolean {
  return isRobotsAllowed(robots, path);
}
