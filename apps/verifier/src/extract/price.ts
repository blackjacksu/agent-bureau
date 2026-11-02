export interface PriceValue { amount_minor: number; currency: string }
export interface ExtractedPrice { price: PriceValue | null; source: "json_ld" | "selector" | "heuristic" | "none"; confidence: number }

const CURRENCY_SYMBOLS: Record<string, string> = { "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND"]);

export function parsePriceText(text: string, defaultCurrency = "USD"): PriceValue | null {
  const t = text.trim().replace(/\u00a0/g, " ");
  // Reject ranges: " $10 - $20 " ambiguous (plan 10.1.3)
  const range = t.match(/[$£€¥]\s?[\d.,]+\s*[-–—]\s*[$£€¥]?\s?[\d.,]+/);
  if (range) return null;
  const m = t.match(/(?:([$£€¥])\s?|([A-Z]{3})\s?)([\d.,]+)|\b([\d.,]+)\s?([A-Z]{3})\b|\b([\d.,]+)\s?([$£€¥])/);
  if (!m) return null;
  const symbol = m[1] ?? m[7]; const code = m[2] ?? m[5]; const numRaw = m[3] ?? m[4] ?? m[6]!;
  const currency = (code ?? CURRENCY_SYMBOLS[symbol ?? "$"] ?? defaultCurrency).toUpperCase();
  const amount = parseLocalizedNumber(numRaw);
  if (amount === null || amount < 0) return null;
  const minor = ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);
  return { amount_minor: minor, currency };
}

/** Locale separators: 1,299.99 (US), 1.299,99 / 1299,99 (EU), 1 299,99 (FR-ish). */
export function parseLocalizedNumber(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(","); const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is decimal separator; dots are thousands
    if (s.indexOf(",") !== lastComma) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s); return Number.isFinite(n) ? n : null;
}

export function extractJsonLd(html: string): { price: PriceValue | null; availability: string | null } {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]!.trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        const graph = item?.["@graph"] ? item["@graph"] : [item];
        for (const node of graph) {
          if (!node || typeof node !== "object") continue;
          const offers = node.offers; const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer?.price != null || offer?.priceSpecification?.price != null) {
            const rawPrice = offer.price ?? offer.priceSpecification.price;
            const currency = String(offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? "USD");
            const n = typeof rawPrice === "number" ? rawPrice : parseLocalizedNumber(String(rawPrice));
            if (n !== null) return { price: { amount_minor: ZERO_DECIMAL.has(currency) ? Math.round(n) : Math.round(n * 100), currency }, availability: offer.availability ? String(offer.availability) : null };
          }
          if (node.price != null) {
            const n = typeof node.price === "number" ? node.price : parseLocalizedNumber(String(node.price));
            if (n !== null) return { price: { amount_minor: Math.round(n * 100), currency: "USD" }, availability: null };
          }
        }
      }
    } catch { /* try next block */ }
  }
  return { price: null, availability: null };
}

export function extractMetaPrice(html: string): PriceValue | null {
  const amount = html.match(/property="product:price:amount"[^>]*content="([\d.,]+)"|content="([\d.,]+)"[^>]*property="product:price:amount"/i);
  const curr = html.match(/property="product:price:currency"[^>]*content="([A-Z]{3})"/i);
  if (!amount) return null;
  const n = parseLocalizedNumber(amount[1] ?? amount[2]!); if (n === null) return null;
  const currency = curr?.[1] ?? "USD";
  return { amount_minor: ZERO_DECIMAL.has(currency) ? Math.round(n) : Math.round(n * 100), currency };
}

export function extractHeuristicPrice(html: string): PriceValue | null {
  // Currency pattern near buy-box / price class; plain text fallback low confidence handled by caller
  const classPrice = html.match(/class="[^"]*(?:price|buy-box|offer-price)[^"]*"[^>]*>([\s\S]{0,200}?)<\//i);
  if (classPrice) { const p = parsePriceText(classPrice[1]!.replace(/<[^>]+>/g, " ")); if (p) return p; }
  const m = html.replace(/<script[\s\S]*?<\/script>/gi, "").match(/(?:\$|£|€)\s?[\d.,]+/);
  return m ? parsePriceText(m[0]) : null;
}

export function extractSelectorPrice(html: string, selectors: string[] = []): PriceValue | null {
  for (const sel of selectors) {
    const cls = sel.replace(/^\./, "").replace(/"/g, "");
    const m = html.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]{0,200}?)<\\/`, "i"));
    if (m) { const p = parsePriceText(m[1]!.replace(/<[^>]+>/g, " ")); if (p) return p; }
  }
  return null;
}
