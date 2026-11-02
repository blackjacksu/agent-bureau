import { describe, expect, it } from "vitest";
import { computeTrustScore } from "../src/trust.js";

describe("computeTrustScore", () => {
  it("new agent scores near the smoothed prior, not zero or 100", () => {
    const s = computeTrustScore({ outcomes: 0, successes: 0, failures: 0, step_failures: 0, live_checks: 0, queries: 0, domains: 0 });
    expect(s.score).toBeGreaterThan(40);
    expect(s.score).toBeLessThan(60);
  });
  it("proven good agent outscores proven bad agent", () => {
    const good = computeTrustScore({ outcomes: 90, successes: 88, failures: 2, step_failures: 1, live_checks: 40, queries: 50, domains: 5 });
    const bad = computeTrustScore({ outcomes: 90, successes: 20, failures: 70, step_failures: 30, live_checks: 2, queries: 50, domains: 1 });
    expect(good.score).toBeGreaterThan(bad.score + 20);
    expect(good.score).toBeLessThanOrEqual(100);
    expect(bad.score).toBeGreaterThanOrEqual(0);
  });
  it("returns explainable components summing to the score", () => {
    const s = computeTrustScore({ outcomes: 10, successes: 9, failures: 1, step_failures: 0, live_checks: 5, queries: 10, domains: 2 });
    const sum = Object.values(s.components).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - s.score)).toBeLessThanOrEqual(0.5);
  });
});
