import type { SiteConfig } from "./site-config.js";

/** ADR-0003 primary: skincare. Robots: Search-Show/cart/account/checkout disallowed — category navigation only (2026-11-02). */
export const paulaschoiceConfig: SiteConfig = {
  domain: "paulaschoice.com",
  seedUrls: ["/", "/skin-care", "/sunscreen"],
  probeQueries: ["vitamin c serum", "exfoliant", "moisturizer"],
  kindRules: [
    { pattern: "skin-care|skin_care", kind: "category" },
    { pattern: "\\.html$", kind: "product" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign"],
  notes: "2026-11-02 ADR-0003: substituted for dermstore.com after live bot-wall. Brand-led skincare catalogue; category navigation only. Live crawl published 75 nodes/76 edges in bounded smoke.",
};
export default paulaschoiceConfig;
