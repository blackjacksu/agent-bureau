import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus.js";

const FILES: Record<string, string> = {
  "rockauto.com": "corpus/rockauto.json",
  "fergusonhome.com": "corpus/fergusonhome.json",
  "dermstore.com": "corpus/dermstore.json",
  "carparts.com": "corpus/carparts.json",
  "shadesoflight.com": "corpus/shadesoflight.json",
  "paulaschoice.com": "corpus/paulaschoice.json",
};

describe("ADR-0001 real-site bench corpora", () => {
  for (const [domain, file] of Object.entries(FILES)) {
    it(`${domain}: 20 valid real tasks`, () => {
      const c = loadCorpus(new URL(`../${file}`, import.meta.url).pathname);
      expect(c.site_kind).toBe("real");
      expect(c.tasks).toHaveLength(20);
      for (const t of c.tasks) {
        expect(t.domain).toBe(domain);
        expect(t.question.length).toBeGreaterThan(5);
        expect(t.expected_url_pattern.length).toBeGreaterThan(2);
      }
    });
  }
  it("rockauto fitment tasks require year/make/model", () => {
    const c = loadCorpus(new URL("../corpus/rockauto.json", import.meta.url).pathname);
    const fitment = c.tasks.filter((t) => t.required_params.includes("year"));
    expect(fitment.length).toBeGreaterThanOrEqual(15);
  });
});
