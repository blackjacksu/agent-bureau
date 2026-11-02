import { describe,it,expect,vi } from "vitest";
import { EmptyOfferProvider, rankOffers, getOffers, isEligible } from "../src/index.js";
const baseCtx={optedOut:false,offersEnabled:true,domainEnabled:true,tierAllowed:true,now:new Date("2026-01-01T00:00:00Z")};
const mk=(v:number,exp?:string)=>({offer_id:"o"+v,code:"TESTCODE-"+v,title:"t",discount:{type:"percent" as const,value:v},expires_at:exp??null,verified:true,last_verified_at:"2026-01-01T00:00:00.000Z",source_kind:"merchant_public_page" as const,commercial_relationship:"none",apply_hint:"x"});
describe("offers seam",()=>{
  it("empty provider always []",async()=>{ expect(await new EmptyOfferProvider().getOffers({domain:"a.com"})).toEqual([]); });
  it("opted-out short-circuits before provider",async()=>{ const p={getOffers:vi.fn(async()=> [mk(10)] as any)}; expect(await getOffers(p,{domain:"a.com"},{...baseCtx,optedOut:true})).toEqual([]); expect(p.getOffers).not.toHaveBeenCalled(); });
  it("expired filtered + rank cap 3",async()=>{ const offers=[mk(5),mk(20),mk(10),mk(15),mk(99,"2020-01-01T00:00:00.000Z")] as any; const p={getOffers:async()=>offers}; const out=await getOffers(p,{domain:"a.com"},baseCtx); expect(out.map(o=>o.discount.value)).toEqual([20,15,10]); });
  it("flag matrix off",async()=>{ for(const patch of [{offersEnabled:false},{domainEnabled:false},{tierAllowed:false}]){ const p={getOffers:vi.fn(async()=>[] as any)}; expect(await getOffers(p,{domain:"a.com"},{...baseCtx,...patch})).toEqual([]); expect(p.getOffers).not.toHaveBeenCalled(); } });
});
