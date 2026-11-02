import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { InMemoryStore } from "../src/store.js";
import { CollectingEventSink } from "../src/services.js";
import { seedKey } from "./unit.test.js";

// Plan 19.5 perf gate (local): find p95 < 300ms, is_mapped p95 < 100ms under concurrent load.
let base = ""; let server: any; let key = "";
const verifier = { check: async (url: string) => ({ url, status: "ok", price: { amount_minor: 100, currency: "USD" }, stock: "in_stock", checked_at: new Date().toISOString(), source: "live" }) };
async function call(name: string, args: any) {
  const t0 = performance.now();
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://localhost:3000", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  await r.json();
  return performance.now() - t0;
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
beforeAll(async () => {
  const store = new InMemoryStore().seedFixture();
  key = seedKey(store).key;
  const app = createApp({ store, pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], events: new CollectingEventSink(), verifier });
  server = app.server;
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("perf budgets (plan 19.5)", () => {
  it("is_mapped p95 < 100ms and find p95 < 300ms at concurrency 10", async () => {
    const run = async (name: string, args: any) => {
      const times: number[] = [];
      await Promise.all(Array.from({ length: 10 }, async () => { for (let i = 0; i < 10; i++) times.push(await call(name, args)); }));
      return p95(times);
    };
    expect(await run("is_mapped", { domain: "shop.example" })).toBeLessThan(100);
    expect(await run("find", { domain: "shop.example", question: "front brake pads" })).toBeLessThan(300);
  }, 60_000);
});
