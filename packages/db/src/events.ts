import { createHash } from "node:crypto";
import type { DbClient } from "./client.js";
export function hashQuestion(canonical: string){ return createHash("sha256").update(canonical).digest("hex"); }
export interface EventInput { agent_id: string|null; domain: string|null; type: string; path_id?: string|null; question_hash?: string|null; latency_ms?: number|null; metadata?: Record<string,unknown>; }
export class BatchedEventWriter {
  private buf: EventInput[]=[]; private timer: ReturnType<typeof setTimeout>|null=null; dropped=0;
  constructor(private db: DbClient, private opts={flushSize:100, flushMs:500, maxBuffer:1000}){}
  write(e: EventInput){ if(this.buf.length>=this.opts.maxBuffer){ this.dropped++; return; } this.buf.push(e); if(this.buf.length>=this.opts.flushSize) void this.flush(); else if(!this.timer) this.timer=setTimeout(()=>void this.flush(), this.opts.flushMs); }
  async flush(){ if(this.timer){clearTimeout(this.timer); this.timer=null;} if(!this.buf.length) return; const batch=this.buf.splice(0,this.buf.length);
    const vals: unknown[]=[]; const tuples=batch.map((e,i)=>{ const b=i*7; vals.push(e.agent_id,e.domain,e.type,e.path_id??null,e.question_hash??null,e.latency_ms??null,JSON.stringify(e.metadata??{})); return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`; });
    await this.db.query(`INSERT INTO event(agent_id,domain,type,path_id,question_hash,latency_ms,metadata) VALUES ${tuples.join(",")}`, vals); }
  async close(){ await this.flush(); }
}
