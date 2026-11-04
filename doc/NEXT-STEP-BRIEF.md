# AgentMap — Next-Step Brief

**Date:** 2026-11-02 · **Master plan:** [plan.md](./plan.md) (moved from repo root) · **Status source:** [../docs/OPEN-ITEMS.md](../docs/OPEN-ITEMS.md)

## 1. The next step (do this first)

**Fix the MCP retrieval data plane, then re-run the speed benchmark.** It is the one change that is simultaneously a known defect, cheap, and decisive for the "is MCP actually faster?" claim.

Concretely, in order:

1. **SQL top-k retrieval.** Replace `PgStore.listNodes` (`SELECT *` over every node + embedding, [store.ts](../apps/mcp-server/src/store.ts)) with a pgvector HNSW query (`ORDER BY embedding <=> $1 LIMIT 24`). The index already exists ([0001_core.sql](../packages/db/migrations/0001_core.sql)); the query path never uses it.
2. **Stop re-ranking in JS over the full graph.** `MatchingService.find` loads all nodes and edges per query ([matching.ts](../packages/matching/src/matching.ts)); compose paths only inside the top-k neighbourhood. Same for `listEdges` and `listPathCache`.
3. **Result cache.** Short-TTL cache (60 s) keyed by `(domain, canonical question)` in front of `Services.find`, invalidated on `publishMapVersion`.
4. **Re-run:** `pnpm --filter @agentmap/bench bench:speed` plus the 60-task live evaluation. Acceptance: carparts.com `find` median from **450 ms → <50 ms**, Arm-B found rate stays ≥98%, pattern hits do not regress.

Then, in sequence: hosted embeddings (needs a key — §6), per-site precision pass on paulaschoice.com (65% pattern hits), and only then any production packaging.

## 2. What is outside this prototype

Deliberately not in the current build or this brief's next step:

- **Business rollout:** pricing enforcement (Q1, deferred), KYC provider integration (Q3, deferred), merchant-facing data sharing (Q4, deferred) — machinery exists, terms do not.
- **Real LLM-agent benchmark arm:** Arm A is a deterministic browsing proxy, not an LLM browsing agent (see §4 caveat).
- **Production hosting:** no chosen cloud, no domain/TLS, no multi-region, no managed Postgres; the service runs locally and the local bench drives it.
- **Merchant onboarding and opt-in crawling partnerships**, the browser extension (spec §15), and Bureau paid lookups (Phase 4 beyond the built trust score).
- **Checkout-adjacent anything:** no cart, payment, or account actions — out of scope by design (spec §6), permanently.
- **Freshness at scale:** no scheduled re-index fleet, no change-detection on merchant sites beyond feedback-driven staleness.

## 3. Current performance (measured, live)

Source: [speed report](../docs/bench/2026-11-02-speed.md), [Arm-B report](../docs/bench/2026-11-02-live-arm-b.md). Warm = runs 2–5, median over successes only.

| Arm | Success | Median time | Median tokens |
| --- | --- | --- | --- |
| B: MCP find (all sites) | 77% | 16 ms | 250 |
| C1: optimized crawl | 52% | 1 ms (warm cache) | 83k |
| A0: naive crawl | 55% | 199 ms | 313k |

Per-site texture the averages hide:

- **carparts.com:** B 90% / 450 ms / 258 tok vs A0 85% / 54 ms / 311k tok. MCP is *slower* here — §5 flaw #1.
- **shadesoflight.com:** B 75% / 16 ms / 232 tok; C1 wins warm on time (1 ms, sitemap cache).
- **paulaschoice.com:** B 65% / 9 ms; every crawl arm 0% in ≤6 steps.
- Overall Arm-B quality (60 tasks): **98% found, 77% exact-target**. Failures preserve `stop_reason`; nothing is silently dropped.

## 4. Is the token saving for AI agents valid?

**Directionally yes, quantitatively unproven.** The claim "MCP saves an agent ~99% of tokens vs browsing" rests on these facts and caveats from the code, not marketing:

What is solid:

- MCP `find` returns ~250 median tokens (measured response bytes ÷ 4 in [mcp-arm.ts](../tools/bench/src/arms/mcp-arm.ts)).
- Any raw crawl ingests full HTML at a median of 83k–573k tokens per task. Even a 10× better tokenizer assumption does not close a 300× gap.

What is **not** yet valid:

- **No real tokenizer and no real LLM.** Every token figure in the repo is `ceil(chars/4)` ([corpus.ts](../tools/bench/src/corpus.ts)); Arm A is a deterministic proxy, never an LLM agent with its own tool-calling overhead. The 99% figure is an estimate with a plausible range, not a billing-grade measurement.
- **Success-conditioned medians.** Token/time medians count successes only; on paulaschoice.com, crawl's "fast" failures cost 0 tokens and 0 ms. Always read speed next to the success column.
- **`tokens_saved_estimate` ships NULL by design** ([tokens-saved.ts](../apps/mcp-server/src/tokens-saved.ts)): no event claims savings until a measured baseline per domain is committed. Do not quote savings to merchants until §6 angle 2 lands and the estimator is wired.
- Warm-crawl caches save network time, not context ingestion; the bench now counts tokens on cache hits — keep it that way.

**Verdict to use externally:** "in our benchmark, a mapped answer costs ~250 tokens vs 80k+ tokens of raw HTML for the same task, at comparable-or-better success." Do not publish a percentage until an LLM arm + a real tokenizer reproduce it.

## 5. Is the speed faster?

**Against MCP: no, not overall, and not honestly close — with one real exception.**

