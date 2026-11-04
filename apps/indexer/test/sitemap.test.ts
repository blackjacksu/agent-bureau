import { describe, it, expect } from "vitest";
import { parseSitemapXml, selectDiverseUrls, pathShape, discoverSitemapUrls } from "../src/crawl/sitemap.js";
import { crawlSite } from "../src/crawl/frontier.js";
import { parsePage } from "../src/discover/page.js";
import { miniAutoPartsConfig } from "../src/sites/mini-auto-parts.js";

const urlset = (...u: string[]) => `<?xml version="1.0"?><urlset>${u.map((x) => `<url><loc>${x}</loc></url>`).join("")}</urlset>`;
const index = (...u: string[]) => `<sitemapindex>${u.map((x) => `<sitemap><loc>${x}</loc></sitemap>`).join("")}</sitemapindex>`;

describe("sitemap parsing", () => {
  it("reads urlset, index, CDATA and entities", () => {
    expect(parseSitemapXml(urlset("https://x.example/a?b=1&amp;c=2")).urls).toEqual(["https://x.example/a?b=1&c=2"]);
    expect(parseSitemapXml(index("https://x.example/s1.xml")).sitemaps).toEqual(["https://x.example/s1.xml"]);
    expect(parseSitemapXml("<urlset><url><loc><![CDATA[https://x.example/z]]></loc></url></urlset>").urls).toEqual(["https://x.example/z"]);
  });
  it("collapses ids and long slugs in path shapes", () => {
    expect(pathShape("https://x.example/product/12345")).toBe("/product/{x}");
    expect(pathShape("https://x.example/category/brakes")).toBe("/category/brakes");
  });
  it("diverse selection: a huge product list cannot crowd out categories", () => {
    const products = Array.from({ length: 500 }, (_, i) => `https://x.example/product/${i}`);
    const cats = ["brakes", "filters", "lights"].map((c) => `https://x.example/category/${c}`);
    const out = selectDiverseUrls([...products, ...cats], 10);
    expect(out).toHaveLength(10);
    for (const c of cats) expect(out).toContain(c);
    expect(out.filter((u) => u.includes("/product/")).length).toBeLessThanOrEqual(7);
  });
});

describe("discoverSitemapUrls", () => {
  const origin = "https://shop.example";
  it("follows an index, skips blog/gz/off-site children, tolerates errors, rewrites www", async () => {
    const files: Record<string, string> = {
      "https://shop.example/sitemap_index.xml": index("https://shop.example/cats.xml", "https://shop.example/blog/sitemap.xml", "https://shop.example/p.xml.gz", "https://evil.example/s.xml", "https://shop.example/missing.xml"),
      "https://shop.example/cats.xml": urlset("https://www.shop.example/category/brakes", "https://other.example/category/nope"),
    };
    const asked: string[] = [];
    const ft = async (u: string) => { asked.push(u); return files[u] ? { status: 200, text: files[u]! } : { status: 404, text: "" }; };
    const out = await discoverSitemapUrls(ft, origin, ["https://shop.example/sitemap_index.xml"]);
    expect(out).toEqual(["https://shop.example/category/brakes"]);
    expect(asked.some((u) => /blog|\.gz|evil/.test(u))).toBe(false);
  });
  it("falls back to /sitemap.xml and respects maxFiles", async () => {
    const asked: string[] = [];
    await discoverSitemapUrls(async (u) => { asked.push(u); return { status: 404, text: "" }; }, origin, []);
    expect(asked).toEqual(["https://shop.example/sitemap.xml"]);
  });
});

describe("crawlSite sitemap seeding", () => {
  const html = (t: string) => `<html><head><title>${t}</title></head><body><h1>${t}</h1></body></html>`;
  const mk = (pagesSeen: string[], withSitemap = true) => ({
    async fetchText(url: string) {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return { status: 200, text: "User-agent: *\nDisallow: /private\nSitemap: https://mini.example/sitemap.xml\n" };
      if (u.pathname === "/sitemap.xml" && withSitemap) return { status: 200, text: urlset("https://mini.example/category/brakes", "https://mini.example/private/x", "https://mini.example/product/1") };
      return { status: 404, text: "" };
    },
    async fetch(url: string) { pagesSeen.push(new URL(url).pathname); return parsePage(html("page"), url, 200); },
  });
  const cfg = { ...miniAutoPartsConfig, seedUrls: ["/"], limitOverrides: { interPageDelaySec: 0 } };
  it("fetches sitemap pages that no link reaches, but never robots-disallowed ones", async () => {
    const seen: string[] = [];
    await crawlSite(cfg, "https://mini.example/", { fetcher: mk(seen) as any, sleep: async () => {} });
    expect(seen).toContain("/category/brakes"); expect(seen).toContain("/product/1"); expect(seen).not.toContain("/private/x");
  });
  it("useSitemap:false disables it", async () => {
    const seen: string[] = [];
    await crawlSite({ ...cfg, useSitemap: false }, "https://mini.example/", { fetcher: mk(seen) as any, sleep: async () => {} });
    expect(seen).toEqual(["/"]);
  });
});
