import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgClient, BatchedEventWriter, claimJob, enqueueJob, hashQuestion, loadMigrations, publishMapVersion, runMigrations } from "../src/index.js";

// Real Postgres + pgvector integration (plan 17.3). Runs when DATABASE_URL is set:
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test pnpm --filter @agentmap/db exec vitest run test/integration.test.ts
// Local cluster: brew install postgresql@17 pgvector; initdb; CREATE DATABASE agentmap_test;
const hasDb = !!process.env.DATABASE_URL;
const vec = (seed: number) => `[${Array.from({ length: 1536 }, (_, i) => ((i + seed) % 7 === 0 ? 0.9 : 0.01)).join(",")}]`;

describe.skipIf(!hasDb)("db integration (real Postgres + pgvector)", () => {
  const db = hasDb ? PgClient.fromUrl(process.env.DATABASE_URL!) : (null as unknown as PgClient);
  beforeAll(async () => {
    await runMigrations(db, await loadMigrations());
  }, 60_000);
  afterAll(async () => { if (hasDb) await db.end(); });

  it("migrations apply idempotently and create core tables + vector extension", async () => {
    await runMigrations(db, await loadMigrations()); // second run: no-op, no error
    const t = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('site','node','edge','path_cache','operator','agent','api_key','event','job','offer','offer_source') ORDER BY 1`);
    expect(t.rows.length).toBe(11);
    const ext = await db.query(`SELECT extversion FROM pg_extension WHERE extname='vector'`);
    expect(ext.rows.length).toBe(1);
  });

  it("pgvector cosine NN returns nearest node first", async () => {
    await db.query(`INSERT INTO site(domain,status) VALUES('vec.example','mapped') ON CONFLICT (domain) DO NOTHING`);
    await db.query(`DELETE FROM node WHERE domain='vec.example'`);
    await db.query(`INSERT INTO node(domain,map_version,url_pattern,kind,description,embedding,embedding_model) VALUES('vec.example',1,'/near','product','near',$1,'test'),('vec.example',1,'/far','product','far',$2,'test')`, [vec(0), vec(3)]);
    const r = await db.query(`SELECT url_pattern FROM node WHERE domain='vec.example' ORDER BY embedding <=> $1 LIMIT 1`, [vec(0)]);
    expect(r.rows[0].url_pattern).toBe("/near");
  });

  it("concurrent claimJob: exactly one worker wins a single queued job (SKIP LOCKED)", async () => {
    await db.query(`DELETE FROM job`);
    const job = await enqueueJob(db, "index_domain", { domain: "claim.example" });
    const claims = await Promise.all(Array.from({ length: 5 }, (_, i) => claimJob(db, `w${i}`)));
    const won = claims.filter(Boolean);
    expect(won).toHaveLength(1);
    expect(won[0].id).toBe(job.id);
  });

  it("publishMapVersion flips version atomically and stales path_cache", async () => {
    await db.query(`INSERT INTO path_cache(domain,question_canonical,ordered_edge_ids) VALUES('vec.example','brake pads {year}',ARRAY[]::uuid[])`);
    const row = await publishMapVersion(db, "vec.example", 2);
    expect(row.map_version).toBe(2);
    expect(row.status).toBe("mapped");
    const pc = await db.query(`SELECT stale FROM path_cache WHERE domain='vec.example'`);
    expect(pc.rows.every((r: any) => r.stale === true)).toBe(true);
  });

  it("event writer stores hash only and rows are append-only shaped", async () => {
    const w = new BatchedEventWriter(db, { flushSize: 100, flushMs: 10, maxBuffer: 100 });
    w.write({ agent_id: null, domain: "vec.example", type: "query", question_hash: hashQuestion("brake pads {year}"), latency_ms: 42, metadata: { via: "test" } });
    await w.flush();
    const r = await db.query(`SELECT question_hash, latency_ms FROM event WHERE domain='vec.example' AND type='query' ORDER BY id DESC LIMIT 1`);
    expect(r.rows[0].question_hash).toBe(hashQuestion("brake pads {year}"));
    expect(r.rows[0].latency_ms).toBe(42);
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='event'`);
    expect(cols.rows.map((c: any) => c.column_name)).not.toContain("question_text");
  });
});
