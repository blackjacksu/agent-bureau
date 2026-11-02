import type { DbClient } from "./client.js";
export function backoffMs(attempt: number): number { const table=[30_000,300_000,1_800_000]; return table[Math.min(Math.max(attempt-1,0), table.length-1)]!; }
export const CLAIM_SQL = `UPDATE job SET status='running', locked_by=$1, locked_at=now(), attempts=attempts+1, updated_at=now() WHERE id=(SELECT id FROM job WHERE status='queued' AND run_after<=now() ORDER BY run_after ASC FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
export async function claimJob(db: DbClient, workerId: string){ const r=await db.query(CLAIM_SQL,[workerId]); return r.rows[0] ?? null; }
export async function enqueueJob(db: DbClient, kind: string, payload: unknown){ const r=await db.query(`INSERT INTO job(kind,payload) VALUES($1,$2) RETURNING *`,[kind,JSON.stringify(payload)]); return r.rows[0]; }
export async function failJob(db: DbClient, id: string, attempts: number, maxAttempts: number, error: string){
  if(attempts>=maxAttempts) return db.query(`UPDATE job SET status='dead', last_error=$2, updated_at=now() WHERE id=$1`,[id,error]);
  const delay=backoffMs(attempts);
  return db.query(`UPDATE job SET status='queued', run_after=now()+($2||' milliseconds')::interval, last_error=$3, updated_at=now() WHERE id=$1`,[id,String(delay),error]);
}
export async function completeJob(db: DbClient, id: string){ return db.query(`UPDATE job SET status='succeeded', updated_at=now() WHERE id=$1`,[id]); }
