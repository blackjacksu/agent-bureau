# Demo Q&A — design rationale, unbuilt performance work, and the survival question

Use this when someone asks hard questions during or after the [3-minute video](./VIDEO-SCRIPT.md). Short answers first; the evidence links are the long answer. Numbers are from [../bench/2026-11-02-speed.md](../bench/2026-11-02-speed.md).

## Why is it designed this way?

**Q: Why a hosted MCP service instead of a local tool or a browser extension?**
A shared map is the whole product. If every agent crawls locally, every agent re-pays the crawl cost and nothing compounds. A hosted Streamable-HTTP MCP means one crawl becomes a graph every connected agent reuses, plus a central registry, event log, and feedback loop (`report_outcome`) that makes the map self-correcting. A local stdio server fragments all of that per machine.

**Q: Why TypeScript/Node instead of Rust, if performance matters?**
Phase 0's bottleneck was never CPU — it was iteration speed over messy extraction, matching quality, and MCP/Playwright ergonomics. TypeScript kept contracts, server, indexer, and verifier in one type system. Rust stays available behind seams (indexer/verifier are separate processes) if profiling ever shows our own code, not I/O or Postgres, dominating latency. So far it does not.

**Q: Why Postgres + pgvector for everything (graph, vectors, queue, registry)?**
One system, one backup story, transactional publish of a new map version. The graph is relational (nodes/edges/paths), retrieval is vector, jobs are a queue — Postgres does all three adequately at prototype scale and avoids operating three datastores before the thesis is proven.

**Q: Why crawl with a real browser (Playwright) instead of plain HTTP?**
Retail catalogues are JavaScript-heavy. HTTP-only extraction silently returns empty or wrong pages on exactly the sites agents shop on. The browser costs more per page, which is precisely why the cost is paid once by the indexer and amortized across agents — not paid per agent per task.

**Q: Why benchmark-first, only 3 sites deep, instead of mapping many sites shallowly?**
The claim "a map beats raw browsing" is falsifiable only with depth: same tasks, same judge, crawl arms vs MCP arm. Three sites × 20 tasks × repeated runs gives a defensible number; 300 shallow sites would give an anecdote. Broad coverage is a scaling problem, and scaling an unproven saving is waste.

**Q: Why does the map never serve prices or stock?**
Because a stale price is worse than no price. The map stores *how to get there* (navigation, filters, URL templates); `live_check` re-verifies price/stock at answer time. The graph is durable knowledge; prices are not.

**Q: Why is the crawler polite — robots.txt, rate limits, no bot-wall evasion?**
Three of the original target sites bot-walled us and we recorded `blocked: bot_protection` rather than evading (see [../site-status.md](../site-status.md)). A map built by evasion is a legal and operational liability that disappears the moment the site notices. Merchant-opt-in crawling is the long-term answer, not better fingerprint spoofing.

## What made it faster, and what is still open?

Items 1–3 have landed since; item 4 remains open (see [roadmap](../roadmap.md)). Saying the open part on camera is a feature, not a confession.

1. **SQL top-k retrieval — done.** `find` uses the pgvector HNSW index plus a 60-second result cache (carparts ~35 ms).
2. **Hosted embeddings + reranker — provider done.** Nomic embeddings via an OpenAI-compatible endpoint; the reranker itself is still open.
3. **Sitemap-aware indexing — done.** The frontier seeds from sitemaps.
4. **An elastic crawl fleet (Modal) — open.** Scale-to-zero workers for burst re-indexing; a freshness fix, not a latency fix.

## What is the ultimate goal — and will we be replaced?

**Q: What is AgentMap ultimately trying to be?**
The shared navigation layer for agent commerce: the thing an agent consults *before* browsing, the way a human consults a map before driving. Crawling is a commodity input; the durable assets are (1) the versioned site graphs, (2) the feedback loop — every agent's success/failure report improving the map for the next agent, and (3) the trust/registry layer (verified agents, the Bureau trust score) that merchants can rely on when they decide how much access an agent gets. Maps can be re-crawled; a network of agents reporting outcomes and merchants opting in cannot be re-created from a standing start.

**Q: Won't foundation-model labs just build this in? Won't agents get good enough at raw browsing that a map is pointless?**
This is the real risk, and the honest answer has three parts:

- **Better browsing shrinks the gap, it does not close it.** A smarter agent still ingests the site's HTML; the map's answer is ~250 tokens against 80k–300k+ tokens of raw pages. Even if models get 10× cheaper per token, a 300× structural gap does not vanish — it gets *less decisive*, which is why token savings alone is not the moat.
- **If browsing becomes nearly free, the value moves up-stack — and we already built for that.** Verification (live price/stock, never stale), trust (which agents are reliable, which merchants opted in), and incentives ([COUPON-MINING.md](./COUPON-MINING.md)) matter *more*, not less, when navigation is cheap. A lab's built-in browser does not give a merchant an opt-in programme, an audit log, or a coupon network.
- **Being absorbed is a possible exit, not a refutation.** If a platform ships native site maps, the parts that survive acquisition or partnership are the merchant relationships, the outcome-feedback corpus, and the trust registry — the parts that cannot be scraped. The parts that would be replaced (a crawler, a vector index) are deliberately commodity in our stack.

**Q: What kills this project, honestly?**
Merchants deciding agents are a threat and walling everyone (we saw the preview: three flagship sites already do), or agents standardizing on a single platform's built-in browsing before a shared map reaches critical coverage. Both argue for the same response: merchant opt-in and incentives now, while crawling is still possible — which is exactly what the coupon thread is for.
