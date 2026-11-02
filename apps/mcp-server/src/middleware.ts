import { AgentMapError } from "@agentmap/contracts";
import { parseApiKey, verifyApiKey } from "@agentmap/db";
import type { Store } from "./store.js";

export interface AuthContext { agentId: string; operatorId: string; tier: string; verified: boolean; keyId: string; scopes: string[] }
export async function authenticate(store: Store, pepper: string, authHeader: string | undefined): Promise<AuthContext> {
  if (!authHeader?.startsWith("Bearer ")) throw new AgentMapError("unauthorized", "missing or invalid API key");
  const key = authHeader.slice(7).trim();
  const parsed = parseApiKey(key);
  if (!parsed) throw new AgentMapError("unauthorized", "missing or invalid API key");
  const rows = await store.findKeys(parsed.prefix);
  for (const row of rows) {
    if (row.revoked_at) continue;
    if (verifyApiKey(key, pepper, row.key_hash)) {
      void store.touchKey(row.key_id).catch(() => {});
      return { agentId: row.agent_id, operatorId: row.operator_id, tier: row.tier, verified: row.verified, keyId: row.key_id, scopes: row.scopes };
    }
  }
  throw new AgentMapError("unauthorized", "missing or invalid API key");
}

export const TIER_LIMITS: Record<string, number> = { free: 60, builder: 600, scale: 6000, verified_builder: 1200, verified_scale: 12000 };
export class TokenBucketRateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  constructor(private limits: Record<string, number> = TIER_LIMITS, private now: () => number = Date.now, private capacityScale = 1) {}
  check(agentId: string, tier: string, tool: string): { allowed: boolean; retry_after_ms: number } {
    const perMin = (this.limits[tier] ?? 60) * (tool === "live_check" ? 0.25 : 1);
    const capacity = Math.max(1, perMin * this.capacityScale); const refillPerMs = perMin / 60_000;
    const key = `${agentId}:${tool === "live_check" ? "live_check" : "tools"}`;
    const t = this.now(); const b = this.buckets.get(key) ?? { tokens: capacity, updated: t };
    b.tokens = Math.min(capacity, b.tokens + (t - b.updated) * refillPerMs); b.updated = t;
    if (b.tokens >= 1) { b.tokens -= 1; this.buckets.set(key, b); return { allowed: true, retry_after_ms: 0 }; }
    this.buckets.set(key, b);
    return { allowed: false, retry_after_ms: Math.ceil((1 - b.tokens) / refillPerMs) };
  }
  reset() { this.buckets.clear(); }
}
export function errorToHttp(err: unknown): { status: number; body: unknown } {
  if (err instanceof AgentMapError) {
    const status = err.code === "unauthorized" ? 401 : err.code === "rate_limited" ? 429 : err.code === "invalid_input" ? 400 : err.code === "domain_blocked" ? 403 : err.code === "not_found" ? 404 : err.code === "upstream_error" ? 502 : 500;
    return { status, body: err.toJsonRpc() };
  }
  if (err && typeof err === "object" && (err as any).code === "invalid_input") return { status: 400, body: { code: -32602, message: (err as Error).message, data: { code: "invalid_input", message: (err as Error).message, retryable: false } } };
  return { status: 500, body: { code: -32603, message: "internal error", data: { code: "internal", message: "internal error", retryable: false } } };
}
export function zodToAgentError(err: any): AgentMapError {
  const issue = err?.issues?.[0];
  const path = issue?.path?.length ? issue.path.join(".") + ": " : "";
  return new AgentMapError("invalid_input", `${path}${issue?.message ?? "invalid input"}`);
}
