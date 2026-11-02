import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Root E2E (plan 19.4): the compiled dist server boots standalone and serves MCP over HTTP.
// Requires `pnpm -r build` first (root `pnpm test` does this). Skipped, not faked, when dist is absent.
const distEntry = new URL("../../apps/mcp-server/dist/index.js", import.meta.url).pathname;
const hasDist = existsSync(distEntry);
let child: ChildProcess | undefined;
const PORT = 18731;
const base = `http://127.0.0.1:${PORT}`;

describe.skipIf(!hasDist)("compiled MCP server (dist boot)", () => {
  beforeAll(async () => {
    child = spawn("node", [distEntry], { env: { ...process.env, MCP_PORT: String(PORT), API_KEY_PEPPER: "e2e-pepper" }, stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(`${base}/healthz`); if (r.ok) return; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not become healthy");
  }, 20_000);
  afterAll(() => { child?.kill("SIGTERM"); });

  it("healthz + readyz respond", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });
  it("unauthenticated tools/call is -32001 unauthorized (no key, no execution)", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "is_mapped", arguments: { domain: "rockauto.com" } } }) });
    const body: any = await r.json();
    expect(body.error.code).toBe(-32001);
    expect(body.error.data.code).toBe("unauthorized");
  });
  it("bad Origin is rejected (DNS-rebinding guard)", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "http://evil.example" }, body: "{}" });
    expect(r.status).toBe(403);
  });
});
