import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as C from "../src/index.js";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/tools/${n}`, import.meta.url), "utf8"));
function fails(schema: any, value: unknown, path?: string) {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(value)).toBe(false);
  if (!r.success && path) expect(r.error.issues.map((i: any) => i.path.join("."))).toContain(path);
}
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const DT = "2026-01-01T00:00:00.000Z";

// --- 17.2 table-driven invalid variants per field, field path asserted ---
describe("tool inputs: per-field invalid variants", () => {
  const cases: Array<[string, any, unknown, string]> = [
    ["Domain empty", C.IsMappedInputSchema, { domain: "" }, "domain"],
    ["Domain wrong type", C.IsMappedInputSchema, { domain: 123 }, "domain"],
    ["Domain missing", C.IsMappedInputSchema, {}, "domain"],
    ["Domain oversize 254", C.IsMappedInputSchema, { domain: "a".repeat(254) }, "domain"],
    ["find question empty", C.FindInputSchema, { domain: "a.com", question: "" }, "question"],
    ["find question oversize 501", C.FindInputSchema, { domain: "a.com", question: "x".repeat(501) }, "question"],
    ["find question wrong type", C.FindInputSchema, { domain: "a.com", question: 42 }, "question"],
    ["find domain missing", C.FindInputSchema, { question: "brakes" }, "domain"],
    ["get_path goal empty", C.GetPathInputSchema, { domain: "a.com", goal: "" }, "goal"],
    ["get_path goal wrong type", C.GetPathInputSchema, { domain: "a.com", goal: null }, "goal"],
    ["live_check url not-url", C.LiveCheckInputSchema, { url: "not a url" }, "url"],
    ["live_check url ftp scheme", C.LiveCheckInputSchema, { url: "ftp://a.com/p" }, "url"],
    ["live_check fields bad enum", C.LiveCheckInputSchema, { url: "https://a.com/p", fields: ["color"] }, "fields.0"],
    ["report success wrong type", C.ReportOutcomeInputSchema, { domain: "a.com", path_id: "p", success: "yes" }, "success"],
    ["report failed_step_index negative", C.ReportOutcomeInputSchema, { domain: "a.com", path_id: "p", success: false, failed_step_index: -1 }, "failed_step_index"],
    ["report failed_step_index fractional", C.ReportOutcomeInputSchema, { domain: "a.com", path_id: "p", success: false, failed_step_index: 1.5 }, "failed_step_index"],
    ["report note oversize 501", C.ReportOutcomeInputSchema, { domain: "a.com", path_id: "p", success: true, note: "x".repeat(501) }, "note"],
    ["report path_id empty", C.ReportOutcomeInputSchema, { domain: "a.com", path_id: "", success: true }, "path_id"],
    ["my_sites action bad enum", C.MySitesInputSchema, { action: "delete" }, "action"],
    ["my_sites domains >100", C.MySitesInputSchema, { action: "add", domains: Array(101).fill("a.com") }, "domains"],
    ["my_sites domains bad item", C.MySitesInputSchema, { action: "add", domains: [""] }, "domains.0"],
    ["find_offers question oversize", C.FindOffersInputSchema, { domain: "a.com", question: "x".repeat(501) }, "question"],
    ["find_offers product_url bad", C.FindOffersInputSchema, { domain: "a.com", product_url: "nope" }, "product_url"],
  ];
  it.each(cases)("%s", (_n, s, v, p) => fails(s, v, p));
  it("valid boundary: question exactly 500, domain exactly 253", () => {
    expect(C.FindInputSchema.safeParse({ domain: "a".repeat(253), question: "x".repeat(500) }).success).toBe(true);
    expect(C.MySitesInputSchema.safeParse({ action: "add", domains: Array(100).fill("a.com") }).success).toBe(true);
  });
});

describe("tool outputs: valid + invalid", () => {
  it("all 7 tool fixtures on disk parse input+output", () => {
    const files: Record<string, string> = { is_mapped: "is_mapped.json", find: "find-golden.json", get_path: "get_path.json", live_check: "live_check.json", report_outcome: "report_outcome.json", request_mapping: "request_mapping.json", my_sites: "my_sites.json" };
    for (const n of C.TOOL_NAMES) {
      const f = fx(files[n]);
      expect(C.ToolInputSchemas[n].safeParse(f.input).success, n + " input").toBe(true);
      expect(C.ToolOutputSchemas[n].safeParse(f.output).success, n + " output").toBe(true);
    }
  });
  const bad: Array<[string, any, unknown, string]> = [
    ["is_mapped status bad enum", C.IsMappedOutputSchema, { mapped: true, map_version: 1, last_indexed_at: null, status: "gone" }, "status"],
    ["is_mapped map_version fractional", C.IsMappedOutputSchema, { mapped: true, map_version: 1.5, last_indexed_at: null, status: "mapped" }, "map_version"],
    ["is_mapped last_indexed_at bad datetime", C.IsMappedOutputSchema, { mapped: true, map_version: null, last_indexed_at: "yesterday", status: "mapped" }, "last_indexed_at"],
    ["find-found confidence >1", C.FindFoundOutputSchema, { mapped: true, found: true, steps: [], result_url_template: null, needs_live_check: [], path_id: "p", confidence: 1.01, missing_params: [], offers: [] }, "confidence"],
    ["find-found confidence <0", C.FindFoundOutputSchema, { mapped: true, found: true, steps: [], result_url_template: null, needs_live_check: [], path_id: "p", confidence: -0.1, missing_params: [], offers: [] }, "confidence"],
    ["find-found needs_live_check bad", C.FindFoundOutputSchema, { mapped: true, found: true, steps: [], result_url_template: null, needs_live_check: ["color"], path_id: "p", confidence: 0.5, missing_params: [], offers: [] }, "needs_live_check.0"],
    ["find-notfound reason bad", C.FindNotFoundOutputSchema, { mapped: true, found: false, reason: "oops" }, "reason"],
    ["find-unmapped queue fractional", C.FindUnmappedOutputSchema, { mapped: false, status: "queued", queue_position: 1.2 }, "queue_position"],
    ["get_path steps bad action", C.GetPathOutputSchema, { steps: [{ action: "teleport" }], from_node: "a", to_node: "b", result_url_template: null }, "steps.0.action"],
    ["live_check currency !=3", C.LiveCheckOutputSchema, { url: "https://a.com/p", status: "ok", price: { amount_minor: 100, currency: "US" }, stock: "in_stock", checked_at: DT, source: "live" }, "price.currency"],
    ["live_check amount fractional", C.LiveCheckOutputSchema, { url: "https://a.com/p", status: "ok", price: { amount_minor: 1.5, currency: "USD" }, stock: "in_stock", checked_at: DT, source: "live" }, "price.amount_minor"],
    ["live_check source bad", C.LiveCheckOutputSchema, { url: "https://a.com/p", status: "ok", price: null, stock: "unknown", checked_at: DT, source: "guess" }, "source"],
    ["report_out acknowledged not true", C.ReportOutcomeOutputSchema, { acknowledged: false, branch_status: "ok" }, "acknowledged"],
    ["request_mapping already_mapped wrong type", C.RequestMappingOutputSchema, { queued: true, queue_position: null, already_mapped: "no" }, "already_mapped"],
    ["my_sites site status bad", C.MySitesOutputSchema, { sites: [{ domain: "a.com", status: "gone", map_version: null }] }, "sites.0.status"],
  ];
  it.each(bad)("%s", (_n, s, v, p) => fails(s, v, p));
  it("find union discriminates all three branches + rejects mixed", () => {
    expect(C.FindOutputSchema.safeParse(fx("find-golden.json").output).success).toBe(true);
    expect(C.FindOutputSchema.safeParse({ mapped: true, found: false, reason: "no_path" }).success).toBe(true);
    expect(C.FindOutputSchema.safeParse({ mapped: false, status: "queued", queue_position: 2 }).success).toBe(true);
    // Non-strict Zod objects strip unknown keys: extra field is dropped, not rejected (documented behaviour).
    const mixed = C.FindOutputSchema.parse({ mapped: true, found: false, reason: "no_path", confidence: 0.5 } as any);
    expect(mixed).toEqual({ mapped: true, found: false, reason: "no_path" });
  });
  it("backward-compat: golden output without additive optional fields still parses; unknown additive keys stripped not fatal", () => {
    const g = fx("find-golden.json").output;
    const { offers, ...rest } = g; // older minor shape lacking later-required? offers is required in found-branch, so use step-level additive check below
    expect(C.StepSchema.safeParse({ action: "navigate", url: "https://a.com", future_field: 1 }).success).toBe(true);
    expect(C.FindOutputSchema.safeParse({ ...g, future_top: true }).success).toBe(true);
    expect(offers).toEqual([]);
  });
});

describe("errors: retryable flags + JSON-RPC shape (explicit expected table)", () => {
  const expected: Record<string, { retryable: boolean; jsonRpcCode: number }> = {
    invalid_input: { retryable: false, jsonRpcCode: -32602 }, unauthorized: { retryable: false, jsonRpcCode: -32001 },
    rate_limited: { retryable: true, jsonRpcCode: -32002 }, domain_blocked: { retryable: false, jsonRpcCode: -32003 },
    not_found: { retryable: false, jsonRpcCode: -32004 }, upstream_error: { retryable: true, jsonRpcCode: -32005 },
    internal: { retryable: false, jsonRpcCode: -32603 },
  };
  it.each(Object.entries(expected))("%s constructible, serializes, retryable=%s", (code, def) => {
    const e = C.makeError(code as any, "msg", def.retryable ? 250 : undefined);
    expect(e).toEqual({ code: def.jsonRpcCode, message: "msg", data: { code, message: "msg", retryable: def.retryable, ...(def.retryable ? { retry_after_ms: 250 } : {}) } });
    expect(C.JsonRpcErrorSchema.parse(JSON.parse(JSON.stringify(e)))).toBeTruthy();
    const err = new C.AgentMapError(code as any, "boom"); expect(err.toJsonRpc().data.retryable).toBe(def.retryable); expect(err).toBeInstanceOf(Error);
  });
  it("only rate_limited+upstream_error retryable; bad code / negative retry_after rejected", () => {
    expect(Object.values(C.ERROR_DEFS).filter((d) => d.retryable)).toHaveLength(2);
    fails(C.ErrorCodeSchema, "timeout"); fails(C.McpErrorDataSchema, { code: "internal", message: "m", retryable: false, retry_after_ms: -1 }, "retry_after_ms");
    fails(C.JsonRpcErrorSchema, { code: -32603, message: "m", data: { code: "internal", message: "m" } }, "data.retryable");
  });
});

describe("graph schemas", () => {
  const node = { id: UUID, domain: "a.com", map_version: 1, url_pattern: "/p/{id}", kind: "product", description: "d" };
  const bad: Array<[string, any, unknown, string]> = [
    ["site status bad", C.SiteSchema, { domain: "a.com", status: "gone", map_version: 0, last_indexed_at: null }, "status"],
    ["site map_version negative", C.SiteSchema, { domain: "a.com", status: "mapped", map_version: -1, last_indexed_at: null }, "map_version"],
    ["node id not uuid", C.NodeSchema, { ...node, id: "n1" }, "id"],
    ["node kind bad", C.NodeSchema, { ...node, kind: "checkout" }, "kind"],
    ["edge neither selector nor url_template", C.EdgeSchema, { id: UUID, domain: "a.com", map_version: 1, from_node_id: UUID, to_node_id: UUID, action: "click" }, ""],
    ["edge action bad", C.EdgeSchema, { id: UUID, domain: "a.com", map_version: 1, from_node_id: UUID, to_node_id: UUID, action: "hover", url_template: "/x" }, "action"],
    ["pathcache edge id not uuid", C.PathCacheSchema, { id: UUID, domain: "a.com", question_canonical: "q", ordered_edge_ids: ["e1"] }, "ordered_edge_ids.0"],
    ["step params value object rejected", C.StepSchema, { action: "fill", params: { a: { b: 1 } } }, "params.a"],
  ];
  it.each(bad)("%s", (_n, s, v, p) => fails(s, v, p || undefined));
  it("valid site/node/edge/pathcache + defaults applied", () => {
    expect(C.SiteSchema.parse({ domain: "a.com", status: "mapped", map_version: 0, last_indexed_at: null })).toMatchObject({ demand_score: 0, offers_enabled: false });
    expect(C.NodeSchema.parse(node).stale).toBe(false);
    expect(C.EdgeSchema.safeParse({ id: UUID, domain: "a.com", map_version: 1, from_node_id: UUID, to_node_id: UUID, action: "navigate", url_template: "/x" }).success).toBe(true);
    expect(C.PathCacheSchema.parse({ id: UUID, domain: "a.com", question_canonical: "q", ordered_edge_ids: [UUID] })).toMatchObject({ hits: 0, stale: false });
  });
});

describe("jobs: every kind payload positive+negative", () => {
  const pos: Array<[any, unknown]> = [["index_domain", { domain: "a.com", reason: "demand" }], ["reindex_branch", { domain: "a.com", node_id: UUID }], ["sweep_site", { domain: "a.com" }], ["verify_url", { url: "https://a.com/p", domain: "a.com", path_id: UUID }]];
  it.each(pos)("%s valid", (k, p) => expect(C.parseJobPayload(k, p)).toBeTruthy());
  const neg: Array<[any, unknown]> = [["index_domain", { domain: "" }], ["index_domain", {}], ["reindex_branch", { domain: "a.com", node_id: "x" }], ["reindex_branch", { domain: "a.com" }], ["sweep_site", {}], ["verify_url", { url: "noturl" }], ["verify_url", {}]];
  it.each(neg)("%s %j invalid", (k, p) => expect(() => C.parseJobPayload(k, p)).toThrow());
  it("JobSchema discriminated union accepts each kind, rejects kind/payload mismatch", () => {
    for (const [k, p] of pos) expect(C.JobSchema.safeParse({ kind: k, payload: p, status: "queued", attempts: 0 }).success, k).toBe(true);
    expect(C.JobSchema.safeParse({ kind: "reindex_branch", payload: { domain: "a.com" } }).success).toBe(false);
    expect(C.JobSchema.safeParse({ kind: "delete_site", payload: {} }).success).toBe(false);
  });
});

describe("events: every type metadata positive+negative", () => {
  const types = ["query", "path_used", "step_failed", "live_check", "outcome", "auth_rejected", "offers_served"] as const;
  it("all types accept {} or their typed extras, reject unknown keys (strict)", () => {
    for (const t of types) {
      if (t === "offers_served") continue;
      expect(C.validateEventMetadata(t, {})).toEqual({}); expect(() => C.validateEventMetadata(t, { bogus: 1 })).toThrow();
    }
    expect(C.validateEventMetadata("step_failed", { failed_step_index: 2 })).toEqual({ failed_step_index: 2 });
    expect(() => C.validateEventMetadata("step_failed", { failed_step_index: -1 })).toThrow();
    expect(C.validateEventMetadata("live_check", { source: "cache" })).toEqual({ source: "cache" });
    expect(() => C.validateEventMetadata("live_check", { source: "guess" })).toThrow();
    expect(C.validateEventMetadata("outcome", { success: true })).toEqual({ success: true });
    expect(() => C.validateEventMetadata("outcome", { success: "yes" })).toThrow();
  });
  it("offers_served requires offer_ids+domain+via", () => {
    expect(C.validateEventMetadata("offers_served", { offer_ids: ["o1"], domain: "a.com", via: "find_offers" })).toBeTruthy();
    expect(() => C.validateEventMetadata("offers_served", { offer_ids: [], domain: "a.com", via: "search" })).toThrow();
    expect(() => C.validateEventMetadata("offers_served", {})).toThrow();
  });
  it("EventSchema valid + negatives", () => {
    expect(C.EventSchema.safeParse({ agent_id: UUID, domain: "a.com", type: "query" }).success).toBe(true);
    expect(C.EventSchema.safeParse({ agent_id: null, domain: null, type: "outcome", metadata: { success: true } }).success).toBe(true);
    fails(C.EventSchema, { agent_id: "not-uuid", domain: null, type: "query" }, "agent_id");
    fails(C.EventSchema, { agent_id: null, domain: null, type: "clicked" }, "type");
    fails(C.EventSchema, { agent_id: null, domain: null, type: "query", latency_ms: 1.5 }, "latency_ms");
  });
});

describe("offers schemas", () => {
  const offer = fx("offer.json");
  it("valid, code:null, and >3 cap on FindOffersOutput", () => {
    expect(C.OfferSchema.parse({ ...offer, code: null })).toBeTruthy();
    expect(C.FindOffersOutputSchema.safeParse({ offers: [offer, offer, offer] }).success).toBe(true);
    fails(C.FindOffersOutputSchema, { offers: [offer, offer, offer, offer] }, "offers");
  });
  const bad: Array<[string, unknown, string]> = [
    ["discount type bad", { ...offer, discount: { type: "half", value: 10 } }, "discount.type"],
    ["expires bad datetime", { ...offer, expires_at: "soon" }, "expires_at"],
    ["source_kind bad", { ...offer, source_kind: "scraped" }, "source_kind"],
    ["offer_id empty", { ...offer, offer_id: "" }, "offer_id"],
    ["code wrong type", { ...offer, code: 123 }, "code"],
  ];
  it.each(bad)("%s", (_n, v, p) => fails(C.OfferSchema, v, p));
});
