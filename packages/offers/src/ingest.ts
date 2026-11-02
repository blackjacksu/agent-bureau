import type { OfferRecord } from "./types.js";

/**
 * Public-page offer ingestion (plan 16.2 C1): ONLY codes a merchant publishes
 * openly on its own pages. Extracts explicit code mentions ("use code X",
 * data-promo-code attributes) plus discount hints. Never login-walled, never
 * single-use-looking (long random strings are rejected), never from sessions.
 */
const CODE_BLACKLIST = /^(TEST|EXAMPLE|SAMPLE|XXXX|CODE|PROMO)$/i;
export function extractPublicOffers(html: string, domain: string, sourceId: string): OfferRecord[] {
  const found = new Map<string, OfferRecord>();
  const add = (code: string | null, title: string, percent: number | null) => {
    const key = code ?? title;
    if (found.has(key)) return;
    found.set(key, {
      offer_id: `o_${domain.replace(/\W/g, "_")}_${found.size + 1}`,
      code,
      title: title.slice(0, 120),
      discount: percent ? { type: "percent", value: percent } : { type: "info", value: null },
      expires_at: null,
      verified: false,
      last_verified_at: null,
      source_kind: "merchant_public_page",
      commercial_relationship: "Listed from the merchant's public page; no affiliate relationship asserted.",
      apply_hint: "Enter at checkout — AgentMap does not apply codes for you.",
      status: "unverified",
      starts_at: null,
    } as OfferRecord);
  };
  for (const m of html.matchAll(/data-(?:promo-?code|coupon-?code)=["']([A-Za-z0-9_-]{3,32})["']/gi)) add(m[1]!, `Code ${m[1]}`, null);
  for (const m of html.matchAll(/(?:use|enter|apply)\s+(?:code|promo|coupon)\s*[:#]?\s*["“']?([A-Z0-9][A-Z0-9_-]{2,31})["”']?/gi)) {
    if (!CODE_BLACKLIST.test(m[1]!)) add(m[1]!.toUpperCase(), `Code ${m[1]!.toUpperCase()}`, null);
  }
  for (const m of html.matchAll(/(\d{1,2})\s*%\s*off[^<]{0,60}/gi)) {
    const pct = Number(m[1]);
    if (pct >= 5 && pct <= 90) add(null, `${pct}% off`, pct);
  }
  return [...found.values()];
}

/** Verify loop transition (plan 16.4.5): 3 consecutive misses -> unverified; confirmed gone -> expired. Pure. */
export function nextOfferStatus(offer: OfferRecord, check: { stillPublished: boolean; expired: boolean }, consecutiveMisses: number): OfferRecord["status"] {
  if (offer.status === "revoked" || offer.status === "merchant_disabled") return offer.status;
  if (check.expired) return "expired";
  if (check.stillPublished) return "active";
  return consecutiveMisses + 1 >= 3 ? "unverified" : offer.status;
}
