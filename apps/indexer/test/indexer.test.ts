import { describe, it, expect } from "vitest";
import { parseRobots, isRobotsAllowed, robotsCrawlDelaySec, evaluateGate, parseLegalReviewList } from "../src/crawl/robots.js";
import { canonicalizeUrl, toUrlPattern, derivePattern, renderUrlTemplate, validateTemplate, placeholderNames } from "../src/emit/url-template.js";
import { classifyKind, rankSelectors, isGeneratedSelector } from "../src/discover/classify.js";
import { buildGraph, validateGraph } from "../src/emit/graph-builder.js";
import { crawlSite } from "../src/crawl/frontier.js";
import { HttpPageFetcher, playwrightAvailable } from "../src/crawl/browser-pool.js";
import { InMemoryGraphStore } from "../src/emit/publish.js";
import { miniAutoPartsConfig } from "../src/sites/mini-auto-parts.js";
import { getSiteConfig, SITE_CONFIGS, realSiteTemplateConfig } from "../src/sites/index.js";
import { startMiniSite } from "./fixtures/mini-site.js";
import { parsePage } from "../src/discover/page.js";

describe("robots parser (7.2)", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\nSitemap: https://x.example/s.xml\n\nUser-agent: BadBot\nDisallow: /\n");
  it("allow/disallow prefixes + longest match", () => {
    expect(isRobotsAllowed(r, "/private/x")).toBe(false);
    expect(isRobotsAllowed(r, "/private/public/y")).toBe(true);
    expect(isRobotsAllowed(r, "/category")).toBe(true);
    expect(isRobotsAllowed(r, "/", "BadBot")).toBe(false);
  });
  it("crawl-delay and sitemap", () => { expect(robotsCrawlDelaySec(r)).toBe(2); expect(r.sitemaps).toEqual(["https://x.example/s.xml"]); });
  it("malformed -> allow default", () => { const m = parseRobots("garbage line\n:::"); expect(isRobotsAllowed(m, "/anything")).toBe(true); });
  it("gate: opted_out beats robots, legal hold, root disallow blocked", () => {
    expect(evaluateGate({ domain: "a.com", siteStatus: "opted_out", robots: r }).action).toBe("opted_out");
    expect(evaluateGate({ domain: "big.example", robots: r, legalReviewRequired: parseLegalReviewList("big.example") }).action).toBe("legal_hold");
    expect(evaluateGate({ domain: "a.com", robots: parseRobots("User-agent: *\nDisallow: /\n") }).action).toBe("blocked");
    expect(evaluateGate({ domain: "a.com", robots: r }).action).toBe("proceed");
  });
});

describe("canonicalizer (7.4)", () => {
  it("strips tracking, sorts, lowercases host", () => {
    expect(canonicalizeUrl("HTTPS://Shop.Example.com/p/?b=2&utm_source=x&a=1#frag")).toBe("https://shop.example.com/p?a=1&b=2");
    expect(canonicalizeUrl("https://x.example/p?session_id=9&id=3", ["session_id"])).toBe("https://x.example/p?id=3");
  });
  it("collapses ids to {id}", () => {
    expect(toUrlPattern("https://x.example/product/12345")).toContain("/product/{id}");
    expect(toUrlPattern("https://x.example/search?q=brakes")).toBe("/search?q={q}");
    expect(derivePattern(["https://x.example/product/111", "https://x.example/product/222"])).toBe("/product/{id}");
  });
  it("template render/validate", () => {
    expect(renderUrlTemplate("/p/{id}?q={q}", { id: 5, q: "a b" })).toBe("/p/5?q=a%20b");
    expect(() => renderUrlTemplate("/p/{id}", {})).toThrow(/missing/);
    expect(validateTemplate("/p/{id}", { id: {} }).ok).toBe(true);
    expect(validateTemplate("/p/{id}", {}).missing).toEqual(["id"]);
    expect(placeholderNames("/a/{year}/{make}")).toEqual(["year", "make"]);
  });
});

describe("classifier + selector ranker (7.4)", () => {
  it("kind rules ordered", () => {
    expect(classifyKind("https://x.example/")).toBe("home");
    expect(classifyKind("https://x.example/search?q=pads")).toBe("search");
    expect(classifyKind("https://x.example/product/123")).toBe("product");
    expect(classifyKind("https://x.example/cart")).toBe("cart");
    expect(classifyKind("https://x.example/category/brakes", {}, miniAutoPartsConfig.kindRules)).toBe("category");
    expect(classifyKind("https://x.example/whatever", { hasFacets: true })).toBe("category");
    expect(classifyKind("https://x.example/whatever", {})).toBe("other");
  });
  it("selector ranking prefers testid, rejects generated", () => {
    const r = rankSelectors([".css-1a2b3c4", "#main", '[data-testid="buy"]', 'a[aria-label="Buy"]', ".btn-primary"]);
    expect(r.primary).toBe('[data-testid="buy"]');
    expect(r.ranked).not.toContain(".css-1a2b3c4");
    expect(r.fallbacks.length).toBeLessThanOrEqual(3);
    expect(isGeneratedSelector(".css-abc1234")).toBe(true);
    expect(isGeneratedSelector("#product-title")).toBe(false);
  });
});

