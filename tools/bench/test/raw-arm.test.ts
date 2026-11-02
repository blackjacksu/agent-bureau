import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractLinks, rawBrowse } from "../src/raw-arm.js";

let base = "";
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/") res.end(`<html><body>${"nav filler ".repeat(100)}<a href="/categories/all-chandeliers">Chandeliers</a> <a href="/about">About</a></body></html>`);
    else if (req.url === "/categories/all-chandeliers") res.end(`<html><body>${"product ".repeat(100)}All Chandeliers</body></html>`);
    else { res.statusCode = 404; res.end("nope"); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe("rawBrowse Arm A proxy", () => {
  it("follows the matching link and counts raw HTML tokens", async () => {
    const r = await rawBrowse(`${base}/`, "chandelier for a dining room", "chandeliers");
    expect(r.success).toBe(true);
    expect(r.pages).toBe(2);
    expect(r.tokens).toBeGreaterThan(100);
    expect(r.final_url).toContain("chandeliers");
  });
  it("gives up honestly when no link matches", async () => {
    const r = await rawBrowse(`${base}/`, "quantum flux capacitor", "flux");
    expect(r.success).toBe(false);
  });
  it("extractLinks resolves relative hrefs and strips tags", () => {
    const links = extractLinks(`<a href="/x">Hi <b>there</b></a>`, "https://ex.com/a/");
    expect(links[0]).toEqual({ url: "https://ex.com/x", text: "Hi there" });
  });
});
