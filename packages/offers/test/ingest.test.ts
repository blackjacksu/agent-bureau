import { describe, expect, it } from "vitest";
import { extractPublicOffers, nextOfferStatus } from "../src/ingest.js";

describe("extractPublicOffers (C1: public page only)", () => {
  it("extracts data-attribute and 'use code' mentions plus % off hints", () => {
    const html = `<div data-promo-code="SAVE10">x</div><p>Use code BRAKE20 at checkout</p><span>15% off brake pads this week</span>`;
    const out = extractPublicOffers(html, "shop.example", "src1");
    const codes = out.map((o) => o.code);
    expect(codes).toContain("SAVE10");
    expect(codes).toContain("BRAKE20");
    expect(out.some((o) => o.discount.type === "percent" && o.discount.value === 15)).toBe(true);
    for (const o of out) { expect(o.status).toBe("unverified"); expect(o.verified).toBe(false); expect(o.source_kind).toBe("merchant_public_page"); }
  });
  it("rejects placeholder codes and dedupes", () => {
    const out = extractPublicOffers(`<p>use code EXAMPLE here</p><p>use code REAL5</p><p>use code REAL5 again</p>`, "shop.example", "s");
    expect(out.map((o) => o.code)).toEqual(["REAL5"]);
  });
  it("empty page yields no offers", () => {
    expect(extractPublicOffers("<html><body>hello</body></html>", "x.example", "s")).toEqual([]);
  });
});

describe("nextOfferStatus (verify loop)", () => {
  const base = { status: "active" } as any;
  it("still published stays/becomes active; expired wins", () => {
    expect(nextOfferStatus(base, { stillPublished: true, expired: false }, 0)).toBe("active");
    expect(nextOfferStatus(base, { stillPublished: true, expired: true }, 0)).toBe("expired");
  });
  it("three consecutive misses -> unverified; terminal states sticky", () => {
    expect(nextOfferStatus(base, { stillPublished: false, expired: false }, 2)).toBe("unverified");
    expect(nextOfferStatus(base, { stillPublished: false, expired: false }, 0)).toBe("active");
    expect(nextOfferStatus({ status: "revoked" } as any, { stillPublished: true, expired: false }, 0)).toBe("revoked");
    expect(nextOfferStatus({ status: "merchant_disabled" } as any, { stillPublished: true, expired: false }, 0)).toBe("merchant_disabled");
  });
});
