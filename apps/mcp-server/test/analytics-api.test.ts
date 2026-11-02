import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgClient, loadMigrations, runMigrations } from "@agentmap/db";
import { createApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

// Usage / merchant / bureau / verification endpoints against real Postgres (plan 12.3-12.5, 13.4, Phase 4).
const hasDb = !!process.env.DATABASE_URL;
let base = ""; let server: any; let db: PgClient;
const ADMIN = "test-admin-token";
const admin = { "x-admin-token": ADMIN };
async function makeAgent() {
  const op: any = await (await fetch(`${base}/api/v1/operators`, { method: "POST", headers: { "content-type": "application/json", ...admin }, body: JSON.stringify({ type: "business" }) })).json();
  const ag: any = await (await fetch(`${base}/api/v1/agents`, { method: "POST", headers: { "content-type": "application/json", ...admin }, body: JSON.stringify({ operator_id: op.id, declared_model: "m1", tier: "free" }) })).json();
  const issued: any = await (await fetch(`${base}/api/v1/agents/${ag.id}/keys`, { method: "POST", headers: { "content-type": "application/json", ...admin }, body: "{}" })).json();
  return { op, ag, key: issued.api_key };
}
const mcpCall = (key: string, name: string, args: any) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json());

describe.skipIf(!hasDb)("analytics APIs (real DB)", () => {
  beforeAll(async () => {
    db = PgClient.fromUrl(process.env.DATABASE_URL!);
    await runMigrations(db, await loadMigrations());
    const app = createApp({ store: new PgStore(db), pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], verifier: { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) }, registryDb: db, adminToken: ADMIN });
    server = app.server;
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 60_000);
  afterAll(async () => { await new Promise((r) => server.close(r)); await db.end(); });

  it("usage counts the agent's own events", async () => {
    const { ag, key } = await makeAgent();
    await mcpCall(key, "is_mapped", { domain: "rockauto.com" });
    // Events in prod flow go through BatchedEventWriter; here write rows directly as that writer would.
    await db.query(`INSERT INTO event(agent_id,domain,type,metadata) VALUES($1,'rockauto.com','outcome','{"success":true}'),($1,'rockauto.com','live_check','{}')`, [ag.id]);
    const usage: any = await (await fetch(`${base}/api/v1/usage?since=2000-01-01`, { headers: { authorization: `Bearer ${key}` } })).json();
    expect(usage.agent_id).toBe(ag.id);
    expect(usage.by_type.outcome).toBe(1);
    expect(usage.by_type.live_check).toBe(1);
    expect(usage.total).toBeGreaterThanOrEqual(2);
  });
  it("merchant demand + journeys are admin-only and aggregate", async () => {
    expect((await fetch(`${base}/api/v1/merchant/rockauto.com/demand`)).status).toBe(404);
    const demand: any = await (await fetch(`${base}/api/v1/merchant/rockauto.com/demand`, { headers: admin })).json();
    expect(demand.domain).toBe("rockauto.com");
    const journeys: any = await (await fetch(`${base}/api/v1/merchant/rockauto.com/journeys`, { headers: admin })).json();
    expect(Array.isArray(journeys.by_type)).toBe(true);
  });
  it("bureau score returns explainable components", async () => {
    const { ag } = await makeAgent();
    await db.query(`INSERT INTO event(agent_id,domain,type,metadata) SELECT $1,'rockauto.com','outcome','{"success":true}' FROM generate_series(1,10)`, [ag.id]);
    const score: any = await (await fetch(`${base}/api/v1/bureau/agents/${ag.id}`, { headers: admin })).json();
    expect(score.agent_id).toBe(ag.id);
    expect(score.score).toBeGreaterThan(0);
    expect(score.components.outcome_rate).toBeGreaterThan(0);
    expect(score.inputs.successes).toBe(10);
  });
  it("verification transition flips agent.verified", async () => {
    const { op, ag } = await makeAgent();
    const patched: any = await (await fetch(`${base}/api/v1/operators/${op.id}/verification`, { method: "PATCH", headers: { "content-type": "application/json", ...admin }, body: JSON.stringify({ status: "verified" }) })).json();
    expect(patched.verification_status).toBe("verified");
    const row = await db.query(`SELECT verified FROM agent WHERE id=$1`, [ag.id]);
    expect(row.rows[0].verified).toBe(true);
    const bad = await fetch(`${base}/api/v1/operators/${op.id}/verification`, { method: "PATCH", headers: { "content-type": "application/json", ...admin }, body: JSON.stringify({ status: "banana" }) });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
