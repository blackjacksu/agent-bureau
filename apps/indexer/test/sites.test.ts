import { describe, expect, it } from "vitest";
import { SITE_CONFIGS, getSiteConfig } from "../src/sites/index.js";

const PRIMARIES = ["rockauto.com", "fergusonhome.com", "dermstore.com"] as const;

describe("ADR-0001 prototype site configs", () => {
  it("registers all three primary domains", () => {
    for (const d of PRIMARIES) expect(getSiteConfig(d)?.domain).toBe(d);
    expect(Object.keys(SITE_CONFIGS)).toEqual(expect.arrayContaining([...PRIMARIES]));
  });
  it.each(PRIMARIES)("%s has seeds, probes and notes", (d) => {
    const c = getSiteConfig(d)!;
    expect(c.seedUrls.length).toBeGreaterThan(0);
    expect(c.probeQueries.length).toBeGreaterThanOrEqual(3);
    expect(c.notes).toContain("ADR-0001");
  });
  it("rockauto declares the vehicle picker (fitment tasks)", () => {
    expect(getSiteConfig("rockauto.com")?.vehiclePicker).toBe(true);
  });
  it("dermstore/fergusonhome never seed disallowed query facets", () => {
    for (const d of ["dermstore.com", "fergusonhome.com"]) {
      for (const s of getSiteConfig(d)!.seedUrls) {
        expect(s).not.toMatch(/facetFilters=|sortBy=|search=\?/);
      }
    }
  });
});
