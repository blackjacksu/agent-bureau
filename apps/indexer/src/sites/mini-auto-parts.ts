import type { SiteConfig } from "./site-config.js";

/** Fixture mini auto-parts site (plan 17.6). Domain is a fixture host, not a production pick. */
export const miniAutoPartsConfig: SiteConfig = {
  domain: "mini-auto.example",
  seedUrls: ["/", "/search", "/category/brakes"],
  probeQueries: ["brake pads", "oil filter"],
  kindRules: [
    { pattern: "^/category/", kind: "category" },
    { pattern: "^/product/", kind: "product" },
    { pattern: "^/vehicle", kind: "category" },
  ],
  trackingParams: ["session_id"],
  searchParam: "q",
  vehiclePicker: true,
  notes: "2026-11-02: fixture site for indexer integration tests; search at /search?q=, facets as ?brand=, vehicle picker /vehicle?year=&make=&model=.",
};
export default miniAutoPartsConfig;
