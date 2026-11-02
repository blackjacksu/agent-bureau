import type { DbClient } from "./client.js";

/** Plan 13.4/Phase 3-4 read models: pure SQL aggregates over the append-only event log. */
export async function agentUsage(db: DbClient, agentId: string, sinceIso: string) {
  const r = await db.query(
    `SELECT type, count(*)::int AS n FROM event WHERE agent_id=$1 AND created_at >= $2 GROUP BY type ORDER BY type`,
    [agentId, sinceIso],
  );
  const byType: Record<string, number> = {};
  let total = 0;
  for (const row of r.rows) { byType[row.type] = row.n; total += row.n; }
  return { agent_id: agentId, since: sinceIso, total, by_type: byType };
}

export interface TrustInputs { outcomes: number; successes: number; failures: number; step_failures: number; live_checks: number; queries: number; domains: number }
export async function agentTrustInputs(db: DbClient, agentId: string): Promise<TrustInputs> {
  const r = await db.query(
    `SELECT
       count(*) FILTER (WHERE type='outcome')::int AS outcomes,
       count(*) FILTER (WHERE type='outcome' AND metadata->>'success'='true')::int AS successes,
       count(*) FILTER (WHERE type='outcome' AND metadata->>'success'='false')::int AS failures,
       count(*) FILTER (WHERE type='step_failed')::int AS step_failures,
       count(*) FILTER (WHERE type='live_check')::int AS live_checks,
       count(*) FILTER (WHERE type='query')::int AS queries,
       count(DISTINCT domain)::int AS domains
     FROM event WHERE agent_id=$1`,
    [agentId],
  );
  const row = r.rows[0] ?? {};
  return { outcomes: row.outcomes ?? 0, successes: row.successes ?? 0, failures: row.failures ?? 0, step_failures: row.step_failures ?? 0, live_checks: row.live_checks ?? 0, queries: row.queries ?? 0, domains: row.domains ?? 0 };
}

export async function domainDemand(db: DbClient, domain: string) {
  const signals = await db.query(`SELECT source, count(*)::int AS n FROM demand_signal WHERE domain=$1 GROUP BY source ORDER BY source`, [domain]);
  const misses = await db.query(`SELECT count(*)::int AS n FROM event WHERE domain=$1 AND type='query'`, [domain]);
  const site = await db.query(`SELECT domain, status, map_version, demand_score FROM site WHERE domain=$1`, [domain]);
  return { domain, site: site.rows[0] ?? null, query_events: misses.rows[0]?.n ?? 0, signals: signals.rows.map((r: any) => ({ source: r.source, n: r.n })) };
}

export async function domainJourneys(db: DbClient, domain: string, limit = 50) {
  const r = await db.query(
    `SELECT type, count(*)::int AS n FROM event WHERE domain=$1 GROUP BY type ORDER BY n DESC`,
    [domain],
  );
  const stuck = await db.query(
    `SELECT metadata->>'failed_step_index' AS failed_step_index, count(*)::int AS n FROM event WHERE domain=$1 AND type='step_failed' GROUP BY 1 ORDER BY n DESC LIMIT $2`,
    [domain, limit],
  );
  return { domain, by_type: r.rows.map((x: any) => ({ type: x.type, n: x.n })), stuck_at_step: stuck.rows };
}

export async function setOperatorVerification(db: DbClient, operatorId: string, status: string) {
  const r = await db.query(`UPDATE operator SET verification_status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [operatorId, status]);
  if (!r.rows[0]) return null;
  await db.query(`UPDATE agent SET verified=($2='verified'), updated_at=now() WHERE operator_id=$1`, [operatorId, status]);
  return r.rows[0];
}
