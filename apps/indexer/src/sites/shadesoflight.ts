import type { SiteConfig } from "./site-config.js";

/** ADR-0003 primary: home improvement (lighting-led). Live crawl published 233 nodes / 263 edges (2026-11-02). */
export const shadesoflightConfig: SiteConfig = {
  domain: "shadesoflight.com",
  seedUrls: ["/", "/lighting", "/ceiling-lights"],
  probeQueries: ["chandelier", "table lamp", "pendant light"],
  kindRules: [
    { pattern: "lighting", kind: "category" },
    { pattern: "^/product/", kind: "product" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign"],
  notes: "2026-11-02 ADR-0003: substituted for fergusonhome.com after live bot-wall. Lighting-led home category coverage, recorded honestly in ADR-0003.",
};
export default shadesoflightConfig;
