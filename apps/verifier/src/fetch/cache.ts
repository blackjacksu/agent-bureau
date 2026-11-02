import { createHash } from "node:crypto";
import type { LiveCheckOutput } from "../verifier-types.js";

export function urlHash(url: string): string { return createHash("sha256").update(url).digest("hex"); }

export interface VerifyCachePort {
  get(url: string): Promise<LiveCheckOutput | null>;
  set(url: string, result: LiveCheckOutput): Promise<void>;
}

/** Plan 10.2: 30s TTL (default). Rows older than TTL are invisible to reads. */
export class InMemoryVerifyCache implements VerifyCachePort {
  private map = new Map<string, { result: LiveCheckOutput; fetchedAt: number }>();
  constructor(private ttlMs = 30_000, private now: () => number = Date.now) {}
  async get(url: string) {
    const e = this.map.get(urlHash(url)); if (!e) return null;
    if (this.now() - e.fetchedAt > this.ttlMs) { this.map.delete(urlHash(url)); return null; }
    return { ...e.result, source: "cache" as const };
  }
  async set(url: string, result: LiveCheckOutput) { this.map.set(urlHash(url), { result, fetchedAt: this.now() }); }
  clear() { this.map.clear(); }
}

/** Postgres verify_cache port (verify_cache table from packages/db migrations). */
export class PgVerifyCache implements VerifyCachePort {
  constructor(private db: { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }, private ttlSec = 30) {}
  async get(url: string) {
    const r = await this.db.query(`SELECT result FROM verify_cache WHERE url_hash=$1 AND fetched_at > now() - ($2 || ' seconds')::interval`, [urlHash(url), String(this.ttlSec)]);
    if (!r.rows[0]) return null;
    const result = typeof r.rows[0].result === "string" ? JSON.parse(r.rows[0].result) : r.rows[0].result;
    return { ...result, source: "cache" as const };
  }
  async set(url: string, result: LiveCheckOutput) {
    await this.db.query(`INSERT INTO verify_cache(url_hash,result,fetched_at) VALUES($1,$2,now()) ON CONFLICT(url_hash) DO UPDATE SET result=EXCLUDED.result, fetched_at=now()`, [urlHash(url), JSON.stringify(result)]);
  }
}
