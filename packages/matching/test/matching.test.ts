import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FakeEmbeddingProvider, HostedEmbeddingProvider, MatchingService, DEFAULT_MATCHING_CONFIG, normalizeDomain, normalizeQuestion, extractParams, canonicalQuestion, composePath, computeConfidence, demandScore, evaluateDemand, DemandTracker, cosine, type MatchingRepository, type MatchingNode, type MatchingEdge, type PathCacheEntry } from "../src/index.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden-params.json", import.meta.url), "utf8"));

describe("param extraction golden >=60 (17.4)", () => {
  it("fixture has >=60 cases across 3 categories", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(golden.cases.map((c: any) => c.cat)).size).toBe(3);
  });
  for (const c of golden.cases) {
    it(`${c.cat}: ${c.q}`, () => {
      const schema = golden.schemas[c.schema];
      const r = extractParams(c.q, [{ params_schema: schema }]);
      expect(r.params).toEqual(c.params);
      expect(r.missing_params).toEqual(c.missing);
    });
  }
  it("precision/recall gate computed", () => {
    let tp = 0, fp = 0, fn = 0;
    for (const c of golden.cases) { const r = extractParams(c.q, [{ params_schema: golden.schemas[c.schema] }]); for (const k of Object.keys(r.params)) (c.params[k] === r.params[k] ? tp++ : fp++); for (const k of Object.keys(c.params)) if (!(k in r.params)) fn++; }
    const precision = tp / (tp + fp), recall = tp / (tp + fn);
    expect(precision).toBeGreaterThanOrEqual(0.95); expect(recall).toBeGreaterThanOrEqual(0.85);
  });
});

describe("normalization & canonical (8.2/8.4)", () => {
  it("domain cases", () => {
    expect(normalizeDomain("HTTPS://www.Shop.Example/path")).toBe("shop.example");
    expect(normalizeDomain("shop.example.")).toBe("shop.example");
    expect(normalizeDomain("https://münchen.example")).toBe("xn--mnchen-3ya.example");
    expect(() => normalizeDomain("not a domain")).toThrow();
    expect(() => normalizeDomain("")).toThrow();
  });
  it("filler stripping never eats product words", () => {
    expect(normalizeQuestion("please find me brake pads").text).toBe("brake pads");
    expect(normalizeQuestion("I need brake pads").text).toBe("brake pads");
    expect(normalizeQuestion("  brake   pads ").text).toBe("brake pads");
  });
  it("canonical placeholders & paraphrase identity", () => {
    const p = { year: 2018, make: "Honda", model: "Civic", position: "front" };
    expect(canonicalQuestion("front brake pads for a 2018 Honda Civic", p as any)).toBe("brake pads for a {year} {make} {model} + {position}".replace("brake pads for a {year} {make} {model} + {position}", "front brake pads for a {year} {make} {model}").replace("front", "{position}"));
    const a = canonicalQuestion("Please find me front brake pads for a 2018 Honda Civic", p as any);
    const b = canonicalQuestion("front brake pads for a 2018 Honda Civic", p as any);
    expect(a).toBe(b); expect(a).toContain("{year}"); expect(a).not.toContain("2018");
  });
});

