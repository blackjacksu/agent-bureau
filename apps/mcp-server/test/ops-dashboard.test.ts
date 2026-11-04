import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "@agentmap/db";
import { createApp } from "../src/server.js";
import { InMemoryStore } from "../src/store.js";
import { CollectingEventSink } from "../src/services.js";

let base = ""; let server: any; let key = "";
beforeAll(async () => {
  const store = new InMemoryStore().seedFixture();
  const g = generateApiKey("test-pepper"); const agentId = "11111111-1111-4111-8111-111111111111";
  store.keys.push({ key_id: "k1", agent_id: agentId, operator_id: "22222222-2222-4222-8222-222222222222", key_hash: g.keyHash, key_prefix: g.prefix, scopes: ["tools"], revoked_at: null, tier: "free", verified: false });
  key = g.fullKey;
  const app = createApp({ store, pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], events: new CollectingEventSink(), verifier: { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) } });
  server = app.server;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("ops dashboard", () => {
  it("recent-calls requires auth and records tool calls", async () => {
    expect(await (await fetch(`${base}/api/v1/recent-calls`)).status).toBe(401);
    const q = await (await fetch(`${base}/api/v1/request-mapping`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ domain: "news.example" }) })).json();
    expect(q.queued).toBe(true);
    const recent: any = await (await fetch(`${base}/api/v1/recent-calls?n=5`, { headers: { authorization: `Bearer ${key}` } })).json();
    expect(recent.calls.length).toBeGreaterThan(0);
    expect(recent.calls[0]).toMatchObject({ tool: "request_mapping", ok: true });
    expect(recent.calls[0].latency_ms).toEqual(expect.any(Number));
  });
  it("dashboard keeps merchant section and adds ops sections", async () => {
    const html = await (await fetch(`${base}/dashboard`)).text();
    for (const s of ["Merchant Dashboard", "/api/v1/merchant/", "Index a website", "Call explorer", "Recent calls", "Performance", "/api/v1/recent-calls", "/metrics"]) expect(html).toContain(s);
  });
  it("metrics reflect served calls", async () => {
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toMatch(/tool_calls_total\{tool="request_mapping"\} \d+/);
  });
});
