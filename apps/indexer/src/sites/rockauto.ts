import type { SiteConfig } from "./site-config.js";

/** ADR-0001 primary: auto parts. Robots (*): only /info/, /cgi-bin/ disallowed (checked 2026-11-02). */
export const rockautoConfig: SiteConfig = {
  domain: "rockauto.com",
  seedUrls: ["/", "/en/catalog/"],
  probeQueries: ["brake pads", "oil filter", "alternator"],
  kindRules: [
    { pattern: "/en/catalog/[^/]+/[^/]+/", kind: "category" },
    { pattern: "/en/partsearch/", kind: "search" },
    { pattern: "/en/moreinfo\\.php", kind: "product" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign"],
  vehiclePicker: true,
  notes: "2026-11-02 ADR-0001: catalog is year/make/model driven; fitment via catalog path segments, not query facets. Live crawl gate (robots/opt-out/bot-wall) is authoritative before first index.",
};
export default rockautoConfig;
