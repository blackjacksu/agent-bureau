import { describe, it, expect } from "vitest";
import { parsePriceText, parseLocalizedNumber, extractJsonLd } from "../src/extract/price.js";
import { extractStock, stockFromAvailability } from "../src/extract/stock.js";
import { LiveVerifier, extractFromHtml } from "../src/verifier.js";
import { InMemoryVerifyCache, urlHash } from "../src/fetch/cache.js";
import { assertPublicUrl, isPrivateIp } from "../src/fetch/ssrf.js";
import { playwrightAvailable } from "../src/fetch/browser-fetch.js";

const publicDns = async () => [{ address: "93.184.216.34" }];
function fakeFetch(html: string, status = 200) {
  return async () => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => html });
}
const jsonLdPage = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Pads","offers":{"@type":"Offer","price":"49.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><div class="price">$55.00</div></body></html>`;

describe("price parser (10.1)", () => {
  it("minor units + locales", () => {
    expect(parsePriceText("$1,299.99")).toEqual({ amount_minor: 129999, currency: "USD" });
    expect(parsePriceText("1.299,99 €")).toEqual({ amount_minor: 129999, currency: "EUR" });
    expect(parsePriceText("1299,99 EUR")).toEqual({ amount_minor: 129999, currency: "EUR" });
    expect(parsePriceText("£25.50")).toEqual({ amount_minor: 2550, currency: "GBP" });
    expect(parseLocalizedNumber("1,299.99")).toBe(1299.99);
    expect(parseLocalizedNumber("1.299,99")).toBe(1299.99);
  });
  it("rejects ranges", () => { expect(parsePriceText("$10.00 - $20.00")).toBeNull(); });
  it("JSON-LD first, conflict flagged", () => {
    expect(extractJsonLd(jsonLdPage).price).toEqual({ amount_minor: 4999, currency: "USD" });
    const ex = extractFromHtml(jsonLdPage);
    expect(ex.price).toEqual({ amount_minor: 4999, currency: "USD" });
    expect(ex.source).toBe("json_ld");
    // selector $55 vs JSON-LD $49.99 differs >1 minor -> conflict, JSON-LD wins
    expect(ex.extractorConflict).toBe(true);
    expect(ex.stock).toBe("in_stock");
  });
});

describe("stock phrases (10.1)", () => {
  it("phrase tables", () => {
    expect(extractStock("<p>Only 3 left in stock</p>")).toBe("low_stock");
    expect(extractStock("<p>Out of stock</p>")).toBe("out_of_stock");
    expect(extractStock("<p>In stock, add to cart</p>")).toBe("in_stock");
    expect(extractStock("<p>Hello</p>")).toBe("unknown");
    expect(stockFromAvailability("https://schema.org/OutOfStock")).toBe("out_of_stock");
  });
});

describe("LiveVerifier ladder + cache + SSRF (10.2/17.6)", () => {
  it("ok via HTTP JSON-LD, then 30s cache source, expiry -> live", async () => {
    let now = 1_000_000;
    const cache = new InMemoryVerifyCache(30_000, () => now);
    const v = new LiveVerifier({ fetchFn: fakeFetch(jsonLdPage), dnsLookup: publicDns, cache, now: () => now });
    const first = await v.check("https://shop.example/product/1");
    expect(first).toMatchObject({ status: "ok", price: { amount_minor: 4999, currency: "USD" }, stock: "in_stock", source: "live" });
    const second = await v.check("https://shop.example/product/1");
    expect(second.source).toBe("cache");
    now += 31_000;
    const third = await v.check("https://shop.example/product/1");
    expect(third.source).toBe("live");
    expect(v.metrics.extractorConflicts).toBeGreaterThanOrEqual(1);
  });
  it("404 -> not_found, 403 -> blocked", async () => {
    const v404 = new LiveVerifier({ fetchFn: fakeFetch("gone", 404), dnsLookup: publicDns });
    expect((await v404.check("https://shop.example/gone")).status).toBe("not_found");
    const v403 = new LiveVerifier({ fetchFn: fakeFetch("captcha", 403), dnsLookup: publicDns });
    expect((await v403.check("https://shop.example/wall")).status).toBe("blocked");
  });
  it("browser ladder used when HTTP has no markers", async () => {
    const v = new LiveVerifier({
      fetchFn: fakeFetch("<html><body>Loading...</body></html>"), dnsLookup: publicDns,
      browserFetcher: { fetchRendered: async () => ({ status: 200, html: jsonLdPage }) },
    });
    const r = await v.check("https://shop.example/spa-product");
    expect(r.price).toEqual({ amount_minor: 4999, currency: "USD" });
    expect(v.metrics.lastRung).toBe("browser");
  });
  it("SSRF guard rejects private/localhost without fetching", async () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", publicDns)).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://localhost/admin", publicDns)).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://127.0.0.1/x", publicDns)).rejects.toThrow(/private/);
    let fetched = false;
    const v = new LiveVerifier({ fetchFn: async () => { fetched = true; return fakeFetch("{}")(); }, dnsLookup: publicDns });
    await expect(v.check("http://169.254.169.254/")).rejects.toThrow(/private/);
    expect(fetched).toBe(false);
  });
  it("handleLiveCheck validates contracts shape", async () => {
    const v = new LiveVerifier({ fetchFn: fakeFetch(jsonLdPage), dnsLookup: publicDns });
    const r = await v.handleLiveCheck({ url: "https://shop.example/p/9", fields: ["price", "stock"] });
    expect(r.checked_at).toBeTruthy(); expect(urlHash("https://x.example")).toHaveLength(64);
  });
  it("playwright availability honestly reported", async () => {
    const a = await playwrightAvailable(); expect(typeof a).toBe("boolean");
  });
});
