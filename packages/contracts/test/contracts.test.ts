import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as C from "../src/index.js";
const golden = JSON.parse(readFileSync(new URL("./fixtures/tools/find-golden.json", import.meta.url),"utf8"));
const offerFx = JSON.parse(readFileSync(new URL("./fixtures/tools/offer.json", import.meta.url),"utf8"));
describe("golden find (spec 12)",()=>{
  it("input parses",()=>{ expect(C.FindInputSchema.parse(golden.input)).toEqual(golden.input); });
  it("output parses and core fields match spec example",()=>{
    const out = C.FindOutputSchema.parse(golden.output) as any;
    expect(out.steps).toEqual(golden.specOutput.steps);
    expect(out.result_url_template).toEqual(golden.specOutput.result_url_template);
    expect(out.needs_live_check).toEqual(golden.specOutput.needs_live_check);
    expect(out.path_id).toEqual(golden.specOutput.path_id);
    expect(out.offers).toEqual([]);
  });
  it("rejects oversize question",()=>{ expect(()=>C.FindInputSchema.parse({domain:"a.com",question:"x".repeat(501)})).toThrow(); });
});
describe("all 7 tools valid/invalid",()=>{
  const valid:any = { is_mapped:{domain:"a.com"}, find:{domain:"a.com",question:"brakes"}, get_path:{domain:"a.com",goal:"brakes"}, live_check:{url:"https://a.com/p"}, report_outcome:{domain:"a.com",path_id:"p_1",success:true}, request_mapping:{domain:"a.com"}, my_sites:{action:"list"} };
  for(const n of C.TOOL_NAMES){ it(n+" valid",()=>{ expect(C.ToolInputSchemas[n].safeParse(valid[n]).success).toBe(true); }); it(n+" rejects wrong type",()=>{ expect(C.ToolInputSchemas[n].safeParse({domain:123}).success).toBe(false); }); }
  it("tool descriptions distinct for find vs get_path",()=>{ expect(C.TOOL_DESCRIPTIONS.find).not.toEqual(C.TOOL_DESCRIPTIONS.get_path); });
});
describe("errors",()=>{ for(const [code,def] of Object.entries(C.ERROR_DEFS)){ it(code,()=>{ const e=C.makeError(code as any,"m"); expect(e.data.retryable).toBe((def as any).retryable); expect(C.JsonRpcErrorSchema.parse(e)).toBeTruthy(); }); } });
describe("jobs/events/offers",()=>{
  it("job payloads",()=>{ expect(C.parseJobPayload("index_domain",{domain:"a.com"})).toBeTruthy(); expect(()=>C.parseJobPayload("index_domain",{})).toThrow(); expect(()=>C.parseJobPayload("verify_url",{url:"noturl"})).toThrow(); });
  it("event metadata allowlist",()=>{ expect(()=>C.validateEventMetadata("query",{bogus:1})).toThrow(); expect(C.validateEventMetadata("offers_served",{offer_ids:[],domain:"a.com",via:"find"})).toBeTruthy(); });
  it("offer fixture + code:null variant",()=>{ expect(C.OfferSchema.parse(offerFx)).toBeTruthy(); expect(C.OfferSchema.parse({...offerFx,code:null,url:"https://a.com/sale"})).toBeTruthy(); });
  it("find_offers unregistered shape",()=>{ expect(C.FindOffersInputSchema.parse({domain:"a.com"})).toBeTruthy(); expect(C.FindOffersOutputSchema.parse({offers:[]})).toBeTruthy(); expect(C.TOOL_NAMES).not.toContain("find_offers"); });
});
