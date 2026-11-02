import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgClient, loadMigrations, runMigrations, upsertOfferSource, upsertOffer, listActiveOffers, markOfferChecked } from "../src/index.js";

// Offer persistence (plan 16.3) on real Postgres. Requires DATABASE_URL.
const hasDb = !!process.env.DATABASE_URL;
const db = hasDb ? PgClient.fromUrl(process.env.DATABASE_URL!) : (null as unknown as PgClient);
describe.skipIf(!hasDb)("offers-db (real Postgres)", () => {
  beforeAll(async () => {
    await runMigrations(db, await loadMigrations());
    await db.query(`INSERT INTO site(domain,status) VALUES('offers.example','mapped') ON CONFLICT (domain) DO NOTHING`);
    await db.query(`DELETE FROM offer WHERE domain='offers.example'`);
  }, 60_000);
  afterAll(async () => { if (hasDb) await db.end(); });

  it("source -> offer -> list -> verify-check roundtrip; expired/revoked excluded", async () => {
    const src = await upsertOfferSource(db, { kind: "merchant_public_page", name: "offers.example public page", commercial_relationship: "none" });
    expect(src.id).toBeTruthy();
    const o = await upsertOffer(db, { domain: "offers.example", source_id: src.id, code: "TESTCODE-10", title: "10% off", discount_type: "percent", discount_value: 10 });
    await upsertOffer(db, { domain: "offers.example", source_id: src.id, code: "TESTCODE-OLD", title: "old", discount_type: "percent", discount_value: 5, status: "revoked" });
    let list = await listActiveOffers(db, "offers.example");
    expect(list.map((x: any) => x.code)).toEqual(["TESTCODE-10"]);
    expect(list[0].verified).toBe(false);
    await markOfferChecked(db, o.id, "active");
    list = await listActiveOffers(db, "offers.example");
    expect(list[0].verified).toBe(true);
    expect(list[0].source_kind).toBe("merchant_public_page");
  });
  it("offer without provenance is rejected by FK", async () => {
    await expect(upsertOffer(db, { domain: "offers.example", source_id: "00000000-0000-4000-8000-000000000000", code: "X1", title: "x", discount_type: "info", discount_value: null })).rejects.toThrow();
  });
});
