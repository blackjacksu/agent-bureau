import { describe,it,expect } from "vitest";
import { FakeDbClient, BatchedEventWriter, hashQuestion, backoffMs, claimJob, CLAIM_SQL, publishMapVersion } from "../src/index.js";
describe("queue logic (unit, fake client)",()=>{
  it("backoff schedule 30s/5m/30m",()=>{ expect([backoffMs(1),backoffMs(2),backoffMs(3),backoffMs(9)]).toEqual([30000,300000,1800000,1800000]); });
  it("claim uses SKIP LOCKED",async()=>{ const db=new FakeDbClient(); db.handler=()=>({rows:[{id:"1"}],rowCount:1}); expect(await claimJob(db,"w1")).toBeTruthy(); expect(CLAIM_SQL).toContain("SKIP LOCKED"); });
});
describe("event writer",()=>{
  it("hash only, flush at size",async()=>{ const db=new FakeDbClient(); const w=new BatchedEventWriter(db,{flushSize:2,flushMs:500,maxBuffer:10}); w.write({agent_id:null,domain:"a.com",type:"query",question_hash:hashQuestion("brake pads for {year}")}); w.write({agent_id:null,domain:"a.com",type:"query"}); await new Promise(r=>setTimeout(r,20)); expect(db.calls.some(c=>c.text.includes("INSERT INTO event"))).toBe(true); expect(hashQuestion("x")).toHaveLength(64); });
});
describe("publish",()=>{
  it("transaction flips version",async()=>{ const db=new FakeDbClient(); db.handler=(t)=> t.includes("UPDATE site")?{rows:[{domain:"a.com",map_version:2}],rowCount:1}:{rows:[],rowCount:0}; const out:any=await publishMapVersion(db,"a.com",2); expect(out.map_version).toBe(2); expect(db.calls.map(c=>c.text)).toContain("COMMIT"); });
  it("rolls back on failure",async()=>{ const db=new FakeDbClient(); db.handler=()=>{throw new Error("boom")}; await expect(publishMapVersion(db,"a.com",2)).rejects.toThrow(); expect(db.calls.map(c=>c.text)).toContain("ROLLBACK"); });
});
