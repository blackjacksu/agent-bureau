import { describe, it, expect } from "vitest";
import { FakeEmbeddingProvider, MatchingService } from "@agentmap/matching";
import { InMemoryStore } from "../src/store.js";
import { Services, CollectingEventSink, storeToMatchingRepo } from "../src/services.js";
import { MetricsRegistry } from "../src/observability.js";

const verifier = { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) };

describe("Services.find result cache (60s TTL)", () => {
  it("identical question within TTL hits cache; same path_id returned", async () => {
    const store = new InMemoryStore().seedFixture();
    const inner = new MatchingService(storeToMatchingRepo(store), new FakeEmbeddingProvider());
    let calls = 0;
    const matching = {
      find: async (_s: unknown, d: string, q: string) => { calls++; return inner.find(d, q); },
    };
    const svc = new Services(store, new CollectingEventSink(), { verifier, matching, metrics: new MetricsRegistry() });
    const q = { domain: "shop.example", question: "front brake pads" };
    const r1: any = await svc.find({ agentId: "a1", tier: "free" }, q);
    expect(r1.found).toBe(true);
    const r2: any = await svc.find({ agentId: "a1", tier: "free" }, q);
    expect(r2.found).toBe(true);
    expect(calls).toBe(1);
    expect(r2.path_id).toBe(r1.path_id);
  });
});
