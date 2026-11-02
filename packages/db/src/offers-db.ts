import type { DbClient } from "./client.js";

/** Phase 5 offer persistence (plan 16.3). Provenance (source_id) is mandatory. */
export async function upsertOfferSource(db: DbClient, input: { kind: string; name: string; commercial_relationship: string; terms_url?: string }) {
  const r = await db.query(
    `INSERT INTO offer_source(kind,name,terms_url,commercial_relationship) VALUES($1::offer_source_kind,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING *`,
    [input.kind, input.name, input.terms_url ?? null, input.commercial_relationship],
  );
  if (r.rows[0]) return r.rows[0];
  const existing = await db.query(`SELECT * FROM offer_source WHERE name=$1 LIMIT 1`, [input.name]);
  return existing.rows[0];
}

export async function upsertOffer(db: DbClient, input: {
  domain: string; source_id: string; code: string | null; title: string;
  discount_type: string; discount_value: number | null; status?: string; expires_at?: string | null;
}) {
  const r = await db.query(
    `INSERT INTO offer(domain,source_id,code,title,discount_type,discount_value,status,expires_at)
     VALUES($1,$2,$3,$4,$5::discount_type,$6,COALESCE($7::offer_status,'unverified'),$8) RETURNING *`,
    [input.domain, input.source_id, input.code, input.title, input.discount_type, input.discount_value, input.status ?? null, input.expires_at ?? null],
  );
  return r.rows[0];
}

export async function listActiveOffers(db: DbClient, domain: string) {
  const r = await db.query(
    `SELECT o.*, s.kind AS source_kind, s.commercial_relationship FROM offer o JOIN offer_source s ON s.id=o.source_id
     WHERE o.domain=$1 AND o.status IN ('active','unverified') AND (o.expires_at IS NULL OR o.expires_at > now())
     ORDER BY o.last_verified_at DESC NULLS LAST LIMIT 50`,
    [domain],
  );
  return r.rows.map((row: any) => ({
    offer_id: `o_${row.id}`, code: row.code, title: row.title,
    discount: { type: row.discount_type, value: row.discount_value != null ? Number(row.discount_value) : null },
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    verified: row.status === "active" && !!row.last_verified_at,
    last_verified_at: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
    source_kind: row.source_kind, commercial_relationship: row.commercial_relationship,
    apply_hint: "Enter at checkout — AgentMap does not apply codes for you.",
    status: row.status, starts_at: null,
  }));
}

export async function markOfferChecked(db: DbClient, offerUuid: string, status: string) {
  await db.query(
    `UPDATE offer SET status=$2::offer_status, last_verified_at=now(), verify_attempts=verify_attempts+1,
       verify_successes=verify_successes + CASE WHEN $2='active' THEN 1 ELSE 0 END, updated_at=now() WHERE id=$1`,
    [offerUuid, status],
  );
}
