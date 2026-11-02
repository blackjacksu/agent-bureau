import type { SiteConfig } from "./site-config.js";
import { miniAutoPartsConfig } from "./mini-auto-parts.js";
import { realSiteTemplateConfig } from "./real-site-template.js";
import { rockautoConfig } from "./rockauto.js";
import { fergusonhomeConfig } from "./fergusonhome.js";
import { dermstoreConfig } from "./dermstore.js";
import { carpartsConfig } from "./carparts.js";
import { shadesoflightConfig } from "./shadesoflight.js";
import { paulaschoiceConfig } from "./paulaschoice.js";

export * from "./site-config.js";
export { miniAutoPartsConfig, realSiteTemplateConfig, rockautoConfig, fergusonhomeConfig, dermstoreConfig, carpartsConfig, shadesoflightConfig, paulaschoiceConfig };

/** Registry: one entry per config file. Template stub is intentionally excluded until filled. */
export const SITE_CONFIGS: Record<string, SiteConfig> = {
  [miniAutoPartsConfig.domain]: miniAutoPartsConfig,
  [rockautoConfig.domain]: rockautoConfig,
  [fergusonhomeConfig.domain]: fergusonhomeConfig,
  [dermstoreConfig.domain]: dermstoreConfig,
  [carpartsConfig.domain]: carpartsConfig,
  [shadesoflightConfig.domain]: shadesoflightConfig,
  [paulaschoiceConfig.domain]: paulaschoiceConfig,
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