- Warm per-query: B 16 ms beats C1 cold (299 ms) everywhere; C1's 1 ms warm figure is a sitemap-cache jump on shadesoflight.com — legitimate for a warm agent, useless cold.
- Cold first-result: MCP only exists for mapped sites; crawl is the only arm that can answer at all on unmapped/new sites. That is the crawl arm's real win and the report now publishes it separately.
- The exception is ours, not theirs: on carparts.com the naive crawler beat MCP 54 ms vs 450 ms because *our* retrieval loads 7,475 nodes per query. Fix §1 before claiming any speed crown.

## 6. Design flaws found (folder survey, not speculation)

1. **Unused vector index, full-graph load per query.** HNSW indexes exist in migrations; the hot path does `SELECT *` on node+edge+path_cache, parses every 1536-d vector in JS ([store.ts](../apps/mcp-server/src/store.ts)), then re-ranks everything per query ([matching.ts](../packages/matching/src/matching.ts)). O(graph) per request; this is the 450 ms carparts number.
2. **No query-result or connection caching on the read path.** Identical questions re-run the full pipeline; `listPathCache` also loads all rows. PathCache helps matching quality, not latency.
3. **Token-hash embeddings in production path.** `FakeEmbeddingProvider` (SHA-256 token buckets) is what live numbers use — no semantics, which is why a lexical blend had to be bolted into ranking ([retrieve.ts](../packages/matching/src/retrieve.ts)) and why pattern precision is 77%, not 95%.
4. **Shallow, templated node text.** Node descriptions are generated strings ("product page at /x on domain"); embedding quality is bounded by construction, and graph shape comes from link extraction on few pages (75 nodes from one page on paulaschoice.com).
5. **Indexing ignores sitemaps.** The crawl bench exploits merchant sitemaps to win warm; the indexer itself never consumes them ([frontier.ts](../apps/indexer/src/crawl/frontier.ts) is link-walk only). Our own benchmark out-crawls our own indexer.
6. **Benchmark judge is a string match.** `expected_url_pattern` containment mislabels plausible-but-different targets as failures (arm-b report §"pattern hit"); fine for regression tracking, weak for product claims.

## 7. Three optimization angles (pick by the decision each unblocks)

**Angle 1 — Data plane (do first, no vendor needed).**

SQL HNSW top-k + top-k-bounded composition + result cache + connection pooling (also: batch-embed questions once). Expected: carparts `find` 450 ms → <50 ms, overall p95 collapses, crawl's one time-win disappears. Effort: ~1 PR, all inside `packages/db` and `packages/matching`. This is §1 above.

**Angle 2 — Model plane (embeddings + reranking).**

Hosted embeddings for nodes/queries plus a small reranker over top-k (lexical+vector candidates). Fixes the 77% precision and the paulaschoice gap more than any crawler tuning. Requires one provider key (§8). Effort: env + re-index 3 sites (~1 PR plus index runs). Unblocks honest `tokens_saved_estimate` wiring against a re-measured baseline.

**Angle 3 — Runtime plane (crawl fleet + serving scale).**

Move the *indexer/verifier workers* (not the query path) to elastic containers with browser images, per-domain job queues, and autoscaling; keep the read path lean on Postgres. Use only when re-index cadence or bot-wall retry load demands it. This is where Modal enters (§8).

Angles in order of value per effort: 1 ≫ 2 > 3.

## 8. Modal vs Baseten vs Fireworks — should you request access?

Short answer: **request Fireworks first, Modal second, skip Baseten for now.** None is needed for the §1 fix.

| Service | Best fit for us | Needed now? |
| --- | --- | --- |
| Fireworks | Embeddings + reranking | Yes — angle 2 |
| Modal | Crawler/verifier workers | Later — angle 3 |
| Baseten | Dedicated GPU model serving | No |

**Fireworks AI — request access (recommended first).**

- Serverless, OpenAI-compatible APIs for embeddings and reranking, pay-per-token ([docs](https://docs.fireworks.ai/)) — exactly angle 2's missing key, with no deployment work: our `HostedEmbeddingProvider` already speaks this shape ([embeddings.ts](../packages/matching/src/embeddings.ts), `EMBEDDING_*` env vars).
- Also covers a future small LLM for canonicalization/extraction if we ever add one, on the same key.
- Ask for: a standard API account; no enterprise conversation needed at our volume.

**Modal — request access when angle 3 starts (recommended second).**

- Serverless containers with JS/TS SDK, scale-to-zero, scheduled jobs and web endpoints ([docs](https://modal.com/docs)) — the natural home for Playwright indexer/verifier fleets, sweep crons, and burst re-indexing, where our workload is spiky and browser-heavy.
- Useless for today's problem: it does not speed up the Postgres read path or embedding quality.
- Ask for: Starter (free credits) is enough to prove the crawler fleet; Team only when production traffic exists.

**Baseten — do not request yet.**

- Baseten is dedicated GPU inference for *your own/custom deployed models* with autoscaling endpoints ([docs](https://docs.baseten.co/)). We run no custom model today; buying dedicated-GPU serving before angle 2 proves which model we even need is premature.
- Revisit only if we fine-tune a ranker/extractor and outgrow serverless APIs — then Baseten becomes the production home for that model.

**What to tell each vendor if asked:** Fireworks — "embeddings + rerank for a product-search retrieval service, low millions of tokens/day at prototype scale." Modal — "ephemeral Playwright crawling workers, scheduled and bursty, no GPU." Bring this brief; §3–§5 are the numbers they will ask for.
