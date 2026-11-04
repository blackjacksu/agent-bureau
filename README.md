# AgentMap — Agent L1

**Crawl once, share the map.** AgentMap is a hosted [Model Context Protocol (MCP)](https://modelcontextprotocol.io) service that pre-maps merchant websites into a navigation graph, so a personal AI agent can answer *"find brake pads for a 2019 Civic on this store"* with a compact, verified path — instead of raw-browsing the whole site again on every task.

Raw browsing is what personal agents do today (see [Research](#research-how-personal-agents-use-websites-today)): open a browser, read screenshots/DOM/HTML, guess the next click, repeat. That costs 10⁴–10⁵ tokens per page and fails often. AgentMap pays the crawl cost **once**, stores *how the site works* (categories, search, filters, URL templates — never cached prices), and serves every later agent a ~250-token answer in milliseconds. Prices and stock are always re-checked live.

| Per product search | Raw agent browsing | Via AgentMap |
| --- | --- | --- |
| Tokens | ~83k–313k | ~250 |
| Time | ~200–300 ms cold | ~8–16 ms |
| Success | 52–55% | 68–77% |

Measured on 60 real shopping tasks — full report: [docs/bench/2026-11-04-speed.md](docs/bench/2026-11-04-speed.md). Token counts are `ceil(chars/4)` estimates, so read them as "~250 vs ~80k+".

> Status: working Phase-0 prototype. 3 live-indexed sites, 387 tests passing, benchmarked against naive and optimized crawlers. Not production-hosted yet.

![AgentMap flow: crawl once, share the map — the L1 cache for agent commerce](docs/demo/flow.svg)

Rehearsing a demo? See the [60-second cache talk](docs/demo/LIVE-DEMO-SCRIPT.md).

## Quick start (local)

Prerequisites: Node ≥ 20, pnpm 9, Docker (or any Postgres 16+ with pgvector), Chromium for Playwright.

```bash
pnpm install
pnpm -r build

docker compose up -d postgres                       # Postgres + pgvector on :5432
export DATABASE_URL=postgres://agentmap:agentmap@localhost:5432/agentmap

pnpm test                                           # builds, then runs the full suite (387 tests)

# Terminal 1 — MCP server (http://localhost:8080)
DATABASE_URL=$DATABASE_URL MCP_PORT=8080 API_KEY_PEPPER=change-me \
  pnpm --filter @agentmap/mcp-server start

# Terminal 2 — indexer worker (claims mapping jobs and crawls)
DATABASE_URL=$DATABASE_URL node apps/indexer/dist/index.js
```

Health check: `curl -s localhost:8080/healthz` → `{"ok":true}`. Operator dashboard: <http://localhost:8080/dashboard> (walkthrough below).

## Development

```bash
pnpm -r build && pnpm -r typecheck     # strict tsc is the lint gate
DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test pnpm test   # 387 passed
node scripts/offers-grep-gate.mjs      # coupon red-line gate (no private/leaked codes)
```

Local Postgres without Docker: [docs/postgres-setup.md](docs/postgres-setup.md). CI (`.github/workflows/ci.yml`) runs typecheck, build, tests, coverage, and the offers gate against a pgvector service.

## Connect an AI agent to the MCP server

**1. Issue an API key** (operator side):

```bash
DATABASE_URL=$DATABASE_URL API_KEY_PEPPER=change-me \
  node apps/mcp-server/dist/cli.js issue-key --model my-agent --tier free
# api_key=am_live_…   (shown once — store it in the agent's secret config, never commit it)
```

Registration is also available over REST (`POST /api/v1/operators`, `POST /api/v1/agents`, `POST /api/v1/agents/:id/keys`); keys can be revoked the same way. Every key is hashed at rest and maps to one registered agent, which is what makes per-agent usage, feedback, and trust scoring possible.

**2. Register the server in the agent** — Claude Code:

```bash
claude mcp add agentmap --transport http http://localhost:8080/mcp \
  --header "Authorization: Bearer am_live_<key>"
```

Cursor / any Streamable-HTTP MCP client (`mcp.json`):

```json
{ "mcpServers": { "agentmap": {
  "url": "http://localhost:8080/mcp",
  "headers": { "Authorization": "Bearer am_live_<key>" } } } }
```

**3. Tools the agent gets:**

| Tool | What it does |
| --- | --- |
| `is_mapped` | Is this domain already mapped, and at what version? |
| `find` | Natural-language question → navigation steps + result URL (~250 tokens) |
| `get_path` | Step-by-step path to a goal node in the graph |
| `live_check` | Re-verify price/stock on a live page (never served from the map) |
| `report_outcome` | Agent reports success/failure — this is how the map self-heals |
| `request_mapping` | Ask for an unmapped site to be crawled and indexed |
| `my_sites` | List/inspect sites this agent has used |

REST mirrors exist under `/api/v1/*` (e.g. `POST /api/v1/find`) for non-MCP clients and for the dashboard.

**Try it:**

```bash
curl -s localhost:8080/api/v1/is-mapped?domain=shadesoflight.com -H "Authorization: Bearer am_live_<key>"
curl -s localhost:8080/api/v1/find -H "Authorization: Bearer am_live_<key>" \
  -H 'content-type: application/json' \
  -d '{"domain":"shadesoflight.com","question":"chandeliers for a dining room"}'
```

## Dashboard: showcase index, performance, and live agent calls

Open <http://localhost:8080/dashboard> with the server running. The dashboard never runs calls itself — call from your agent, watch the results land here:

1. **Credentials** — paste your `am_live_…` key (kept only in that browser tab). It unlocks the live call feed.
2. **Index** — sites mapped/queued, nodes and edges indexed, and whether the `node_embedding_hnsw` / `path_cache_embedding_hnsw` vector indexes exist.
3. **Recent calls** — which agent called, which tool, what the MCP returned (e.g. `found, 3 steps`), latency, and status. Auto-refreshes every 5 seconds.
4. **Performance** — per-tool calls, errors, average and p95 latency since this process started. A mapped `find` should be milliseconds; the first crawl is the slow, one-time cost.
5. **Merchant Dashboard** (admin token) — per-domain agent demand and journeys: which sites agents ask about most, i.e. where mapping pays off next.

To quantify the difference on a site, run the benchmark the same way we did: same tasks through raw crawl vs the MCP — `pnpm --filter @agentmap/bench bench:speed` (needs `MCP_BASE_URL` + `AGENTMAP_API_KEY`). Method and full results: [docs/bench/2026-11-02-speed.md](docs/bench/2026-11-02-speed.md).

## Benchmark (measured, not projected)

Same 60 real shopping tasks, same judge, four arms — full report in [docs/bench/](docs/bench/2026-11-02-speed.md):

| Arm | Success | Median time | Median tokens/task |
| --- | --- | --- | --- |
| **MCP `find` (AgentMap)** | **77–98%** | **16 ms** | **~250** |
| Optimized crawl (sitemap/search jumps) | 52% | 1 ms warm / 299 ms cold | ~83k |
| Naive crawl (link-walk) | 55% | 199 ms | ~313k |

Honest caveats: token counts use `ceil(chars/4)`, not a production tokenizer — quote "~250 tokens vs 80k+ tokens of raw HTML", not a percentage. Crawling still wins on brand-new sites, where no map exists (and that crawl is how new maps get built). Fixed since: retrieval now uses the pgvector index — carparts `find` is ~35 ms (see [2026-11-04-speed](docs/bench/2026-11-04-speed.md)).

## Tested domains

| Domain | Category | Map | Result (20 tasks each) |
| --- | --- | --- | --- |
| carparts.com | Auto parts | v2, 7,475 nodes | 20/20 found, 18/20 exact target |
| shadesoflight.com | Home / lighting | v1, 233 nodes | 20/20 found, 15/20 exact target |
| paulaschoice.com | Skincare | v1 | 19/20 found, 13/20 exact target |
| rockauto.com, fergusonhome.com, dermstore.com (+ others) | — | — | `blocked: bot_protection` — recorded honestly, no evasion attempted |

Site-selection history: [docs/adr/0001-prototype-sites.md](docs/adr/0001-prototype-sites.md) → [docs/adr/0003-prototype-site-substitution.md](docs/adr/0003-prototype-site-substitution.md) (owner-approved). Living per-site record: [docs/site-status.md](docs/site-status.md).

## Research: how personal agents use websites today

Why a shared map beats per-agent browsing:

1. **Search-then-fetch** costs 10⁴–10⁵ tokens per page in navigation boilerplate, repeated on every task with no memory shared between agents.
2. **API/connectors** rarely exist for merchant sites, and each integration is bespoke.
3. **Browser/computer use** costs thousands of tokens per step, breaks on layout changes and bot walls, and forgets everything when the session ends.

More: [docs/demo/QA.md](docs/demo/QA.md) (design rationale, unbuilt optimizations, will-this-be-replaced), [docs/demo/VIDEO-SCRIPT.md](docs/demo/VIDEO-SCRIPT.md) (3-minute demo), [docs/roadmap.md](docs/roadmap.md) (what remains).

## Future (optional): coupons

Coupon support exists only as a dark seam (`find_offers`, off by default). The hunter sweep worker, incentive ledger, and merchant dashboard are not built — they wait on owner pricing/sharing decisions (see [roadmap](docs/roadmap.md)). Details: [Coupon mining](docs/demo/COUPON-MINING.md).

## License / data policy

Prototype — no license granted yet. Crawling policy: robots.txt respected, per-domain rate limits, merchant opt-out honoured before any offers are served, no personal shopper data stored, no bot-wall evasion. Plain-language draft: [docs/data-policy.md](docs/data-policy.md).
