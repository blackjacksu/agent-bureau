import type { SiteConfig } from "./site-config.js";

/** ADR-0001 primary: skincare. Robots (*): search=/facetFilters/sort query params + checkout disallowed (2026-11-02). */
export const dermstoreConfig: SiteConfig = {
  domain: "dermstore.com",
  seedUrls: ["/", "/c/skin-care/", "/c/sunscreen/"],
  probeQueries: ["vitamin c serum", "sunscreen SPF 50", "retinol"],
  kindRules: [
    { pattern: "^/c/", kind: "category" },
    { pattern: "\\.html$", kind: "product" },
    { pattern: "/search", kind: "search" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign", "search", "facetFilters", "sortBy", "sortOrder"],
  notes: "2026-11-02 ADR-0001: path-based navigation only; query-facet edges are robots-disallowed and must not be emitted. If the map needs disallowed facets, escalate to ADR backup review. Live crawl gate authoritative before first index.",
};
export default dermstoreConfig;
