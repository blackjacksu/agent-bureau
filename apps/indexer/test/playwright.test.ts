import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightPageFetcher, playwrightAvailable } from "../src/crawl/browser-pool.js";

// Real headless Chromium against a local JS-rendered page (plan 17.6 browser gate).
// Requires: pnpm add playwright + `npx playwright install chromium`.
let base = "";
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><body><h1>Catalog</h1><div id="app"></div>
<script>document.getElementById('app').innerHTML = '<a href="/category/brakes">Brakes</a><p>JS_RENDERED_MARKER</p>';</script>
</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("PlaywrightPageFetcher (real Chromium)", () => {
  it("is available after install", async () => {
    expect(await playwrightAvailable()).toBe(true);
  });
  it("renders JS-injected content that raw HTTP cannot see", async () => {
    const f = new PlaywrightPageFetcher(15_000);
    try {
      const snap = await f.fetch(base);
      expect(snap.status).toBe(200);
      expect(snap.html).toContain("JS_RENDERED_MARKER");
      expect(snap.links.some((l: any) => String(l.href ?? l.url ?? "").includes("/category/brakes"))).toBe(true);
    } finally { await f.close(); }
  }, 30_000);
});
