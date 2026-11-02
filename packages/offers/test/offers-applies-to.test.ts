import { describe, it, expect, vi } from "vitest";
import { getOffers, isEligible, patternMatches } from "../src/index.js";
const ctx = { optedOut: false, offersEnabled: true, domainEnabled: true, tierAllowed: true, now: new Date("2026-01-01T00:00:00Z") };
const mk = (extra: any = {}) => ({ offer_id: "o1", code: "TESTCODE-1", title: "t", discount: { type: "percent" as const, value: 10 }, expires_at: null, verified: true, last_verified_at: "2026-01-01T00:00:00.000Z", source_kind: "merchant_public_page" as const, commercial_relationship: "none", apply_hint: "x", status: "active", ...extra });
describe("applies_to matching (17.7)", () => {
  it("sitewide matches any target", () => { expect(isEligible(mk({ applies_to: { scope: "sitewide" } }) as any, ctx, { url_pattern: "/x" })).toBe(true); });
  it("category requires key overlap", () => {
    const o = mk({ applies_to: { scope: "category", category_keys: ["brakes"] } });
    expect(isEligible(o as any, ctx, { category_keys: ["brakes"] })).toBe(true);
    expect(isEligible(o as any, ctx, { category_keys: ["tires"] })).toBe(false);
    expect(isEligible(o as any, ctx, {})).toBe(false);
  });
  it("product url pattern with {id} placeholder", () => {
    expect(patternMatches("/product/{id}", "/product/42")).toBe(true);
    expect(patternMatches("/product/{id}", "/category/42")).toBe(false);
    const o = mk({ applies_to: { scope: "product", url_patterns: ["/product/{id}"] } });
    expect(isEligible(o as any, ctx, { url_pattern: "/product/42" })).toBe(true);
    expect(isEligible(o as any, ctx, { url_pattern: "/cart" })).toBe(false);
  });
  it("min-spend gate", () => {
    const o = mk({ applies_to: { scope: "sitewide", min_spend_minor: 5000 } });
    expect(isEligible(o as any, ctx, { spend_minor: 4999 })).toBe(false);
    expect(isEligible(o as any, ctx, { spend_minor: 5000 })).toBe(true);
    expect(isEligible(o as any, ctx, {})).toBe(false);
  });
  it("starts_at in future filtered; unverified/revoked/merchant_disabled filtered", () => {
    expect(isEligible(mk({ starts_at: "2027-01-01T00:00:00.000Z" }) as any, ctx)).toBe(false);
    for (const status of ["unverified", "revoked", "merchant_disabled", "expired"]) expect(isEligible(mk({ status }) as any, ctx)).toBe(false);
  });
  it("getOffers passes targetNode through eligibility", async () => {
    const p = { getOffers: vi.fn(async () => [mk({ applies_to: { scope: "category", category_keys: ["brakes"] } })] as any) };
    expect(await getOffers(p, { domain: "fixture.example", targetNode: { category_keys: ["tires"] } }, ctx)).toEqual([]);
    expect((await getOffers(p, { domain: "fixture.example", targetNode: { category_keys: ["brakes"] } }, ctx)).length).toBe(1);
  });
  it("verified offers rank before unverified with same nominal value", async () => {
    const offers = [mk({ offer_id: "unv", verified: false }), mk({ offer_id: "ver", verified: true, discount: { type: "percent", value: 5 } })] as any;
    const out = await getOffers({ getOffers: async () => offers }, { domain: "fixture.example" }, ctx);
    expect(out[0]!.offer_id).toBe("ver");
  });
});
