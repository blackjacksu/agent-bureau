# Live demo rehearsal script — the cache talk (~60 seconds)

Read this verbatim while the [flow graphic](./flow.svg) and the README
benchmark table are on screen. Numbers match
[2026-11-02-speed](../bench/2026-11-02-speed.md) and
[2026-11-04-speed](../bench/2026-11-04-speed.md); token counts are
`ceil(chars/4)`, so quote them as "~250 vs ~80k+", never as exact.

## The paragraph

> "Every personal agent shops the same way today: it opens the store in a
> browser, downloads the search page, the category, the filters, the product
> pages — eighty thousand to three hundred thousand tokens — and then it
> forgets everything. The next agent, the next task, pays full price again.
> AgentMap is a CPU cache for that problem. We crawl each merchant once and
> keep the navigation graph: how search works, where the categories are, what
> the URLs look like. Every later agent gets a cache hit — about 250 tokens
> in about 10 milliseconds — instead of re-reading DRAM. And like a real
> cache, we never cache what is volatile: prices and stock are always read
> live, the way a core does an uncacheable read of a device register. Each
> answer reports back success or failure, so the map self-heals the way a
> coherence protocol heals stale lines."

## Stats to land (pick two, then stop)

- Per product search today: **~83k tokens** (optimized crawler) to **~313k
  tokens** (naive browser walk), 52–55% success, ~200–300 ms cold.
- Same task through the map: **~250 tokens**, ~8–16 ms warm, 68–77% success.
- Gap: roughly **300–1,200x fewer tokens** per query.
- Era math: 1M agent shopping tasks/day × 300k tokens ≈ 300B tokens/day of
  re-read HTML. Through the map that is ~250M — the crawl cost is paid once
  per site (e.g. ~68 s for a 7,475-node index) and amortized over every later
  query.

## Analogy cheat-sheet (for hardware questions)

| CPU | AgentMap |
| --- | --- |
| Core | Personal shopping agent |
| L1 cache / TLB | Versioned site graph — caches the *route*, like a TLB caches translation, not data |
| DRAM | Raw merchant site (slow to walk every time) |
| Cache fill | `request_mapping` → one polite crawl per site |
| Uncacheable MMIO read | `live_check` — price/stock always verified live |
| Coherence / invalidation | `report_outcome` — failures mark edges stale, map re-indexes |

## Demo beats (2 minutes after the talk)

1. `is_mapped` on an unmapped domain → `false`. Miss.
2. `request_mapping` → watch the indexer fill the cache (time-lapse).
3. Same question via `find` → ~250-token path in milliseconds. Hit.
4. `live_check` on the product URL → price confirmed live, never from cache.
