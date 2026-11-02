import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/store.js";
import { Services, CollectingEventSink } from "../src/services.js";
import { smoothedRate, edgesExercised, isThresholdStale, FeedbackTracker, planFailure } from "../src/feedback.js";
import { planSweep, staleFraction } from "../src/sweep.js";
import { MetricsRegistry } from "../src/observability.js";

const verifier = { check: async (url: string) => ({ url, status: "ok", price: { amount_minor: 100, currency: "USD" }, stock: "in_stock", checked_at: new Date().toISOString(), source: "live" }) };
async function setup(corroborator?: any) {
  const store = new InMemoryStore().seedFixture();
  const events = new CollectingEventSink();
  const svc = new Services(store, events, { verifier, corroborator, metrics: new MetricsRegistry() });
  const found: any = await svc.find({ agentId: "a1", tier: "free" }, { domain: "shop.example", question: "front brake pads" });
  return { store, events, svc, found };
}
describe("feedback pure rules (11.2/11.3)", () => {
  it("smoothed rate + threshold", () => {
    expect(smoothedRate(9, 10)).toBeCloseTo(18 / 20);
    expect(isThresholdStale(0, 20, 10)).toBe(true);
    expect(isThresholdStale(19, 20, 10)).toBe(false);
    expect(isThresholdStale(0, 5, 5)).toBe(false);
  });
  it("edges exercised only up to failed_step_index", () => {
    expect(edgesExercised(["e1", "e2", "e3"], false, 0)).toEqual(["e1"]);
    expect(edgesExercised(["e1", "e2", "e3"], false, 1)).toEqual(["e1", "e2"]);
    expect(edgesExercised(["e1", "e2", "e3"], true)).toEqual(["e1", "e2", "e3"]);
    expect(edgesExercised(["e1", "e2", "e3"], false)).toEqual(["e1", "e2", "e3"]);
  });
  it("verified failure on proven edge plans corroboration, unverified suspects only", () => {
    expect(planFailure(false, true, [25]).action).toBe("corroborate");
    expect(planFailure(false, false, [25]).action).toBe("suspect");
    expect(planFailure(true, true, [25]).action).toBe("none");
  });
  it("tracker: verified weighs 5x, daily cap, contradiction decay to 0 + flag", () => {
    const tr = new FeedbackTracker(() => new Date("2026-01-01T00:00:00Z"));
    expect(tr.recordReport("a", true).weight).toBe(5);
    expect(tr.recordReport("b", false).weight).toBe(1);
    for (let i = 0; i < 49; i++) tr.recordReport("c", false);
    expect(tr.recordReport("c", false, "free").counted).toBe(true); // 50th
    expect(tr.recordReport("c", false, "free").counted).toBe(false); // capped at 50/day free
    const tr2 = new FeedbackTracker();
    for (let i = 0; i < 35; i++) tr2.recordCorroboration("bad", false);
    for (let i = 0; i < 15; i++) tr2.recordCorroboration("bad", true);
    expect(tr2.stats("bad").weight).toBe(0); expect(tr2.stats("bad").flagged).toBe(true);
    expect(tr2.recordReport("bad", true).weight).toBe(0);
  });
  it("sweep planning: top decile weekly, all monthly, stale alert >5%", () => {
    const sites = Array.from({ length: 10 }, (_, i) => ({ domain: `s${i}.example`, demand_score: 100 - i, stale_fraction: i === 0 ? 0.2 : 0, last_swept_at: null }));
    expect(planSweep(sites, new Date("2026-02-01"))).toHaveLength(10); // never swept -> monthly due all
    const fresh = sites.map((s) => ({ ...s, last_swept_at: "2026-01-31T00:00:00Z" }));
    expect(planSweep(fresh, new Date("2026-02-01"))).toEqual([]);
    expect(staleFraction(1, 20)).toBe(0.05);
  });
});
describe("report_outcome real intake (11.1)", () => {
  it("success increments all edges; failure only up to failed index; duplicate acks without double count; note quarantined", async () => {
    const { store, svc, found, events } = await setup();
    const path: any = await store.getPath(found.path_id);
    const before = path.ordered_edge_ids.map((id: string) => { const e = store.edges.find((x) => x.id === id); return { attempts: store.edgeStats.get(id)?.attempts ?? e?.attempts ?? 0, successes: store.edgeStats.get(id)?.successes ?? e?.successes ?? 0 }; });
    await svc.reportOutcome({ agentId: "a1", verified: false }, { domain: "shop.example", path_id: found.path_id, success: false, failed_step_index: 0, note: "broken selector" });
    const after = path.ordered_edge_ids.map((id: string) => store.edgeStats.get(id));
    expect(after[0]!.attempts).toBe(before[0].attempts + 1);
    for (let i = 1; i < after.length; i++) expect(after[i]!.attempts).toBe(before[i].attempts); // never exercised
    expect(store.notes).toEqual([{ agentId: "a1", pathId: found.path_id, note: "broken selector" }]);
    expect(events.events.some((e: any) => e.type === "step_failed")).toBe(true);
    expect(JSON.stringify(events.events)).not.toContain("broken selector"); // note never in event metadata
    const dup = await svc.reportOutcome({ agentId: "a1", verified: false }, { domain: "shop.example", path_id: found.path_id, success: false, failed_step_index: 0 });
    expect(dup.acknowledged).toBe(true);
    expect(store.edgeStats.get(path.ordered_edge_ids[0])!.attempts).toBe(after[0]!.attempts);
  });
  it("events wired for all tools, tokens_saved never set", async () => {
    const { svc, events } = await setup();
    await svc.isMapped("a1", { domain: "shop.example" });
    await svc.getPath({ agentId: "a1" }, { domain: "shop.example", goal: "brake pads product" });
    await svc.liveCheck({ agentId: "a1" }, { url: "https://shop.example/product/1" });
    await svc.requestMapping({ agentId: "a1" }, { domain: "new2.example" });
    await svc.mySites({ agentId: "a1" }, { action: "list" });
    const types = events.events.map((e: any) => e.type);
    expect(types).toContain("query"); expect(types).toContain("path_used"); expect(types).toContain("live_check");
    for (const e of events.events) expect((e as any).tokens_saved_estimate ?? null).toBeNull();
  });
  it("live_check success refreshes node verified timestamp", async () => {
    const { store, svc } = await setup();
    await svc.liveCheck({ agentId: "a1" }, { url: "https://shop.example/product/1" });
    expect(store.nodeVerifiedAt.size).toBeGreaterThan(0);
  });
});
describe("self-healing integration (17.6): corrupt -> corroborated stale -> reindex heal -> serves again", () => {
  it("verified failure + verifier corroboration marks stale, excluded, heal clears", async () => {
    let broken = true;
    const { store, svc, found } = await setup(async () => broken);
    const out = await svc.reportOutcome({ agentId: "verified-agent", verified: true }, { domain: "shop.example", path_id: found.path_id, success: false, failed_step_index: 1 });
    expect(out.branch_status).toBe("marked_stale");
    expect(store.jobs.some((j) => j.kind === "verify_url")).toBe(true);
    expect(store.jobs.some((j) => j.kind === "reindex_branch")).toBe(true);
    const path: any = await store.getPath(found.path_id); expect(path.stale).toBe(true);
    // Simulated reindex publish heals branch (11.2 recovery)
    broken = false;
    await svc.healBranch(found.path_id);
    expect((await store.getPath(found.path_id))!.stale).toBe(false);
    const again: any = await svc.find({ agentId: "a1", tier: "free" }, { domain: "shop.example", question: "front brake pads" });
    expect(again.found).toBe(true);
  });
  it("unverified single failure does not instantly stale a proven branch, increments suspect", async () => {
    const { store, svc, found } = await setup(async () => true);
    const out = await svc.reportOutcome({ agentId: "anon", verified: false }, { domain: "shop.example", path_id: found.path_id, success: false, failed_step_index: 0 });
    expect(out.branch_status).toBe("reindex_queued");
    const path: any = await store.getPath(found.path_id);
    expect(store.suspects.get(path.ordered_edge_ids[0])).toBe(1);
  });
  it("metrics registry renders prometheus counters", async () => {
    const m = new MetricsRegistry(); m.inc("tool_calls_total", { tool: "find" }); m.observe("tool_latency_ms", 42, { tool: "find" });
    const text = m.renderPrometheus(); expect(text).toContain('tool_calls_total{tool="find"} 1'); expect(text).toContain("tool_latency_ms");
  });
});