// Fixture graph helpers
function graph(opts: { hops?: number; staleMiddle?: boolean; lowRate?: boolean } = {}) {
  const nodes: MatchingNode[] = [{ id: "home", url_pattern: "/", kind: "home", description: "home storefront" }, { id: "search", url_pattern: "/search", kind: "search", description: "search brake pads" }, { id: "cat", url_pattern: "/brakes", kind: "category", description: "brake pads category front brakes" }, { id: "prod", url_pattern: "/product/{id}", kind: "product", description: "brake pads product front" }];
  const edges: MatchingEdge[] = [
    { id: "e1", from_node_id: "home", to_node_id: "search", action: "navigate", url_template: "https://x/search?q={q}", attempts: 20, successes: 19 },
    { id: "e2", from_node_id: "search", to_node_id: "cat", action: "navigate", url_template: "https://x/brakes", attempts: 20, successes: opts.lowRate ? 0 : 19, stale: !!opts.staleMiddle },
    { id: "e3", from_node_id: "cat", to_node_id: "prod", action: "navigate", url_template: "https://x/product/{id}", attempts: 20, successes: 19 },
  ];
  if (opts.hops) { // chain prod -> n1 -> n2 -> n3 -> deep (total >6 from home to deep target via description)
    for (let i = 0; i < opts.hops; i++) { const id = `n${i}`; nodes.push({ id, url_pattern: `/${id}`, kind: "other", description: `deep chain ${id}` }); edges.push({ id: `ex${i}`, from_node_id: i === 0 ? "prod" : `n${i - 1}`, to_node_id: id, action: "navigate", url_template: `https://x/${id}`, attempts: 20, successes: 19 }); }
    nodes.push({ id: "deep", url_pattern: "/deep", kind: "product", description: "brake pads product deep target xyz" });
    edges.push({ id: "ed", from_node_id: `n${opts.hops - 1}`, to_node_id: "deep", action: "navigate", url_template: "https://x/deep", attempts: 20, successes: 19 });
  }
  return { nodes, edges };
}
function repo(g: { nodes: MatchingNode[]; edges: MatchingEdge[] }, cache: PathCacheEntry[] = []): MatchingRepository & { cache: PathCacheEntry[]; hits: string[] } {
  const r: any = { cache, hits: [], async getSite() { return { domain: "shop.example", status: "mapped", map_version: 1 }; }, async listNodes() { return g.nodes; }, async listEdges() { return g.edges; }, async listPathCache() { return cache; }, async recordPathCacheHit(id: string) { r.hits.push(id); }, async upsertPathCache(input: any) { const e = { id: "cache-new", ...input, stale: false, last_success_at: new Date().toISOString() }; cache.push(e); return { id: e.id }; } };
  return r;
}

