import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightBrowserFetcher, playwrightAvailable } from "../src/fetch/browser-fetch.js";

let base = "";
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><body><div id="p"></div><script>document.getElementById('p').textContent = '$19.99 In Stock';</script></body>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/product/1`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("PlaywrightBrowserFetcher (real Chromium)", () => {
  it("SSRF guard blocks loopback before any browser fetch", async () => {
    expect(await playwrightAvailable()).toBe(true);
    const f = new PlaywrightBrowserFetcher({ timeoutMs: 15_000, dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }] as any });
    try {
      // SSRF guard blocks loopback by design; assert it fires even for the browser rung.
      await expect(f.fetchRendered(base)).rejects.toThrow(/private|loopback|ssrf|blocked/i);
    } finally { await f.close(); }
  }, 30_000);
});
