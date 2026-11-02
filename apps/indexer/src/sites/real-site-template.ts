import type { SiteConfig } from "./site-config.js";

/**
 * Real-site-shaped config stub (plan 7.8). Prototype sites are Q2-unpicked:
 * do NOT point this at a production domain until the owner picks it.
 * To add a real site: copy this file to <domain>.ts, fill every field,
 * add classifier fixtures + bench corpus, register it in sites/index.ts.
 */
export const realSiteTemplateConfig: SiteConfig = {
  domain: "REPLACE-ME.example",
  seedUrls: ["/"],
  probeQueries: [],
  kindRules: [],
  trackingParams: [],
  searchParam: "q",
  notes: "STUB 2026-11-02: awaiting Q2 site selection. No production domain invented here.",
};
export default realSiteTemplateConfig;
