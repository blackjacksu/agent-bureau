import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TOOL_DESCRIPTIONS } from "@agentmap/contracts";
import { createApp } from "../src/server.js";
import { InMemoryStore } from "../src/store.js";
import { CollectingEventSink } from "../src/services.js";
import { TokenBucketRateLimiter } from "../src/middleware.js";
import { seedKey } from "./unit.test.js";

const PEPPER = "test-pepper";
let base = ""; let server: any; let key = ""; let store: InMemoryStore; let events: CollectingEventSink; let logs: string[] = [];
const verifier = { check: async (url: string) => ({ url, status: "ok", price: { amount_minor: 1299, currency: "USD" }, stock: "in_stock", checked_at: new Date().toISOString(), source: "live" }) };
async function rpc(body: any, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://localhost:3000", authorization: `Bearer ${key}`, ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function callTool(name: string, args: any) { const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }); expect(r.status).toBe(200); if (r.body.error) throw new Error(JSON.stringify(r.body.error)); return r.body.result.structuredContent; }

beforeAll(async () => {
  store = new InMemoryStore().seedFixture(); events = new CollectingEventSink();
  key = seedKey(store).key;
  const app = createApp({ store, pepper: PEPPER, allowedOrigins: ["http://localhost:3000"], events, verifier, logger: (l) => logs.push(l) });
  server = app.server; await new Promise<void>((res) => server.listen(0, "127.0.0.1", res)); base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("MCP contract over real HTTP", () => {
  it("initialize, tools/list descriptions, health", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, { authorization: "" });
    // initialize is protocol-level; with empty auth header helper still sends? server allows initialize
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.body.result.tools).toHaveLength(7);
    for (const t of list.body.result.tools) expect(t.description).toBe(TOOL_DESCRIPTIONS[t.name as keyof typeof TOOL_DESCRIPTIONS]);
    expect(list.body.result.tools.map((t: any) => t.name)).not.toContain("find_offers");
    const h = await fetch(`${base}/healthz`); expect(h.status).toBe(200);
  });
  it("rejects bad Origin, bad Accept, missing/revoked auth", async () => {
    const badOrigin = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://evil.example", authorization: `Bearer ${key}` }, body: "{}" }); expect(badOrigin.status).toBe(403);
    const badAccept = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "text/plain", origin: "http://localhost:3000", authorization: `Bearer ${key}` }, body: "{}" }); expect(badAccept.status).toBe(406);
    const noAuth = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "shop.example" } } }, { authorization: "Bearer am_live_AAAAAAAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(noAuth.body.error.code).toBe(-32001); expect(noAuth.body.error.data.code).toBe("unauthorized");
    expect(events.events.some((e) => e.type === "auth_rejected")).toBe(true);
  });
  it("is_mapped/find/get_path/live_check/report_outcome/request_mapping/my_sites end-to-end", async () => {
    expect(await callTool("is_mapped", { domain: "shop.example" })).toMatchObject({ mapped: true, status: "mapped" });
    expect(await callTool("is_mapped", { domain: "new.example" })).toMatchObject({ mapped: false, status: "queued" });
    const found: any = await callTool("find", { domain: "shop.example", question: "front brake pads" });
    expect(found).toMatchObject({ mapped: true, found: true, offers: [] }); expect(found.steps.length).toBeGreaterThan(0); expect(found.path_id).toMatch(/^p_/);
    expect(await callTool("find", { domain: "shop.example", question: "zzzz unrelated xyzzy" })).toMatchObject({ mapped: true, found: false });
    expect(await callTool("find", { domain: "unknown.example", question: "brake pads" })).toMatchObject({ mapped: false });
    const gp: any = await callTool("get_path", { domain: "shop.example", goal: "brake pads product" }); expect(gp.steps.length).toBeGreaterThan(0); expect(gp.to_node).toBeTruthy();
    expect(await callTool("live_check", { url: "https://shop.example/product/1" })).toMatchObject({ status: "ok", price: { amount_minor: 1299 } });
    const out = await callTool("report_outcome", { domain: "shop.example", path_id: found.path_id, success: true }); expect(out).toEqual({ acknowledged: true, branch_status: "ok" });
    const dup = await callTool("report_outcome", { domain: "shop.example", path_id: found.path_id, success: true }); expect(dup.acknowledged).toBe(true);
    const fail = await callTool("report_outcome", { domain: "shop.example", path_id: found.path_id, success: false, failed_step_index: 0 }); expect(fail.branch_status).toBe("reindex_queued"); expect(store.jobs.some((j) => j.kind === "reindex_branch")).toBe(true);
    expect(await callTool("request_mapping", { domain: "another.example" })).toMatchObject({ queued: true, already_mapped: false });
    expect(await callTool("request_mapping", { domain: "shop.example" })).toMatchObject({ already_mapped: true });
    await callTool("my_sites", { action: "add", domains: ["shop.example"] });
    expect(await callTool("my_sites", { action: "list" })).toMatchObject({ sites: [{ domain: "shop.example", status: "mapped" }] });
    await callTool("my_sites", { action: "remove", domains: ["shop.example"] });
    expect((await callTool("my_sites", { action: "list" })).sites).toHaveLength(0);
    const bad = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "find", arguments: { domain: "shop.example", question: "" } } });
    expect(bad.body.error.data.code).toBe("invalid_input"); expect(bad.body.error.data.message).toContain("question");
  });
  it("REST mirror deep-equals MCP business payload", async () => {
    const mcp: any = await callTool("is_mapped", { domain: "shop.example" });
    const r = await fetch(`${base}/api/v1/is-mapped?domain=shop.example`, { headers: { authorization: `Bearer ${key}` } }); expect(await r.json()).toEqual(mcp);
    const rf = await fetch(`${base}/api/v1/find`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ domain: "shop.example", question: "front brake pads" }) });
    const restFind: any = await rf.json(); expect(restFind.found).toBe(true); expect(restFind.steps).toEqual(expect.any(Array));
    const noAuth = await fetch(`${base}/api/v1/is-mapped?domain=shop.example`); expect(noAuth.status).toBe(401);
  });
  it("rate limits over HTTP and key never in logs", async () => {
    const s2 = new InMemoryStore().seedFixture(); const k2 = seedKey(s2).key; const ev = new CollectingEventSink();
    const app2 = createApp({ store: s2, pepper: PEPPER, allowedOrigins: ["http://localhost:3000"], events: ev, verifier, rateLimiter: new TokenBucketRateLimiter({ free: 2 }), logger: (l) => logs.push(l) });
    await new Promise<void>((res) => app2.server.listen(0, "127.0.0.1", res)); const b2 = `http://127.0.0.1:${(app2.server.address() as any).port}`;
    const doCall = () => fetch(`${b2}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://localhost:3000", authorization: `Bearer ${k2}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "shop.example" } } }) }).then((r) => r.json());
    await doCall(); await doCall(); const third: any = await doCall(); expect(third.error.data.code).toBe("rate_limited"); expect(third.error.data.retry_after_ms).toBeGreaterThan(0);
    await new Promise((r) => app2.server.close(r));
    expect(logs.join("\n")).not.toContain(key); expect(logs.join("\n")).not.toContain(k2);
  });
  it("notifications get 202 and batch works", async () => {
    const n = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://localhost:3000", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }); expect(n.status).toBe(202);
    const batch = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "shop.example" } } }]); expect(Array.isArray(batch.body)).toBe(true); expect(batch.body).toHaveLength(2);
  });
});
