import type { DbClient } from "./client.js";
/** Atomic publish: flip site.map_version in one transaction; stale old path_cache. On error transaction rolls back (client handles). */
export async function publishMapVersion(db: DbClient, domain: string, newVersion: number){
  return db.transaction(async(tx)=>{
    await tx.query(`UPDATE path_cache SET stale=true, updated_at=now() WHERE domain=$1`,[domain]);
    const r=await tx.query(`UPDATE site SET map_version=$2, status='mapped', last_indexed_at=now(), updated_at=now() WHERE domain=$1 RETURNING *`,[domain,newVersion]);
    if(!r.rows[0]) throw new Error("site_not_found");
    return r.rows[0];
  });
}
/** Load .sql migration files (sorted) from the package migrations dir. Works from src/ and dist/ (both one level below package root). */
export async function loadMigrations(dir?: string): Promise<{ name: string; sql: string }[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const base = dir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = (await readdir(base)).filter((f) => f.endsWith(".sql")).sort();
  const out: { name: string; sql: string }[] = [];
  for (const f of files) out.push({ name: f, sql: await readFile(path.join(base, f), "utf8") });
  return out;
}
export async function runMigrations(db: DbClient, migrations: {name:string;sql:string}[]){
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for(const m of migrations){ const done=await db.query(`SELECT 1 FROM schema_migrations WHERE name=$1`,[m.name]); if(done.rows.length) continue; await db.transaction(async(tx)=>{ await tx.query(m.sql); await tx.query(`INSERT INTO schema_migrations(name) VALUES($1)`,[m.name]); }); }
}
