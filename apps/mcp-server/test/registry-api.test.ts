import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgClient, loadMigrations, runMigrations } from "@agentmap/db";
import { createApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

// Registration API (plan 12.3) against real Postgres. Runs when DATABASE_URL is set.
const hasDb = !!process.env.DATABASE_URL;
let base = ""; let server: any; let db: PgClient;
const ADMIN = "test-admin-token";
const post = (path: string, body: any, admin = true) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(admin ? { "x-admin-token": ADMIN } : {}) }, body: JSON.stringify(body) });

describe.skipIf(!hasDb)("registration API (real DB)", () => {
  beforeAll(async () => {
    db = PgClient.fromUrl(process.env.DATABASE_URL!);
    await runMigrations(db, await loadMigrations());
    const app = createApp({ store: new PgStore(db), pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], verifier: { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) }, registryDb: db, adminToken: ADMIN });
    server = app.server;
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 60_000);
  afterAll(async () => { await new Promise((r) => server.close(r)); await db.end(); });

  it("registry routes are 404 without admin token", async () => {
    expect((await post("/api/v1/operators", { type: "person" }, false)).status).toBe(404);
  });
  it("operator -> agent -> key -> authenticated MCP call -> revoke", async () => {
    const op: any = await (await post("/api/v1/operators", { type: "person" })).json();
    expect(op.id).toBeTruthy();
    const ag: any = await (await post("/api/v1/agents", { operator_id: op.id, declared_model: "test-model", tier: "free" })).json();
    expect(ag.id).toBeTruthy();
    const issued: any = await (await post(`/api/v1/agents/${ag.id}/keys`, {})).json();
    expect(issued.api_key).toMatch(/^am_live_/);
    const call = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${issued.api_key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "rockauto.com" } } }) });
    const body: any = await call.json();
    expect(body.error).toBeUndefined();
    expect(body.result.structuredContent.mapped).toBe(false);
    const del = await fetch(`${base}/api/v1/agents/${ag.id}/keys/${issued.id}`, { method: "DELETE", headers: { "x-admin-token": ADMIN } });
    expect(del.status).toBe(200);
    const after = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${issued.api_key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "rockauto.com" } } }) });
    expect((await after.json()).error.code).toBe(-32001);
  });
});
