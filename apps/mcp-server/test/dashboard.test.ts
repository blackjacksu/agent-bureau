import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { InMemoryStore } from "../src/store.js";
import { CollectingEventSink } from "../src/services.js";

let base = ""; let server: any;
beforeAll(async () => {
  const app = createApp({ store: new InMemoryStore().seedFixture(), pepper: "test-pepper", allowedOrigins: ["http://localhost:3000"], events: new CollectingEventSink(), verifier: { check: async (url: string) => ({ url, status: "ok", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" }) } });
  server = app.server;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("merchant dashboard + discovery routes", () => {
  it("serves dashboard HTML wired to merchant APIs", async () => {
    const r = await fetch(`${base}/dashboard`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Merchant Dashboard");
    expect(html).toContain("/api/v1/merchant/");
  });
  it("root links data policy and dashboard; data-policy text is plain language", async () => {
    const root: any = await (await fetch(`${base}/`)).json();
    expect(root.data_policy).toBe("/.well-known/data-policy");
    expect(root.dashboard).toBe("/dashboard");
    const policy = await (await fetch(`${base}/.well-known/data-policy`)).text();
    expect(policy).toContain("never store shopper personal data");
    expect(policy).toContain("robots.txt");
  });
});
