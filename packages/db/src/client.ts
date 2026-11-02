import pg from "pg";
export interface DbClient { query<T=any>(text: string, params?: unknown[]): Promise<{rows:T[]; rowCount:number|null}>; transaction<T>(fn:(c:DbClient)=>Promise<T>): Promise<T>; end?():Promise<void>; }
export class PgClient implements DbClient {
  constructor(private pool: pg.Pool){}
  static fromUrl(url: string){ return new PgClient(new pg.Pool({connectionString:url})); }
  async query(text:string, params?:unknown[]){ const r=await this.pool.query(text, params as any); return {rows:r.rows, rowCount:r.rowCount}; }
  async transaction<T>(fn:(c:DbClient)=>Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const wrapped: DbClient = { query: async(t,p)=>{ const r=await client.query(t,p as any); return {rows:r.rows,rowCount:r.rowCount}; }, transaction: async(f)=>f(wrapped) };
    try{ await client.query("BEGIN"); const out=await fn(wrapped); await client.query("COMMIT"); return out; }catch(e){ await client.query("ROLLBACK"); throw e; } finally{ client.release(); }
  }
  async end(){ await this.pool.end(); }
}
/** In-memory fake for unit tests of queue/publish/event logic (not a SQL fake). */
export class FakeDbClient implements DbClient {
  calls: {text:string;params?:unknown[]}[] = []; handler: (text:string,params?:unknown[])=>any = ()=>({rows:[],rowCount:0});
  async query(text:string, params?:unknown[]){ this.calls.push({text,params}); return this.handler(text,params); }
  async transaction<T>(fn:(c:DbClient)=>Promise<T>){ this.calls.push({text:"BEGIN"}); try{ const o=await fn(this); this.calls.push({text:"COMMIT"}); return o; }catch(e){ this.calls.push({text:"ROLLBACK"}); throw e; } }
}
