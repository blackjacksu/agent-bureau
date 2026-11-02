import type { SiteConfig } from "./site-config.js";
import { miniAutoPartsConfig } from "./mini-auto-parts.js";
import { realSiteTemplateConfig } from "./real-site-template.js";

export * from "./site-config.js";
export { miniAutoPartsConfig, realSiteTemplateConfig };

/** Registry: one entry per config file. Template stub is intentionally excluded until filled. */
export const SITE_CONFIGS: Record<string, SiteConfig> = {
  [miniAutoPartsConfig.domain]: miniAutoPartsConfig,
};
export function getSiteConfig(domain: string): SiteConfig | null {
  return SITE_CONFIGS[domain.toLowerCase().replace(/^www\./, "")] ?? null;
}
export function configForDomain(domain: string, baseUrl: string): SiteConfig {
  const existing = getSiteConfig(domain);
  if (existing) return existing;
  return {
    domain, seedUrls: [baseUrl], probeQueries: [], kindRules: [], trackingParams: [],
    searchParam: "q", notes: "generated fallback config (no per-site tuning)",
  };
}
