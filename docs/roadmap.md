# Roadmap — what remains after Phase 0

Phase 0 is built and green: all W1–W15 units of the v0.2 plan are done, 387 tests passing, live maps for carparts (v2), shadesoflight, paulaschoice, and booking.com, benchmarks in `docs/bench/`. Recently landed: HNSW top-k retrieval + result cache (carparts `find` 450 ms → ~35 ms), sitemap-seeded indexing, hosted (nomic) embeddings, live-eval bench arm.

## Awaiting owner decisions (deferred 2026-11-02)

| Item | Unblocks | First step |
| --- | --- | --- |
| Q1 pricing (Free / Builder / Scale) | Billing, offer credits | ADR with price points; config-only change |
| Q3 KYC provider | Verified operators (Phase 2) | Pick provider; one adapter behind the transition endpoint |
| Q4 merchant sharing terms | Merchant-facing dashboard (Phase 3) | Define scope; flip dashboard auth to merchant keys |

## Still to build

- **LLM eval arm** — replace the deterministic crawl proxy with an LLM browsing agent on the 60-task corpus; its report supersedes the proxy numbers.
- **Elastic crawl fleet** — indexer/verifier workers to scale-to-zero containers when re-index cadence demands it; a freshness fix, not a latency fix.
- **Production hosting** — no chosen cloud, domain/TLS, or managed Postgres yet; the service runs locally.
- **Offers activation** — hunter sweep worker, incentive ledger, merchant dashboard/opt-in feed; gated on Q1 + Q4 above.
- **Freshness at scale** — scheduled re-indexing and change detection beyond feedback-driven staleness.
- **Phase 4 trust scoring** — Bureau paid lookups over usage and feedback history.
- **Open protocol questions** — Q5 UCP extension, Q6 browser extension, Q7 embedding pick (de-facto nomic-embed-text; ADR it), Q8 Streamable HTTP session state.

## Records

Decisions: `docs/adr/`. Evidence: `docs/bench/`, `docs/site-status.md`. Ops: `docs/runbooks/`, `docs/data-policy.md`.
