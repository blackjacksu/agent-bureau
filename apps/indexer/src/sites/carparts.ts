import type { SiteConfig } from "./site-config.js";

/** ADR-0003 primary: auto parts. Robots: /search, /results/ disallowed — category navigation only (checked 2026-11-02). */
export const carpartsConfig: SiteConfig = {
  domain: "carparts.com",
  seedUrls: ["/", "/parts", "/bumper", "/radiator", "/headlight"],
  probeQueries: ["brake pads", "headlight", "mirror"],
  kindRules: [
    { pattern: "^/v/", kind: "category" },
    { pattern: "^/product/", kind: "product" },
  ],
  trackingParams: ["utm_source", "utm_medium", "utm_campaign"],
  vehiclePicker: true,
  notes: "2026-11-02 ADR-0003: substituted for rockauto.com after live bot-wall (ADR-0001 gate). Search/result paths robots-disallowed; map via category paths. Live crawl published 50 nodes/50 edges in bounded smoke.",
};
export default carpartsConfig;
