import { describe, it, expect } from "vitest";
import { HostedEmbeddingProvider, cosine } from "../src/embeddings.js";

const fakeFetch = (vec: number[]) => (async () => ({ ok: true, json: async () => ({ data: [{ embedding: vec }] }) })) as unknown as typeof fetch;

describe("EMBEDDING_PAD_TO", () => {
  it("zero-pads to the target size without changing cosine", async () => {
    const raw = [0.3, -0.2, 0.9];
    const p = new HostedEmbeddingProvider({ apiKey: "k", padTo: 8, fetchFn: fakeFetch(raw) });
    const v = await p.embed("x");
    expect(v).toHaveLength(8); expect(p.dims).toBe(8);
    expect(cosine(v, [...raw, 0, 0, 0, 0, 0])).toBeCloseTo(1, 10);
  });
  it("rejects vectors larger than the pad target", async () => {
    const p = new HostedEmbeddingProvider({ apiKey: "k", padTo: 2, fetchFn: fakeFetch([1, 2, 3]) });
    await expect(p.embed("x")).rejects.toThrow(/exceed/);
  });
});
