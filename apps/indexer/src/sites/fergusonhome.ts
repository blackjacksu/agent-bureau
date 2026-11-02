import type { SiteConfig } from "./site-config.js";

/** ADR-0001 primary: home improvement (Build.com successor). Robots (*): account/checkout + sortBy/viewtype/categoryid query variants disallowed (2026-11-02). */
export const fergusonhomeConfig: SiteConfig = {
  domain: "fergusonhome.com",
  seedUrls: ["/", "/category/lighting/", "/category/plumbing/"],
  probeQueries: ["ceiling light", "kitchen faucet", "bathroom vanity"],
  kindRules: [
    { pattern: "^/category/", kind: "category" },
    { pattern: "^/product/", kind: "product" },
    { pattern: "/search", kind: "search" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign", "sortBy", "viewtype", "categoryid"],
  notes: "2026-11-02 ADR-0001: use path navigation + published sitemaps; never emit disallowed sort/view query facets as edges. Live crawl gate authoritative before first index.",
};
export default fergusonhomeConfig;
