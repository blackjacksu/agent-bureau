import { describe, expect, it } from "vitest";
import {
  COMMERCE_ITEMS_PER_SITE,
  COMMERCE_SITE_COUNT,
  COMMERCE_TOTAL_ITEMS,
  crawlSiteForProduct,
  commerceDomain,
  isPurchasable,
  listCommerceDomains,
  probeQueryFor,
  productFor,
  productHtml,
  homeHtml,
  searchHtml,
  searchSite,
  totalPurchasableCount,
} from "./corpus.js";
import { parsePage } from "../../apps/indexer/src/discover/page.js";
import { classifyKind } from "../../apps/indexer/src/discover/classify.js";

describe("agent-commerce scale corpus (1000 stores x 1000 items)", () => {
  it("registers 1000 distinct commerce sites", () => {
    const domains = listCommerceDomains();
    expect(domains).toHaveLength(COMMERCE_SITE_COUNT);
    expect(new Set(domains).size).toBe(COMMERCE_SITE_COUNT);
    for (const d of domains) {
      expect(d).toMatch(/^store\d{4}\.commerce\.example$/);
    }
  });

  it("every site sells something: crawl finds a purchasable product", () => {
    for (let site = 0; site < COMMERCE_SITE_COUNT; site++) {
      const found = crawlSiteForProduct(site);
      expect(found.domain).toBe(commerceDomain(site));
      expect(found.chain.map((c) => c.kind)).toEqual(["home", "search", "product"]);
      expect(isPurchasable(found.product)).toBe(true);
      expect(found.product.domain).toBe(found.domain);
    }
  }, 30_000);

  it("every site search returns a purchasable item for its probe query", () => {
    for (let site = 0; site < COMMERCE_SITE_COUNT; site++) {
      const hits = searchSite(site, probeQueryFor(site), 5);
      expect(hits.length).toBeGreaterThan(0);
      for (const p of hits) expect(isPurchasable(p)).toBe(true);
    }
  }, 30_000);

  it("catalog totals one million purchasable items", () => {
    expect(COMMERCE_SITE_COUNT).toBe(1000);
    expect(COMMERCE_ITEMS_PER_SITE).toBe(1000);
    expect(totalPurchasableCount()).toBe(1_000_000);
    expect(COMMERCE_TOTAL_ITEMS).toBe(1_000_000);

    // One full site materialized (1000 items), one sample per remaining site.
    // Full arithmetic total is derived, not allocated.
    for (let item = 0; item < COMMERCE_ITEMS_PER_SITE; item++) {
      expect(isPurchasable(productFor(0, item))).toBe(true);
    }
    for (let site = 1; site < COMMERCE_SITE_COUNT; site++) {
      expect(isPurchasable(productFor(site, (site * 7) % COMMERCE_ITEMS_PER_SITE))).toBe(true);
    }
  }, 30_000);

  it("sampled storefronts expose crawler-discoverable buyable structure", () => {
    for (let site = 0; site < COMMERCE_SITE_COUNT; site += 100) {
      const domain = commerceDomain(site);
      const probe = probeQueryFor(site);
      const homeUrl = `https://${domain}/`;
      const searchUrl = `https://${domain}/search?q=${encodeURIComponent(probe)}`;
      const product = productFor(site, site % COMMERCE_ITEMS_PER_SITE);

      const home = parsePage(homeHtml(site), homeUrl);
      expect(classifyKind(homeUrl)).toBe("home");
      expect(home.forms.some((f) => f.isSearch)).toBe(true);

      const search = parsePage(searchHtml(site, probe), searchUrl);
      expect(classifyKind(searchUrl)).toBe("search");
      expect(search.links.some((l) => l.href.includes("/product/"))).toBe(true);

      const page = parsePage(productHtml(site, site % COMMERCE_ITEMS_PER_SITE), product.url);
      expect(page.hasProductSchema).toBe(true);
      expect(classifyKind(product.url)).toBe("product");
      expect(page.html).toMatch(/add-to-cart/i);
      expect(page.html).toMatch(/\$\d+\.\d{2}/);
    }
  }, 30_000);
});
