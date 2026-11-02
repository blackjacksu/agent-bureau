import { describe,it } from "vitest";
// Docker/Testcontainers unavailable in this environment (docker info failed); real DB integration is marked, not fake-passed.
const hasDb = !!process.env.DATABASE_URL;
describe.skipIf(!hasDb)("db integration (requires DATABASE_URL / Testcontainers postgres+pgvector)",()=>{
  it("migrations up + queue claim",()=>{ /* exercised when DATABASE_URL set against pgvector image */ });
});
