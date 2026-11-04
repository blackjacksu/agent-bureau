/** Deterministic synthetic commerce corpus for agent-commerce MCP scale tests.
 *
 * 1000 synthetic storefronts x 1000 purchasable items each = 1,000,000 items.
 * Nothing here is crawled live and nothing is committed as data: every domain,
 * product, and HTML page is derived arithmetically from (siteIdx, itemIdx), so
 * the suite proves million-item scale while staying fast and hermetic.
 * Domains use .example and never touch the network.
 */

export const COMMERCE_SITE_COUNT = 1000;
export const COMMERCE_ITEMS_PER_SITE = 1000;
export const COMMERCE_TOTAL_ITEMS = COMMERCE_SITE_COUNT * COMMERCE_ITEMS_PER_SITE;

export interface CommerceVertical {
  key: string;
  label: string;
  keyword: string;
}

export const COMMERCE_VERTICALS: CommerceVertical[] = [
  { key: "auto-brakes", label: "Brake Pads", keyword: "brake pads" },
  { key: "home-paint", label: "Interior Paint", keyword: "interior paint" },
  { key: "beauty-serum", label: "Vitamin C Serum", keyword: "vitamin c serum" },
  { key: "lighting-chandelier", label: "Chandelier", keyword: "chandelier" },
  { key: "apparel-jacket", label: "Rain Jacket", keyword: "rain jacket" },
  { key: "grocery-coffee", label: "Whole Bean Coffee", keyword: "whole bean coffee" },
  { key: "electronics-headphones", label: "Headphones", keyword: "headphones" },
  { key: "sports-dumbbell", label: "Dumbbell", keyword: "dumbbell" },
  { key: "pet-food", label: "Dog Food", keyword: "dog food" },
  { key: "office-chair", label: "Office Chair", keyword: "office chair" },
];

export interface CommerceProduct {
  id: string;
  domain: string;
  name: string;
  category: string;
  priceMinor: number;
  currency: "USD";
  availability: "InStock";
  url: string;
}

export function commerceDomain(siteIdx: number): string {
  if (!Number.isInteger(siteIdx) || siteIdx < 0 || siteIdx >= COMMERCE_SITE_COUNT) {
    throw new RangeError(`siteIdx out of range: ${siteIdx}`);
  }
  return `store${String(siteIdx).padStart(4, "0")}.commerce.example`;
}

export function commerceVertical(siteIdx: number): CommerceVertical {
  return COMMERCE_VERTICALS[siteIdx % COMMERCE_VERTICALS.length]!;
}

export function probeQueryFor(siteIdx: number): string {
  return commerceVertical(siteIdx).keyword;
}

