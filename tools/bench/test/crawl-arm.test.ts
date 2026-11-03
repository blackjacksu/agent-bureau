import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlArm, HttpCache } from "../src/arms/crawl-arm.js";
import { browserArm } from "../src/arms/browser-arm.js";
import { runSpeedBench, renderSpeedReport, judge } from "../src/speed-runner.js";
import { validateCorpus } from "../src/corpus.js";

let base = "";
let server: ReturnType<typeof createServer>;
const counts = new Map<string, number>();
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    counts.set(url, (counts.get(url) ?? 0) + 1);
    res.setHeader("content-type", "text/html");
    if (url === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); res.end(`<urlset><url><loc>${base}/categories/all-chandeliers</loc></url><url><loc>${base}/about</loc></url></urlset>`); return; }
    if (url.startsWith("/search")) { res.end(`<html><body><a href="/categories/all-chandeliers">Chandeliers</a></body></html>`); return; }
    if (url === "/") { res.end(`<html><body>${"nav ".repeat(50)}<a href="/categories/all-chandeliers">Chandeliers</a><a href="/about">About</a></body></html>`); return; }
    if (url === "/categories/all-chandeliers") { res.end(`<html><body>All Chandeliers</body></html>`); return; }
    res.statusCode = 404; res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("C1 crawl arm levers", () => {
  it("sitemap jump goes straight to the matching category", async () => {
    const r = await crawlArm(`${base}/`, "chandelier light", { flags: { sitemap: true, searchJump: false } });
    expect(r.stop_reason).toBe("target_like_url");
    expect(r.final_url).toContain("all-chandeliers");
    expect(r.pages).toBe(1);
  });
  it("search jump beats link walking", async () => {
    const r = await crawlArm(`${base}/`, "chandelier light", { flags: { sitemap: false, searchJump: true } });
    expect(r.final_url).toContain("all-chandeliers");
    expect(r.pages).toBe(2);
  });
  it("warm HTTP cache saves fetch time but tokens always count", async () => {
    const cache = new HttpCache();
    const cold = await crawlArm(`${base}/`, "chandelier light", { flags: { sitemap: false, searchJump: false }, cache });
    const warm = await crawlArm(`${base}/`, "chandelier light", { flags: { sitemap: false, searchJump: false }, cache });
    expect(warm.tokens).toBe(cold.tokens); // tokens always count (context ingestion); cache saves time, not tokens
    expect(warm.wall_ms).toBeLessThanOrEqual(cold.wall_ms + 5);
  });
  it("gives up honestly with no_more_links", async () => {
    const r = await crawlArm(`${base}/`, "quantum flux capacitor", { flags: { sitemap: false, searchJump: false } });
    expect(r.stop_reason).toBe("no_more_links");
  });
});

describe("C2 browser fallback", () => {
  it("escalates only when HTTP finds nothing usable", async () => {
    const emptyFetch = async () => ({ status: 200, text: "<html><body>no links</body></html>" });
    const rendered = async (url: string) => ({ status: 200, text: url.endsWith("/") || url === `${base}/` ? `<a href="/categories/all-chandeliers">Chandeliers</a>` : "ok" });
    const r = await browserArm(`${base}/`, "chandelier light", { fetchText: emptyFetch, renderedFetch: rendered, flags: { sitemap: false, searchJump: false } });
    expect(r.escalated).toBe(true);
  });
});

describe("fairness boundaries", () => {
  it("crawl/browser/runner sources never reference the DB or MCP endpoint (no graph smuggling)", () => {
    for (const f of ["../src/arms/crawl-arm.ts", "../src/arms/browser-arm.ts", "../src/speed-runner.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toContain("@agentmap/db");
      expect(src).not.toMatch(/from\s+["'].*(store|publish|graph-builder)/);
    }
  });
  it("arms never receive expected_url_pattern (judge-only)", () => {
    for (const f of ["../src/arms/crawl-arm.ts", "../src/arms/browser-arm.ts", "../src/arms/mcp-arm.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toContain("expected_url_pattern");
    }
  });
  it("judge checks visited URLs, arms do the navigating", () => {
    expect(judge({ id: "t", domain: "ex.com", question: "q", expected_url_pattern: "chandeliers", required_params: [] }, "https://ex.com/about", ["https://ex.com/categories/all-chandeliers"])).toBe(true);
    expect(judge({ id: "t", domain: "ex.com", question: "q", expected_url_pattern: "chandeliers", required_params: [] }, "https://ex.com/about")).toBe(false);
  });
});

describe("speed runner + report (fixture, no network beyond local server)", () => {
  it("runs 4 arms x runs interleaved and renders a verdict report", async () => {
    const corpus = validateCorpus({ version: 1, site_kind: "fixture", tasks: [{ id: "t1", domain: new URL(base).host, question: "chandelier light", expected_url_pattern: "all-chandeliers", required_params: [] }] });
    // Local server is http on 127.0.0.1; runner builds https:// URLs, so inject fetchText that rewrites to the fixture base.
    const fetchText = async (url: string) => {
      const u = new URL(url);
      const local = `${base}${u.pathname}${u.search}`;
      const r = await fetch(local);
      return { status: r.status, text: await r.text() };
    };
    const finder = async () => ({ found: true, steps: [{ url: "/categories/all-chandeliers" }], result_url_template: "/categories/all-chandeliers" });
    const results = await runSpeedBench(corpus as any, { finder, fetchText }, 2);
    expect(results).toHaveLength(8); // 1 task x 2 runs x 4 arms
    expect(results.filter((r) => r.run === 1).every((r) => r.cache === "cold")).toBe(true);
    const md = renderSpeedReport(results, { date: "2026-11-02" });
    expect(md).toContain("Speed benchmark");
    expect(md).toContain("champion");
  });
});
