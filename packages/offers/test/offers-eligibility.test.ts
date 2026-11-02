import { describe, it, expect, vi } from "vitest";
import { EmptyOfferProvider, rankOffers, getOffers, isEligible } from "../src/index.js";
import type { EligibilityContext } from "../src/index.js";

// Plan 17.7 (Phase 0): fixtures use TESTCODE-* values only, fixture domains only.
// Note: plan 17.7 `applies_to` (sitewide/category/url-pattern/min-spend) matching is
// NOT implemented in src: the contracts Offer schema has no applies_to field and
// isEligible's `target` parameter is unused. Those cases are reported as unresolved
// rather than asserted against an invented API.

const NOW = new Date("2026-01-01T00:00:00Z");
const baseCtx: EligibilityContext = {
  optedOut: false,
  offersEnabled: true,
  domainEnabled: true,
  tierAllowed: true,
  now: NOW,
};

type OfferLike = Parameters<typeof isEligible>[0];
const mk = (v: number, extra: Record<string, unknown> = {}): OfferLike =>
  ({
    offer_id: "o" + v,
    code: "TESTCODE-" + v,
    title: "t",
    discount: { type: "percent" as const, value: v },
    expires_at: null,
    verified: true,
    last_verified_at: "2026-01-01T00:00:00.000Z",
    source_kind: "merchant_public_page" as const,
    commercial_relationship: "none",
    apply_hint: "x",
    ...extra,
  }) as OfferLike;

describe("isEligible flag matrix (17.7)", () => {
  it("eligible only when every flag allows", () => {
    expect(isEligible(mk(10), baseCtx)).toBe(true);
  });
  it.each([
    ["optedOut", { optedOut: true }],
    ["offersEnabled off", { offersEnabled: false }],
    ["domainEnabled off", { domainEnabled: false }],
    ["tierAllowed off", { tierAllowed: false }],
  ] as const)("ineligible when %s", (_name, patch) => {
    expect(isEligible(mk(10), { ...baseCtx, ...patch })).toBe(false);
  });
  it("full 2^4 flag matrix: only all-allowed is eligible", () => {
    for (let mask = 0; mask < 16; mask++) {
      const ctx: EligibilityContext = {
        optedOut: Boolean(mask & 1),
        offersEnabled: Boolean(mask & 2),
        domainEnabled: Boolean(mask & 4),
        tierAllowed: Boolean(mask & 8),
        now: NOW,
      };
      expect(isEligible(mk(10), ctx)).toBe(mask === 0b1110);
    }
  });
});

describe("getOffers opt-out-first, provider zero calls (17.7)", () => {
  it.each([
    ["optedOut", { optedOut: true }],
    ["offersEnabled off", { offersEnabled: false }],
    ["domainEnabled off", { domainEnabled: false }],
    ["tierAllowed off", { tierAllowed: false }],
  ] as const)("returns [] without calling provider when %s", async (_name, patch) => {
    const p = { getOffers: vi.fn(async () => [mk(10)] as any) };
    expect(await getOffers(p, { domain: "fixture.example" }, { ...baseCtx, ...patch })).toEqual([]);
    expect(p.getOffers).not.toHaveBeenCalled();
  });

  it("calls provider exactly once with the given args when eligible", async () => {
    const args = { domain: "fixture.example" };
    const p = { getOffers: vi.fn(async () => [mk(10)] as any) };
    const out = await getOffers(p, args, baseCtx);
    expect(p.getOffers).toHaveBeenCalledTimes(1);
    expect(p.getOffers).toHaveBeenCalledWith(args);
    expect(out.map((o: any) => o.offer_id)).toEqual(["o10"]);
  });

  it("provider returning [] yields []", async () => {
    const p = { getOffers: vi.fn(async () => [] as any) };
    expect(await getOffers(p, { domain: "fixture.example" }, baseCtx)).toEqual([]);
    expect(p.getOffers).toHaveBeenCalledTimes(1);
  });
});