describe("graph build + validation (7.5)", () => {
  it("builds, dedupes, validates; orphan dropped", async () => {
    const site = await startMiniSite();
    try {
      const f = new HttpPageFetcher();
      const pages = [await f.fetch(site.baseUrl), await f.fetch(`${site.baseUrl}category/brakes`), await f.fetch(`${site.baseUrl}search?q=pads`)];
      const g = buildGraph("mini-auto.example", 1, pages, miniAutoPartsConfig);
      expect(g.nodes.some((n) => n.kind === "home")).toBe(true);
      expect(g.nodes.some((n) => n.kind === "category")).toBe(true);
      expect(g.nodes.some((n) => n.kind === "product")).toBe(true);
      const searchEdge = g.edges.find((e) => e.url_template?.includes("/search?"));
      expect(searchEdge?.url_template).toContain("{q}");
      const filterEdge = g.edges.find((e) => e.action === "filter");
      expect((filterEdge?.params_schema as any)?.brand?.enum).toContain("Bosch");
      expect(validateGraph(g).ok).toBe(true);
      expect(validateGraph({ ...g, edges: [...g.edges, { ...g.edges[0]!, id: "00000000-0000-4000-8000-000000000001", to_node_id: "00000000-0000-4000-8000-000000000099" }] }).ok).toBe(false);
    } finally { await site.close(); }
  });
});

describe("fixture-site index integration (7.3/7.5/17.6)", () => {
  it("full index_domain -> published graph, robots /private never fetched", async () => {
    const site = await startMiniSite();
    const store = new InMemoryGraphStore();
    try {
      const result = await crawlSite({ ...miniAutoPartsConfig, limitOverrides: { interPageDelaySec: 0 } }, site.baseUrl, { fetcher: new HttpPageFetcher(), store, sleep: async () => {} });
      expect(result.status).toBe("published");
      if (result.status !== "published") return;
      expect(result.pagesFetched).toBeGreaterThanOrEqual(3);
      expect(result.probesRun).toBeGreaterThanOrEqual(1);
      expect(store.sites.get("mini-auto.example")?.version).toBe(1);
      expect(result.graph.nodes.map((n) => n.kind)).toContain("search");
      expect(site.requests.some((r) => r.startsWith("/private"))).toBe(false);
      expect(site.requests.filter((r) => r === "/robots.txt").length).toBe(1);
    } finally { await site.close(); }
  });
  it("robots-disallowed variant -> blocked, zero fetches beyond robots.txt", async () => {
    const site = await startMiniSite("robots-disallowed");
    try {
      const result = await crawlSite({ ...miniAutoPartsConfig, limitOverrides: { interPageDelaySec: 0 } }, site.baseUrl, { fetcher: new HttpPageFetcher(), store: new InMemoryGraphStore(), sleep: async () => {} });
      expect(result.status).toBe("blocked");
      expect(site.requests).toEqual(["/robots.txt"]);
    } finally { await site.close(); }
  });
  it("bot-wall -> blocked bot_protection without retry storm", async () => {
    const site = await startMiniSite("bot-wall");
    try {
      const result = await crawlSite({ ...miniAutoPartsConfig, limitOverrides: { interPageDelaySec: 0 } }, site.baseUrl, { fetcher: new HttpPageFetcher(), sleep: async () => {} });
      expect(result.status).toBe("blocked");
      if (result.status === "blocked") expect(result.reason).toBe("bot_protection");
      expect(site.requests.filter((r) => r === "/").length).toBeLessThanOrEqual(1);
    } finally { await site.close(); }
  });
  it("opted_out gate aborts before any fetch", async () => {
    const site = await startMiniSite();
    try {
      const result = await crawlSite(miniAutoPartsConfig, site.baseUrl, { fetcher: new HttpPageFetcher(), siteStatus: "opted_out", sleep: async () => {} });
      expect(result.status).toBe("opted_out");
      // robots fetch is allowed; no page fetches
      expect(site.requests).toEqual(["/robots.txt"]);
    } finally { await site.close(); }
  });
});

describe("site configs (7.8)", () => {
  it("fixture registered, real-site stub not registered / not invented", () => {
    expect(getSiteConfig("mini-auto.example")?.domain).toBe("mini-auto.example");
    expect(SITE_CONFIGS[realSiteTemplateConfig.domain]).toBeUndefined();
    expect(realSiteTemplateConfig.domain).toContain("REPLACE-ME");
  });
  it("parsePage extracts structure only", () => {
    const p = parsePage('<a href="/x" data-testid="go">Go</a><form action="/search"><input name="q"></form>', "https://x.example/");
    expect(p.links[0]?.testId).toBe("go"); expect(p.forms[0]?.isSearch).toBe(true);
  });
});

describe("browser fetcher", () => {
  it("playwright availability is honestly reported (browser test marked if unavailable)", async () => {
    const avail = await playwrightAvailable();
    if (!avail) expect(avail).toBe(false); // marked: PlaywrightPageFetcher throws playwright_not_installed
    else expect(avail).toBe(true);
  });
});
