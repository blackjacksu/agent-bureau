import { describe, it, expect } from "vitest";
import { generateApiKey } from "@agentmap/db";
import { InMemoryStore } from "../src/store.js";
import { authenticate, TokenBucketRateLimiter, errorToHttp } from "../src/middleware.js";
import { normalizeDomain, scrub, logLine } from "../src/config.js";
import { AgentMapError } from "@agentmap/contracts";
import { assertPublicUrl, isPrivateIp } from "../src/verifier.js";

const PEPPER = "test-pepper";
export function seedKey(store: InMemoryStore, opts: { revoked?: boolean; tier?: string; verified?: boolean } = {}) {
  const g = generateApiKey(PEPPER); const agentId = "11111111-1111-4111-8111-111111111111";
  store.keys.push({ key_id: "k1", agent_id: agentId, operator_id: "22222222-2222-4222-8222-222222222222", key_hash: g.keyHash, key_prefix: g.prefix, scopes: ["tools"], revoked_at: opts.revoked ? new Date().toISOString() : null, tier: opts.tier ?? "free", verified: !!opts.verified });
  return { key: g.fullKey, agentId };
}
describe("auth middleware (17.5)", () => {
  it("accepts valid key, rejects malformed/revoked/wrong", async () => {
    const s = new InMemoryStore(); const { key, agentId } = seedKey(s);
    await expect(authenticate(s, PEPPER, `Bearer ${key}`)).resolves.toMatchObject({ agentId });
    await expect(authenticate(s, PEPPER, "Bearer nope")).rejects.toMatchObject({ code: "unauthorized" });
    await expect(authenticate(s, PEPPER, undefined)).rejects.toMatchObject({ code: "unauthorized" });
    const s2 = new InMemoryStore(); const r = seedKey(s2, { revoked: true });
    await expect(authenticate(s2, PEPPER, `Bearer ${r.key}`)).rejects.toMatchObject({ code: "unauthorized" });
  });
});
describe("rate limiter", () => {
  it("bucket math and retry_after_ms with fake clock", () => {
    let t = 0; const rl = new TokenBucketRateLimiter({ free: 60 }, () => t);
    for (let i = 0; i < 60; i++) expect(rl.check("a", "free", "find").allowed).toBe(true);
    const blocked = rl.check("a", "free", "find"); expect(blocked.allowed).toBe(false); expect(blocked.retry_after_ms).toBeGreaterThan(0);
    t += 1000; expect(rl.check("a", "free", "find").allowed).toBe(true);
  });
});
describe("errors and log scrub", () => {
  it("maps errors without stack", () => { const { body }: any = errorToHttp(new AgentMapError("unauthorized", "bad key")); expect(body.data.code).toBe("unauthorized"); expect(JSON.stringify(body)).not.toContain("stack"); const internal: any = errorToHttp(new Error("sql secret")); expect(JSON.stringify(internal.body)).not.toContain("sql secret"); });
  it("scrubs keys, questions, notes from logs", () => { const { key } = seedKey(new InMemoryStore()); const line = logLine({ authorization: `Bearer ${key}`, question: "brake pads", note: "x", tool: "find" }); expect(line).not.toContain(key); expect(line).not.toContain("brake pads"); expect(line).toContain("find"); expect(scrub({ a: key })).toEqual({ a: "am_live_[redacted]" }); });
  it("normalizes domain and rejects garbage", () => { expect(normalizeDomain("HTTPS://www.Shop.Example/path")).toBe("shop.example"); expect(() => normalizeDomain("not a domain")).toThrow(); });
  it("SSRF guard blocks private hosts", async () => { expect(isPrivateIp("169.254.169.254")).toBe(true); await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toMatchObject({ code: "invalid_input" }); await expect(assertPublicUrl("http://localhost/x")).rejects.toMatchObject({ code: "invalid_input" }); await expect(assertPublicUrl("ftp://example.com/x")).rejects.toMatchObject({ code: "invalid_input" }); });
});