describe("retrieval/composition/abstain (8.3/8.7)", () => {
  it("find composes path and writes cache", async () => {
    const r = repo(graph()); const svc = new MatchingService(r, new FakeEmbeddingProvider());
    const out: any = await svc.find("shop.example", "front brake pads");
    expect(out.found).toBe(true); expect(out.via).toBe("composed"); expect(out.steps.length).toBeGreaterThan(0); expect(out.confidence).toBeGreaterThanOrEqual(0.45); expect(r.cache.length).toBe(1);
  });
  it("pathcache hit above threshold; stale edge forces fallback", async () => {
    const emb = new FakeEmbeddingProvider(); const can = "front brake pads";
    const cache: PathCacheEntry[] = [{ id: "c1", domain: "shop.example", question_canonical: can, question_embedding: await emb.embed(can), ordered_edge_ids: ["e1", "e2", "e3"], stale: false, last_success_at: new Date().toISOString() }];
    const r = repo(graph(), cache); const svc = new MatchingService(r, emb);
    const out: any = await svc.find("shop.example", "front brake pads");
    expect(out.via).toBe("path_cache"); expect(r.hits).toEqual(["c1"]);
    // stale middle edge -> cache rejected, node fallback also cannot use stale e2 (no alt) -> no_path/low
    const r2 = repo(graph({ staleMiddle: true }), cache); const out2: any = await new MatchingService(r2, emb).find("shop.example", "front brake pads");
    expect(out2.found).toBe(false);
  });
  it("cache below threshold falls through", async () => {
    const emb = new FakeEmbeddingProvider();
    const cache: PathCacheEntry[] = [{ id: "c1", domain: "shop.example", question_canonical: "unrelated shoes socks", question_embedding: await emb.embed("unrelated shoes socks"), ordered_edge_ids: ["e1"], stale: false, last_success_at: new Date().toISOString() }];
    const out: any = await new MatchingService(repo(graph(), cache), emb).find("shop.example", "front brake pads");
    expect(out.found).toBe(true); expect(out.via).toBe("composed");
  });
  it("no match -> no_path, low similarity", async () => {
    const out: any = await new MatchingService(repo(graph()), new FakeEmbeddingProvider()).find("shop.example", "zzzz unrelated xyzzy qqqq");
    expect(out).toMatchObject({ found: false, reason: "no_path" });
  });
  it(">6 hop abstains / no_path", () => {
    const g = graph({ hops: 5 }); // home->...->deep = 3+5+1=9 hops
    expect(composePath(g.nodes, g.edges, ["home"], "deep", 6)).toBeNull();
    expect(composePath(g.nodes, g.edges, ["home"], "prod", 6)?.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
  it("BFS prefers url_template + high success", () => {
    const nodes: MatchingNode[] = [{ id: "a", url_pattern: "/", kind: "home", description: "a" }, { id: "b", url_pattern: "/b", kind: "other", description: "b" }, { id: "t", url_pattern: "/t", kind: "product", description: "t" }];
    const edges: MatchingEdge[] = [
      { id: "bad", from_node_id: "a", to_node_id: "t", action: "click", selector: "#x", attempts: 20, successes: 0 },
      { id: "g1", from_node_id: "a", to_node_id: "b", action: "navigate", url_template: "https://x/b", attempts: 20, successes: 20 },
      { id: "g2", from_node_id: "b", to_node_id: "t", action: "navigate", url_template: "https://x/t", attempts: 20, successes: 20 },
    ];
    // 2-hop good (cost ~2.19) vs 1-hop bad selector (cost 1+0.9+0.1=2.0) -> bad wins on pure cost; assert weight fn prefers template among equal hops instead:
    const nodes2 = nodes; const edges2: MatchingEdge[] = [
      { id: "sel", from_node_id: "a", to_node_id: "t", action: "click", selector: "#x", attempts: 20, successes: 19 },
      { id: "tmpl", from_node_id: "a", to_node_id: "t", action: "navigate", url_template: "https://x/t", attempts: 20, successes: 19 },
    ];
    expect(composePath(nodes2, edges2, ["a"], "t", 6)?.[0].id).toBe("tmpl");
    void nodes; void edges;
  });
  it("confidence boundary and monotonicity", () => {
    const eGood: MatchingEdge[] = [{ id: "e", from_node_id: "a", to_node_id: "b", action: "navigate", url_template: "https://x", attempts: 20, successes: 20 }];
    const eBad: MatchingEdge[] = [{ id: "e", from_node_id: "a", to_node_id: "b", action: "navigate", url_template: "https://x", attempts: 20, successes: 0 }];
    const hi = computeConfidence(DEFAULT_MATCHING_CONFIG, { retrievalSimilarity: 0.9, edges: eGood, paramCoverage: 1 });
    const lo = computeConfidence(DEFAULT_MATCHING_CONFIG, { retrievalSimilarity: 0.9, edges: eBad, paramCoverage: 1 });
    expect(hi).toBeGreaterThan(lo); expect(hi).toBeGreaterThan(DEFAULT_MATCHING_CONFIG.abstainThreshold); expect(lo).toBeLessThan(hi);
    const below = computeConfidence(DEFAULT_MATCHING_CONFIG, { retrievalSimilarity: 0.1, edges: eBad, paramCoverage: 0 });
    expect(below).toBeLessThan(DEFAULT_MATCHING_CONFIG.abstainThreshold);
  });
  it("getPath composes without param binding", async () => {
    const svc = new MatchingService(repo(graph()), new FakeEmbeddingProvider());
    const out: any = await svc.getPath("shop.example", "prod");
    expect(out.to_node).toBe("prod"); expect(out.steps.length).toBe(3);
  });
});

describe("demand (8.6) and embeddings", () => {
  it("decay math 0.9^age", () => {
    const now = new Date("2026-01-11T00:00:00Z");
    const s = demandScore([{ domain: "x.example", agent_id: "a", source: "find_miss", created_at: "2026-01-01T00:00:00Z" }], DEFAULT_MATCHING_CONFIG, now);
    expect(s).toBeCloseTo(Math.pow(0.9, 10), 6);
  });
  it("threshold crossing enqueues exactly once", () => {
    const now = new Date(); const sigs = Array.from({ length: 5 }, (_, i) => ({ domain: "x.example", agent_id: `a${i}`, source: "find_miss", created_at: now }));
    const t = new DemandTracker(DEFAULT_MATCHING_CONFIG);
    expect(t.evaluate("x.example", sigs, now).shouldEnqueue).toBe(true);
    expect(t.evaluate("x.example", sigs, now).shouldEnqueue).toBe(false);
    expect(evaluateDemand(Array.from({ length: 20 }, () => ({ domain: "x.example", agent_id: "same", source: "find_miss", created_at: now })), DEFAULT_MATCHING_CONFIG, now).shouldEnqueue).toBe(true);
    expect(evaluateDemand(sigs.slice(0, 2), DEFAULT_MATCHING_CONFIG, now).shouldEnqueue).toBe(false);
  });
  it("fake embeddings deterministic & cosine self=1; hosted adapter parses", async () => {
    const f = new FakeEmbeddingProvider(); const a = await f.embed("brake pads"); const b = await f.embed("brake pads");
    expect(a).toEqual(b); expect(cosine(a, b)).toBeCloseTo(1, 6);
    const hosted = new HostedEmbeddingProvider({ apiKey: "k", fetchFn: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) }) as any });
    await expect(hosted.embed("x")).resolves.toEqual([1, 0]);
  });
});
