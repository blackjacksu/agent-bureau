import type { KindRule } from "../discover/classify.js";

export interface CrawlLimits {
  maxPages: number; maxDepth: number; maxWallTimeMs: number;
  globalConcurrency: number; perDomainConcurrency: number;
  interPageDelaySec: number; retriesPerPage: number; errorBudget: number;
}
/** Plan 7.6 defaults. */
export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 2000, maxDepth: 6, maxWallTimeMs: 45 * 60_000,
  globalConcurrency: 4, perDomainConcurrency: 1,
  interPageDelaySec: 1, retriesPerPage: 2, errorBudget: 0.2,
};

/** Plan 7.8 per-site config. Adding a site = one file exporting this + classifier fixtures. */
export interface SiteConfig {
  domain: string;
  seedUrls: string[];
  probeQueries: string[];
  kindRules: KindRule[];
  trackingParams: string[];
  limitOverrides?: Partial<CrawlLimits>;
  searchParam?: string; // query param for search template, default "q"
  vehiclePicker?: boolean;
  useSitemap?: boolean; // seed the frontier from sitemap(s); default true
  sitemapMaxUrls?: number; // diverse sample size, default 300
  notes: string; // quirks log, dated
}

export function resolveLimits(config: SiteConfig): CrawlLimits {
  return { ...DEFAULT_LIMITS, ...(config.limitOverrides ?? {}) };
}
export function limitsFromEnv(env: Record<string, string | undefined>, config: SiteConfig): CrawlLimits {
  const base = resolveLimits(config);
  const num = (v: string | undefined, fallback: number) => { const n = Number(v); return v !== undefined && Number.isFinite(n) && n > 0 ? n : fallback; };
  return {
    ...base,
    maxPages: num(env.CRAWL_MAX_PAGES, base.maxPages),
    maxDepth: num(env.CRAWL_MAX_DEPTH, base.maxDepth),
  };
}
