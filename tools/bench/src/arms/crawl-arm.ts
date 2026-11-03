import { extractLinks } from "../raw-arm.js";

/**
 * C1 optimized HTTP crawl arm (speed benchmark): tries to beat MCP without any map.
 * Levers (flags, ablatable): sitemap index jump, direct search-URL jump, link ranking v2,
 * early stop, warm in-run HTTP cache, bounded parallelism for candidate fetches.
 * It receives ONLY the question — never the expected pattern (judge-only, enforced by tests).
 */
export interface CrawlResult {
  final_url: string;
  visited: string[];
  tokens: number;
  pages: number;
  wall_ms: number;
  stop_reason: "target_like_url" | "no_more_links" | "max_steps" | "fetch_failed";
  fetches: number;
}

export interface CrawlFlags {
  sitemap?: boolean;
  searchJump?: boolean;
  earlyStop?: boolean;
  maxSteps?: number;
  delayMs?: number;
}

const STOP = new Set(["a", "an", "the", "for", "me", "find", "please", "i", "need", "want", "to", "of", "on", "in", "with", "my"]);
const stem = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);
export const qTokens = (s: string) => [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).map(stem))];
const overlap = (qt: Set<string>, s: string) => {
  const ts = new Set(qTokens(s));
  return [...qt].filter((t) => ts.has(t)).length;
};

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;
const defaultFetch: FetchText = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "AgentMapBot/0.1 (+https://agentmap.example/bot)" } });
  return { status: r.status, text: await r.text() };
};

export class HttpCache {
  private map = new Map<string, { status: number; text: string }>();
  async get(url: string, fetchText: FetchText) {
    const hit = this.map.get(url);
    if (hit) return { ...hit, cached: true as const };
    const r = await fetchText(url).catch(() => ({ status: 0, text: "" }));
    this.map.set(url, r);
    return { ...r, cached: false as const };
  }
  get size() { return this.map.size; }
}

export async function crawlArm(
  startUrl: string,
  question: string,
  opts: { flags?: CrawlFlags; fetchText?: FetchText; cache?: HttpCache } = {},
): Promise<CrawlResult> {
  const flags: Required<CrawlFlags> = { sitemap: true, searchJump: true, earlyStop: true, maxSteps: 6, delayMs: 0, ...(opts.flags ?? {}) } as Required<CrawlFlags>;
  const fetchText = opts.fetchText ?? defaultFetch;
  const cache = opts.cache;
  const qt = new Set(qTokens(question));
  const t0 = Date.now();
  let tokens = 0, fetches = 0;
  const visited: string[] = [];
  const seen = new Set<string>();

  const get = async (url: string) => {
    fetches++;
    if (cache) {
      const r = await cache.get(url, fetchText);
      // Tokens always count: a warm cache saves network time, not context ingestion.
      tokens += Math.ceil(r.text.length / 4);
      return r;
    }
    const r = await fetchText(url).catch(() => ({ status: 0, text: "" }));
    tokens += Math.ceil(r.text.length / 4);
    return r;
  };
  const targetLike = (url: string) => overlap(qt, new URL(url).pathname) >= Math.min(2, qt.size);

  const origin = new URL(startUrl).origin;

  // Lever 1: sitemap jump — best sitemap URL by question tokens wins a direct visit.
  if (flags.sitemap) {
    const sm = await get(`${origin}/sitemap.xml`);
    if (sm.status === 200 && sm.text.includes("<loc>")) {
      const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
      const best = locs.map((u) => ({ u, s: overlap(qt, u) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= Math.ceil(qt.size / 2)) {
        visited.push(best.u);
        return { final_url: best.u, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "target_like_url", fetches };
      }
    }
  }

  // Lever 2: direct search jump.
  if (flags.searchJump) {
    for (const candidate of [`${origin}/search?q=${encodeURIComponent(question)}`, `${origin}/search?search=${encodeURIComponent(question)}`]) {
      const r = await get(candidate);
      if (r.status !== 200) continue;
      const links = extractLinks(r.text, candidate);
      const good = links.filter((l) => overlap(qt, `${l.text} ${l.url}`) >= 1);
      if (good.length) {
        visited.push(candidate);
        const best = good.map((l) => ({ l, s: overlap(qt, `${l.text} ${l.url}`) })).sort((a, b) => b.s - a.s)[0]!.l;
        visited.push(best.url);
        return { final_url: best.url, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "target_like_url", fetches };
      }
      break;
    }
  }

  // Lever 3+: ranked link walk with early stop.
  let current = startUrl;
  for (let step = 0; step < flags.maxSteps; step++) {
    if (seen.has(current)) break;
    seen.add(current);
    visited.push(current);
    if (flags.earlyStop && step > 0 && targetLike(current)) {
      return { final_url: current, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "target_like_url", fetches };
    }
    const r = await get(current);
    if (r.status !== 200 || !r.text) {
      return { final_url: current, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "fetch_failed", fetches };
    }
    const links = extractLinks(r.text, current).filter((l) => l.url.startsWith(origin) && !seen.has(l.url));
    const ranked = links.map((l) => ({ l, s: overlap(qt, `${l.text} ${new URL(l.url).pathname}`) })).sort((a, b) => b.s - a.s);
    const best = ranked[0];
    if (!best || best.s === 0) {
      return { final_url: current, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "no_more_links", fetches };
    }
    current = best.l.url;
    if (flags.delayMs) await new Promise((r) => setTimeout(r, flags.delayMs));
  }
  return { final_url: current, visited, tokens, pages: visited.length, wall_ms: Date.now() - t0, stop_reason: "max_steps", fetches };
}
