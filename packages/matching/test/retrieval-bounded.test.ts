import { describe, it, expect } from "vitest";
import { FakeEmbeddingProvider, MatchingService } from "../src/index.js";
import type { MatchingNode, MatchingEdge } from "../src/index.js";

// Small fixture graph: home -> search -> cat -> prod.
const nodes: MatchingNode[] = [
  { id: "home", url_pattern: "/", kind: "home", description: "home storefront" },
  { id: "search", url_pattern: "/search", kind: "search", description: "search brake pads" },
  { id: "cat", url_pattern: "/brakes", kind: "category", description: "brake pads category front brakes" },
  { id: "prod", url_pattern: "/product/{id}", kind: "product", description: "brake pads product front" },
];
const edges: MatchingEdge[] = [
  { id: "e1", from_node_id: "home", to_node_id: "search", action: "navigate", url_template: "https://x/search?q={q}", attempts: 20, successes: 19 },
  { id: "e2", from_node_id: "search", to_node_id: "cat", action: "navigate", url_template: "https://x/brakes", attempts: 20, successes: 19 },
  { id: "e3", from_node_id: "cat", to_node_id: "prod", action: "navigate", url_template: "https://x/product/{id}", attempts: 20, successes: 19 },
];

describe("bounded retrieval (data plane fix)", () => {
  it("find prefers searchNodes/searchPathCache/listEdgesForNodes over full scans", async () => {
    const calls = { listNodes: 0, listEdges: 0, listPathCache: 0, searchNodes: 0, searchPathCache: 0, listEdgesForNodes: 0 };
    let searchArgs: any[] = [];
    const repo: any = {
      getSite: async () => ({ domain: "shop.example", status: "mapped", map_version: 1 }),
      listNodes: async () => { calls.listNodes++; return nodes; },
      listEdges: async () => { calls.listEdges++; return edges; },
      listPathCache: async () => { calls.listPathCache++; return []; },
      searchNodes: async (...args: any[]) => { calls.searchNodes++; searchArgs = args; return nodes; },
      searchPathCache: async () => { calls.searchPathCache++; return []; },
      listEdgesForNodes: async () => { calls.listEdgesForNodes++; return edges; },
      upsertPathCache: async () => ({ id: "cache-new" }),
      recordPathCacheHit: async () => {},
    };
    const out: any = await new MatchingService(repo, new FakeEmbeddingProvider()).find("shop.example", "front brake pads");
    expect(out.found).toBe(true);
    expect(calls.searchNodes).toBe(1);
    expect(calls.searchPathCache).toBe(1);
    expect(calls.listEdgesForNodes).toBe(1);
    // Vector-heavy full scans must not run when bounded methods exist.
    expect(calls.listNodes).toBe(0);
    expect(calls.listPathCache).toBe(0);
    // The candidate query must carry the question text so the store can cover
    // the lexical half of the blend (regression: vector-only top-k cut targets).
    expect(typeof searchArgs[3]).toBe("string");
    expect((searchArgs[3] as string).length).toBeGreaterThan(0);
  });
});
