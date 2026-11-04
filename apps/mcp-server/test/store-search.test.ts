import { describe, it, expect } from "vitest";
import { FakeDbClient } from "@agentmap/db";
import { PgStore } from "../src/store.js";

const SITE = { domain: "vec.example", status: "mapped", map_version: 2, last_indexed_at: null };

function dbWith() {
  const db = new FakeDbClient();
  db.handler = (text: string) => {
    if (text.includes("FROM site")) return { rows: [SITE], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return db;
}

describe("PgStore bounded retrieval (HNSW)", () => {
  it("searchNodes orders by cosine distance with LIMIT and keeps entry nodes", async () => {
    const db = dbWith();
    const store = new PgStore(db);
    await store.searchNodes!("vec.example", new Array(1536).fill(0), 24);
    const texts = db.calls.map((c) => c.text);
    const hnsw = texts.find((t) => t.includes("<=>"));
    expect(hnsw).toBeTruthy();
    expect(hnsw!).toContain("FROM node");
    expect(hnsw!).toContain("LIMIT");
    expect(texts.some((t) => t.includes("kind IN"))).toBe(true);
  });
  it("searchNodes unions lexical ILIKE matches for the query text", async () => {
    const db = dbWith();
    const store = new PgStore(db);
    await store.searchNodes!("vec.example", new Array(1536).fill(0), 24, "front brake pads");
    const sql = db.calls.map((c) => c.text).join("\n");
    expect(sql).toContain("ILIKE");
    const lex = db.calls.find((c) => c.text.includes("ILIKE"));
    expect(lex).toBeTruthy();
    expect(lex!.params!.some((p: unknown) => typeof p === "string" && (p as string).includes("brake"))).toBe(true);
  });
  it("searchPathCache orders by question embedding with LIMIT", async () => {
    const db = dbWith();
    const store = new PgStore(db);
    await store.searchPathCache!("vec.example", new Array(1536).fill(0), 3);
    const sql = db.calls.map((c) => c.text).join("\n");
    expect(sql).toContain("path_cache");
    expect(sql).toContain("<=>");
    expect(sql).toContain("LIMIT");
  });
  it("listEdgesForNodes restricts to the node set", async () => {
    const db = dbWith();
    const store = new PgStore(db);
    await store.listEdgesForNodes!("vec.example", ["n1", "n2"]);
    const sql = db.calls.map((c) => c.text).join("\n");
    expect(sql).toContain("from_node_id");
    expect(sql).toContain("ANY");
  });
});
