#!/usr/bin/env node
import { createEmbeddingProviderFromEnv } from "@agentmap/matching";
import { PgClient, createOperator, createAgent, issueApiKey, revokeApiKey } from "@agentmap/db";
// Admin CLI (plan 12.1/12.3): manual key issuance for Phase 0.
// Usage: issue-key [--agent-id <uuid>] [--operator-id <uuid>] [--tier free] [--model m --model-version v]
const args = process.argv.slice(2); const cmd = args[0];
function flag(name: string) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; }
async function main() {
  const url = process.env.DATABASE_URL; const pepper = process.env.API_KEY_PEPPER;
  if (!url || !pepper) { console.error("DATABASE_URL and API_KEY_PEPPER are required"); process.exit(1); }
  const db = PgClient.fromUrl(url);
  try {
    if (cmd === "issue-key") {
      let agentId = flag("agent-id");
      if (!agentId) { const op = flag("operator-id") ? { id: flag("operator-id") } : await createOperator(db, flag("operator-type") ?? "person"); const ag = await createAgent(db, op.id, { tier: flag("tier") ?? "free", declared_model: flag("model"), declared_model_version: flag("model-version") }); agentId = ag.id; console.log(`agent_id=${agentId} operator_id=${op.id}`); }
      const issued = await issueApiKey(db, agentId!, pepper);
      console.log(`api_key=${issued.fullKey}`); console.log("Store this key now — it is shown once.");
    } else if (cmd === "revoke-key") { const id = flag("key-id"); if (!id) throw new Error("--key-id required"); await revokeApiKey(db, id); console.log(`revoked=${id}`); }
    else if (cmd === "reembed") {
      // Re-embed node + path_cache rows whose embedding_model differs from the configured provider (idempotent, resumable).
      const provider = createEmbeddingProviderFromEnv(process.env); const conc = Number(flag("concurrency") ?? 8); const limit = Number(flag("limit") ?? 1e9);
      const model = provider.model; console.log(`provider model=${model}`);
      const vec = (v: number[]) => `[${v.join(",")}]`;
      const pool = async <T>(rows: T[], fn: (r: T) => Promise<void>) => { let i = 0, done = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < rows.length) { const r = rows[i++]; await fn(r); if (++done % 500 === 0) console.log(`  ${done}/${rows.length}`); } })); };
      const nodes = (await db.query(`SELECT id, kind, url_pattern, description FROM node WHERE embedding_model IS DISTINCT FROM $1 LIMIT $2`, [model, limit])).rows as any[];
      console.log(`nodes to embed: ${nodes.length}`);
      await pool(nodes, async (n) => { const e = await provider.embed(`${n.kind} ${n.url_pattern} ${n.description}`); await db.query(`UPDATE node SET embedding=$1::vector, embedding_model=$2 WHERE id=$3`, [vec(e), model, n.id]); });
      // path_cache has no model column: always re-embed its questions so query/cache vectors share one space.
      const caches = (await db.query(`SELECT id, question_canonical FROM path_cache`)).rows as any[];
      console.log(`path_cache questions to embed: ${caches.length}`);
      await pool(caches, async (c) => { const e = await provider.embed(c.question_canonical); await db.query(`UPDATE path_cache SET question_embedding=$1::vector WHERE id=$2`, [vec(e), c.id]); });
      console.log("reembed complete");
    }
    else { console.error("commands: issue-key | revoke-key | reembed"); process.exit(1); }
  } finally { await db.end?.(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "error"); process.exit(1); });
