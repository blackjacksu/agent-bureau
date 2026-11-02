import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider, cosine } from "../src/embeddings.js";

// Regression: indexer and query service create separate Fake providers. If their
// dims differ, stored node vectors and query vectors live in different spaces
// and cosine retrieval silently returns no_path on every real graph.
describe("FakeEmbeddingProvider dimension consistency", () => {
  it("defaults to the DB vector(1536) dimension on every instance", async () => {
    const indexerSide = new FakeEmbeddingProvider();
    const querySide = new FakeEmbeddingProvider();
    expect(indexerSide.dims).toBe(1536);
    const nodeVec = await indexerSide.embed("category /skin-care vitamin c serum product");
    const queryVec = await querySide.embed("vitamin c serum");
    expect(nodeVec).toHaveLength(1536);
    expect(cosine(nodeVec, queryVec)).toBeGreaterThan(0.3);
  });
});