/** Deterministic 32-bit hash of (siteIdx, itemIdx). */
export function commerceHash(siteIdx: number, itemIdx: number): number {
  let h = (Math.imul(siteIdx + 1, 374761393) + Math.imul(itemIdx + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0);
}

export function productFor(siteIdx: number, itemIdx: number): CommerceProduct {
  if (!Number.isInteger(itemIdx) || itemIdx < 0 || itemIdx >= COMMERCE_ITEMS_PER_SITE) {
    throw new RangeError(`itemIdx out of range: ${itemIdx}`);
  }
  const domain = commerceDomain(siteIdx);
  const vertical = commerceVertical(siteIdx);
  const h = commerceHash(siteIdx, itemIdx);
  const id = `p-${siteIdx}-${itemIdx}`;
  return {
    id,
    domain,
    name: `${vertical.label} ${String(itemIdx).padStart(4, "0")} Pro`,
    category: vertical.key,
    priceMinor: 999 + (h % 99000),
    currency: "USD",
    availability: "InStock",
    url: `https://${domain}/product/${id}`,
  };
}

/** A product is purchasable when an agent could buy it: priced, in stock, product URL. */
export function isPurchasable(p: CommerceProduct): boolean {
  return (
    p.priceMinor > 0 &&
    p.currency === "USD" &&
    p.availability === "InStock" &&
    p.url.includes("/product/") &&
    p.domain.length > 0 &&
    p.name.length > 0
  );
}

/** Total purchasable items without materializing a million objects. */
export function totalPurchasableCount(): number {
  return COMMERCE_TOTAL_ITEMS;
}

export function listCommerceDomains(): string[] {
  const out: string[] = new Array(COMMERCE_SITE_COUNT);
  for (let i = 0; i < COMMERCE_SITE_COUNT; i++) out[i] = commerceDomain(i);
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Simulated site search: probe keyword matches the site's vertical, so every
 *  site returns purchasable hits for its own probe query. Generic queries match
 *  by token overlap against the vertical + product name. */
export function searchSite(siteIdx: number, query: string, limit = 25): CommerceProduct[] {
  const q = norm(query);
  if (!q) return [];
  const vertical = commerceVertical(siteIdx);
  const haystack = norm(`${vertical.label} ${vertical.keyword} ${vertical.key}`);
  const tokens = q.split(" ").filter(Boolean);
  const matchesVertical = tokens.every((t) => haystack.includes(t));
  // Product-name lookup: "pro 0042" style suffix also resolves.
  const byIndex = tokens.length > 0 ? productIndexFromQuery(tokens) : null;
  if (byIndex !== null && byIndex >= 0 && byIndex < COMMERCE_ITEMS_PER_SITE) {
    return [productFor(siteIdx, byIndex)];
  }
  if (!matchesVertical) return [];
  const out: CommerceProduct[] = [];
  for (let i = 0; i < COMMERCE_ITEMS_PER_SITE && out.length < limit; i++) {
    out.push(productFor(siteIdx, i));
  }
  return out;
}

function productIndexFromQuery(tokens: string[]): number | null {
  for (const t of tokens) {
    if (/^\d{1,4}$/.test(t)) {
      const n = Number(t);
      if (Number.isInteger(n) && n >= 0 && n < COMMERCE_ITEMS_PER_SITE) return n;
    }
  }
  return null;
}

// --- Synthetic storefront HTML (parseable by the indexer, never fetched) ---

export function homeHtml(siteIdx: number): string {
  const domain = commerceDomain(siteIdx);
  const vertical = commerceVertical(siteIdx);
  const featured = productFor(siteIdx, siteIdx % COMMERCE_ITEMS_PER_SITE);
  return `<!doctype html><html><head><title>Store ${siteIdx} - ${vertical.label}</title></head><body>
<h1>Store ${siteIdx} ${vertical.label}</h1>
<form action="/search" method="get" data-testid="search-form"><input name="q" type="search"><button>Search</button></form>
<a href="/category/${vertical.key}" data-testid="cat-main">${vertical.label}</a>
<a href="/product/${featured.id}" data-testid="featured-product">${featured.name}</a>
<a href="https://${domain}/cart" aria-label="Cart">Cart</a>
</body></html>`;
}

export function categoryHtml(siteIdx: number): string {
  const vertical = commerceVertical(siteIdx);
  const first = productFor(siteIdx, 0);
  const second = productFor(siteIdx, 1);
  return `<!doctype html><html><head><title>${vertical.label}</title></head><body><h1>${vertical.label}</h1>
<div data-facet="brand"><span data-facet-option="BrandA">BrandA</span><span data-facet-option="BrandB">BrandB</span></div>
<a href="/product/${first.id}">${first.name}</a><a href="/product/${second.id}">${second.name}</a></body></html>`;
}

export function searchHtml(siteIdx: number, query: string): string {
  const hits = searchSite(siteIdx, query, 10);
  const links = hits.map((p) => `<a href="/product/${p.id}">${p.name}</a>`).join("");
  return `<!doctype html><html><head><title>Search results</title></head><body><h1>Search results for ${query}</h1>${links}</body></html>`;
}

export function productHtml(siteIdx: number, itemIdx: number): string {
  const p = productFor(siteIdx, itemIdx);
  const price = (p.priceMinor / 100).toFixed(2);
  return `<!doctype html><html><head><title>${p.name}</title><script type="application/ld+json">{"@type":"Product","name":${JSON.stringify(p.name)},"offers":{"price":${JSON.stringify(price)},"priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><h1>${p.name}</h1><p>$${price} In stock</p><button data-testid="add-to-cart">Add to cart</button></body></html>`;
}

export interface CommerceCrawlChain {
  domain: string;
  probeQuery: string;
  product: CommerceProduct;
  /** Simulated crawl path: home -> search -> product. */
  chain: { url: string; kind: string }[];
}

/** Simulated crawl-through: home, then probe search, then first purchasable product. */
export function crawlSiteForProduct(siteIdx: number): CommerceCrawlChain {
  const domain = commerceDomain(siteIdx);
  const probeQuery = probeQueryFor(siteIdx);
  const hits = searchSite(siteIdx, probeQuery, 1);
  const product = hits[0] ?? productFor(siteIdx, 0);
  return {
    domain,
    probeQuery,
    product,
    chain: [
      { url: `https://${domain}/`, kind: "home" },
      { url: `https://${domain}/search?q=${encodeURIComponent(probeQuery)}`, kind: "search" },
      { url: product.url, kind: "product" },
    ],
  };
}