describe("isEligible status and expiry filtering (17.7)", () => {
  it.each(["inactive", "expired", "paused", "draft"])(
    "wrong status %j is filtered",
    (status) => {
      expect(isEligible(mk(10, { status }), baseCtx)).toBe(false);
    },
  );
  it("status active passes, missing status passes", () => {
    expect(isEligible(mk(10, { status: "active" }), baseCtx)).toBe(true);
    expect(isEligible(mk(10), baseCtx)).toBe(true);
  });
  it("expiry boundary: expired at exactly now, valid just after", () => {
    expect(isEligible(mk(10, { expires_at: "2025-12-31T23:59:59.999Z" }), baseCtx)).toBe(false);
    expect(isEligible(mk(10, { expires_at: "2026-01-01T00:00:00.000Z" }), baseCtx)).toBe(false);
    expect(isEligible(mk(10, { expires_at: "2026-01-01T00:00:00.001Z" }), baseCtx)).toBe(true);
    expect(isEligible(mk(10, { expires_at: null }), baseCtx)).toBe(true);
  });
  it("getOffers filters wrong-status and expired before ranking", async () => {
    const offers = [
      mk(50, { status: "inactive" }),
      mk(40, { expires_at: "2020-01-01T00:00:00.000Z" }),
      mk(10, { status: "active" }),
    ] as any;
    const out = await getOffers({ getOffers: async () => offers }, { domain: "fixture.example" }, baseCtx);
    expect(out.map((o: any) => o.discount.value)).toEqual([10]);
  });
});

describe("rankOffers ordering and 3-cap (17.7)", () => {
  it("sorts by discount value descending and caps at 3", () => {
    const out = rankOffers([mk(5), mk(20), mk(10), mk(15), mk(1)] as any);
    expect(out.map((o: any) => o.discount.value)).toEqual([20, 15, 10]);
    expect(out).toHaveLength(3);
  });
  it("tie-breaks equal discounts by last_verified_at descending", () => {
    const older = mk(10, { last_verified_at: "2025-01-01T00:00:00.000Z" });
    const newer = mk(10, { offer_id: "o-new", last_verified_at: "2026-06-01T00:00:00.000Z" });
    const out = rankOffers([older, newer] as any);
    expect(out.map((o: any) => o.offer_id)).toEqual(["o-new", "o10"]);
  });
  it("treats missing discount value as 0", () => {
    const noValue = mk(0, { discount: { type: "info" } });
    const valued = mk(5);
    const out = rankOffers([noValue, valued] as any);
    expect(out.map((o: any) => o.offer_id)).toEqual(["o5", "o0"]);
  });
  it("does not mutate the input array", () => {
    const input = [mk(5), mk(20), mk(10)] as any;
    const snapshot = [...input];
    rankOffers(input);
    expect(input).toEqual(snapshot);
  });
  it("empty and single inputs pass through", () => {
    expect(rankOffers([])).toEqual([]);
    expect(rankOffers([mk(7)] as any).map((o: any) => o.offer_id)).toEqual(["o7"]);
  });
});

describe("EmptyOfferProvider and TESTCODE fixtures (17.7)", () => {
  it("always [] regardless of args", async () => {
    const provider = new EmptyOfferProvider();
    expect(await provider.getOffers({ domain: "fixture.example" })).toEqual([]);
    expect(await provider.getOffers({ domain: "other.example", question: "x" })).toEqual([]);
  });
  it("every fabricated code in this suite is TESTCODE-* or null", async () => {
    const offers = [mk(1), mk(2, { code: null }), mk(3)];
    for (const o of offers as any[]) {
      expect(o.code === null || /^TESTCODE-/.test(o.code)).toBe(true);
    }
    const out = await getOffers(
      { getOffers: async () => offers as any },
      { domain: "fixture.example" },
      baseCtx,
    );
    expect(out.every((o: any) => o.code === null || /^TESTCODE-/.test(o.code))).toBe(true);
  });
});
