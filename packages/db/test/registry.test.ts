import { describe, it, expect } from "vitest";
import { FakeDbClient, generateApiKey, parseApiKey, verifyApiKey, issueApiKey, revokeApiKey } from "../src/index.js";
describe("api key registry", () => {
  it("generates am_live format and verifies only correct pepper/key", () => {
    const g = generateApiKey("pepper"); expect(g.fullKey).toMatch(/^am_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    expect(parseApiKey(g.fullKey)?.prefix).toBe(g.prefix); expect(parseApiKey("bad")).toBeNull();
    expect(verifyApiKey(g.fullKey, "pepper", g.keyHash)).toBe(true); expect(verifyApiKey(g.fullKey, "other", g.keyHash)).toBe(false); expect(verifyApiKey(g.fullKey + "x", "pepper", g.keyHash)).toBe(false);
  });
  it("issues and revokes via SQL", async () => {
    const db = new FakeDbClient(); db.handler = (t: string) => t.includes("INSERT INTO api_key") ? { rows: [{ id: "k1" }], rowCount: 1 } : { rows: [{ id: "k1", revoked_at: new Date() }], rowCount: 1 };
    const issued = await issueApiKey(db as any, "11111111-1111-4111-8111-111111111111", "pepper"); expect(issued.id).toBe("k1"); expect(issued.fullKey).toContain("am_live_");
    await revokeApiKey(db as any, "k1"); expect(db.calls.some((c) => c.text.includes("revoked_at=now()"))).toBe(true);
  });
});
