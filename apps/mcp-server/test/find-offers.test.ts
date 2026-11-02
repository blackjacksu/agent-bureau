import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { InMemoryStore } from "../src/store.js";
import { CollectingEventSink } from "../src/services.js";
import { seedKey } from "./unit.test.js";

// find_offers registration gate (plan 16.6): absent when OFFERS_ENABLED off, present + capped when on.
let baseOn = ""; let baseOff = ""; let keyOn = ""; let keyOff = ""; let serverOn: any; let serverOff: any;
const fakeOffer = { offer_id: "o_test1", code: "TESTCODE-10", title: "10% off", discount: { type: "percent", value: 10 }, verified: true, source_kind: "merchant_public_page", commercial_relationship: "none" };
async function boot(enabled: boolean) {
  const store = new InMemoryStore().seedFixture();
  const { key } = seedKey(store);
  const app = createApp({ store, pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], events: new CollectingEventSink(), verifier: { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) }, offersEnabled: enabled, offers: async () => [fakeOffer, fakeOffer, fakeOffer, fakeOffer] as any });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  return { server: app.server, base: `http://127.0.0.1:${(app.server.address() as any).port}`, key };
}
const rpc = (base: string, key: string, body: any) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://localhost:3000", authorization: `Bearer ${key}` }, body: JSON.stringify(body) }).then((r) => r.json());
beforeAll(async () => {
  const on = await boot(true); serverOn = on.server; baseOn = on.base; keyOn = on.key;
  const off = await boot(false); serverOff = off.server; baseOff = off.base; keyOff = off.key;
});
afterAll(async () => { await new Promise((r) => serverOn.close(r)); await new Promise((r) => serverOff.close(r)); });

describe("find_offers gate", () => {
  it("absent from tools/list and uncallable when disabled", async () => {
    const list: any = await rpc(baseOff, keyOff, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(list.result.tools).toHaveLength(7);
    const call: any = await rpc(baseOff, keyOff, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_offers", arguments: { domain: "shop.example" } } });
    expect(call.error).toBeTruthy();
  });
  it("present and capped at 3 when enabled", async () => {
    const list: any = await rpc(baseOn, keyOn, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(list.result.tools.map((t: any) => t.name)).toContain("find_offers");
    const call: any = await rpc(baseOn, keyOn, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_offers", arguments: { domain: "shop.example", question: "brake pads" } } });
    expect(call.result.structuredContent.offers).toHaveLength(3);
    expect(call.result.structuredContent.offers[0].code).toMatch(/^TESTCODE-/);
  });
});
