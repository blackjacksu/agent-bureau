import { describe, expect, it } from "vitest";
import { baselinesFromBenchRows, estimateTokensSaved } from "../src/tokens-saved.js";

describe("estimateTokensSaved (ADR-0002)", () => {
  const baselines = baselinesFromBenchRows([{ domain: "rockauto.com", taskClass: "brake pads {year} {make} {model}", armAMedianTokens: 2000 }]);
  it("baseline minus mapped cost, floored at 0", () => {
    expect(estimateTokensSaved({ domain: "rockauto.com", taskClass: "brake pads {year} {make} {model}", mappedResponseText: "x".repeat(400), baselines })).toBe(1900);
    expect(estimateTokensSaved({ domain: "rockauto.com", taskClass: "brake pads {year} {make} {model}", mappedResponseText: "x".repeat(40000), baselines })).toBe(0);
  });
  it("null (never invented) without a baseline for domain or task class", () => {
    expect(estimateTokensSaved({ domain: "unknown.example", taskClass: "x", mappedResponseText: "hi", baselines })).toBeNull();
    expect(estimateTokensSaved({ domain: "rockauto.com", taskClass: "unknown class", mappedResponseText: "hi", baselines })).toBeNull();
  });
});
