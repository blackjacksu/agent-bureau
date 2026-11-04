# AgentMap — Agent Bureau

**Crawl once, share the map.** AgentMap is a hosted [Model Context Protocol (MCP)](https://modelcontextprotocol.io) service that pre-maps merchant websites into a navigation graph, so a personal AI agent can answer *"find brake pads for a 2019 Civic on this store"* with a compact, verified path — instead of raw-browsing the whole site again on every task.

Raw browsing is what personal agents do today (see [Research](#research-how-personal-agents-use-websites-today)): open a browser, read screenshots/DOM/HTML, guess the next click, repeat. That costs 10⁴–10⁵ tokens per page and fails often. AgentMap pays the crawl cost **once**, stores *how the site works* (categories, search, filters, URL templates — never cached prices), and serves every later agent a ~250-token answer in milliseconds. Prices and stock are always re-checked live.

> Status: working Phase-0 prototype. 3 live-indexed sites, 364 tests passing, benchmarked against naive and optimized crawlers. Not production-hosted yet — see [Hosting](#hosting-can-you-run-this-on-github-or-baseten).

## Quick start (local)

Prerequisites: Node ≥ 20, pnpm 9, Docker (or any Postgres 16+ with pgvector), Chromium for Playwright.

```bash
pnpm install
pnpm -r build

docker compose up -d postgres                       # Postgres + pgvector on :5432
export DATABASE_URL=postgres://agentmap:agentmap@localhost:5432/agentmap

pnpm test                                           # builds, then runs the full suite (364 tests)

# Terminal 1 — MCP server (http://localhost:8080)
DATABASE_URL=$DATABASE_URL MCP_PORT=8080 API_KEY_PEPPER=change-me \
  pnpm --filter @agentmap/mcp-server start

# Terminal 2 — indexer worker (claims mapping jobs and crawls)
DATABASE_URL=$DATABASE_URL node apps/indexer/dist/index.js
```

Health check: `curl -s localhost:8080/healthz` → `{"ok":true}`. Operator dashboard: <http://localhost:8080/dashboard> (walkthrough below).

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
| `find_offers` | *(flag-gated, off by default)* Public/merchant coupons — see [Coupon mining](docs/demo/COUPON-MINING.md) |

REST mirrors exist under `/api/v1/*` (e.g. `POST /api/v1/find`) for non-MCP clients and for the dashboard.

**Try it:**

```bash
curl -s localhost:8080/api/v1/is-mapped?domain=shadesoflight.com -H "Authorization: Bearer am_live_<key>"
curl -s localhost:8080/api/v1/find -H "Authorization: Bearer am_live_<key>" \
  -H 'content-type: application/json' \
  -d '{"domain":"shadesoflight.com","question":"chandeliers for a dining room"}'
```

## Dashboard: check whether mapping a site makes a difference

Open <http://localhost:8080/dashboard> with the server running:

1. **Credentials** — paste your `am_live_…` key (kept only in that browser tab).
2. **Index a website** — type a domain (e.g. `paulaschoice.com`), click **Request mapping**, then **Check is_mapped**. First mapping takes seconds-to-minutes (the indexer is crawling); once `mapped: true` with a `map_version`, the site is queryable. This is the *"domain input"* for testing a new site.
3. **Call explorer** — pick `find`, edit the JSON (domain + shopping question), **Send**. Compare the compact steps/URL you get back against opening that site raw in a browser agent.
4. **Recent calls / Performance** — every call you just made, with latency and per-tool p95. A mapped `find` should be milliseconds; the first crawl is the slow, one-time cost.
5. **Merchant Dashboard** (admin token) — per-domain agent demand and journeys: which sites agents ask about most, i.e. where mapping pays off next.

To quantify the difference on a site, run the benchmark the same way we did: same tasks through raw crawl vs the MCP — `pnpm --filter @agentmap/bench bench:speed` (needs `MCP_BASE_URL` + `AGENTMAP_API_KEY`). Method and full results: [docs/bench/2026-11-02-speed.md](docs/bench/2026-11-02-speed.md).

## Benchmark (measured, not projected)

Same 60 real shopping tasks, same judge, four arms — full report in [docs/bench/](docs/bench/2026-11-02-speed.md):

| Arm | Success | Median time | Median tokens/task |
| --- | --- | --- | --- |
| **MCP `find` (AgentMap)** | **77–98%** | **16 ms** | **~250** |
| Optimized crawl (sitemap/search jumps) | 52% | 1 ms warm / 299 ms cold | ~83k |
| Naive crawl (link-walk) | 55% | 199 ms | ~313k |

Honest caveats: token counts use `ceil(chars/4)`, not a production tokenizer, and no live LLM browsing agent has been run as an arm yet — so quote "~250 tokens vs 80k+ tokens of raw HTML", not a precise percentage. Crawling still wins where it should: brand-new sites, where no map exists — and that crawl is exactly how a new map gets built. Known flaw, in the open: on the largest graph (carparts.com, 7,475 nodes) `find` takes ~450 ms because retrieval loads the full graph per query instead of using the pgvector index. Fix is specced in [doc/NEXT-STEP-BRIEF.md](doc/NEXT-STEP-BRIEF.md).

## Tested domains

| Domain | Category | Map | Result (20 tasks each) |
| --- | --- | --- | --- |
| carparts.com | Auto parts | v2, 7,475 nodes | 20/20 found, 18/20 exact target |
| shadesoflight.com | Home / lighting | v1, 233 nodes | 20/20 found, 15/20 exact target |
| paulaschoice.com | Skincare | v1 | 19/20 found, 13/20 exact target |
| rockauto.com, fergusonhome.com, dermstore.com (+ others) | — | — | `blocked: bot_protection` — recorded honestly, no evasion attempted |

Site-selection history: [docs/adr/0001-prototype-sites.md](docs/adr/0001-prototype-sites.md) → [docs/adr/0003-prototype-site-substitution.md](docs/adr/0003-prototype-site-substitution.md) (owner-approved). Living per-site record: [docs/site-status.md](docs/site-status.md).

## Hosting: can you run this on GitHub or Baseten?

**GitHub — no (for the server).** This repo lives on GitHub, and GitHub Actions runs CI, but GitHub offers no long-lived server runtime: Pages is static-only, Actions jobs are ephemeral, Codespaces is a dev environment. An MCP server must be a persistent HTTPS process with a database next to it.

**Baseten — wrong tool.** Baseten serves *custom ML models on dedicated GPUs*. The MCP server is a Node/Postgres web service with no GPU workload; hosting it there would be expensive and unsupported. Baseten becomes relevant only if we later fine-tune our own ranker/extractor model.

**What fits, in order of effort:**

| Option | Use it for | Notes |
| --- | --- | --- |
| Fly.io / Railway / Render | MCP server (Node process) | Persistent HTTPS, WebSockets/Streamable HTTP, minutes to deploy |
| Neon / Supabase | Managed Postgres + pgvector | Matches the local `docker-compose.yml` stack |
| Modal | Indexer/verifier crawl workers | Scale-to-zero Playwright containers, scheduled sweeps — the bursty part |
| Fireworks | Hosted embeddings + reranking | OpenAI-compatible; adapter already in `packages/matching/src/embeddings.ts` |

Recommended first production shape: server on Fly.io/Railway + Neon Postgres; indexer on Modal when crawl volume demands it. Details and vendor rationale: [doc/NEXT-STEP-BRIEF.md](doc/NEXT-STEP-BRIEF.md) §8.

## Research: how personal agents use websites today

AgentMap exists because of how personal agents (ChatGPT Agent/Operator-style computer use, Anthropic computer use, Perplexity Comet, Meta Muse, open-source Browser Use/Stagehand-style runtimes) currently get things done on the web:

1. **Search-then-fetch.** The agent searches, fetches pages as text/HTML, and reasons over the dump. Cheap per call, but a single e-commerce page is 10⁴–10⁵ tokens of mostly navigation boilerplate, and the agent repeats this on *every* task, *every* session, with no memory shared between agents.
2. **API/connectors where they exist.** Great when a merchant offers one — most don't, and each integration is bespoke. This is the gap MCP fills as a standard tool interface.
3. **Browser / computer use.** The agent drives a real browser: screenshot or DOM/accessibility tree in, click/type/scroll out, loop. Most general, most expensive: thousands of tokens per step, brittle to layout changes, popups, and bot walls, and the "knowledge" of how a site works dies with the session.

Sources: [browser-agent landscape survey (2026)](https://www.taskade.com/blog/browser-agents-explained), [computer-use agent comparison](https://clients.nbrain.ai/ai-agent-comparison-march-2026.html), [Perplexity Comet computer control](https://startuppedia.in/trending/computer-can-now-take-full-control-of-comet-to-complete-tasks-perplexity-ai-announces-major-upgrade-11221681), [webMCP paper — page-processing cost of current agents](https://arxiv.org/pdf/2508.09171).

**Where AgentMap targets:** agent *commerce* — personal agents shopping on merchant sites that have no API and no MCP of their own. The improvement is structural, not a better scraper: (a) crawl once, share the graph with every agent; (b) answer from the graph in ~250 tokens; (c) verify price/stock live; (d) feed every agent's outcome back so the map improves with use; (e) give merchants an opt-in, auditable channel (including [coupon mining](docs/demo/COUPON-MINING.md)) instead of an arms race against bots. Deliberately out of scope, permanently: checkout, payments, carts, and account actions.

More: [docs/demo/QA.md](docs/demo/QA.md) (design rationale, unbuilt optimizations, will-this-be-replaced), [docs/demo/VIDEO-SCRIPT.md](docs/demo/VIDEO-SCRIPT.md) (3-minute demo), [doc/plan.md](doc/plan.md) (full implementation plan), [docs/OPEN-ITEMS.md](docs/OPEN-ITEMS.md) (status and open decisions).

## Repository layout

```
apps/mcp-server/   Hosted MCP server, REST mirror, registry, dashboard
apps/indexer/      Playwright crawler → site graph builder/publisher
apps/verifier/     Live price/stock verification (SSRF-guarded)
packages/contracts/  Zod contracts — the single shared tool interface
packages/db/         Postgres + pgvector schema, queue, graph store
packages/matching/   Retrieval + ranking (embeddings, lexical blend)
packages/offers/     Coupon/offer seam (flag-gated, dark by default)
tools/bench/         4-arm speed benchmark (raw vs optimized crawl vs browser vs MCP)
docs/                ADRs, benchmarks, site status, demo pack
doc/plan.md          The detailed implementation plan
```

## Development

```bash
pnpm -r build && pnpm -r typecheck     # strict tsc is the lint gate
DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test pnpm test   # 364 passed
node scripts/offers-grep-gate.mjs      # coupon red-line gate (no private/leaked codes)
```

Local Postgres without Docker: [docs/postgres-setup.md](docs/postgres-setup.md). CI (`.github/workflows/ci.yml`) runs typecheck, build, tests, coverage, and the offers gate against a pgvector service.

## License / data policy

Prototype — no license granted yet. Crawling policy: robots.txt respected, per-domain rate limits, merchant opt-out honoured before any offers are served, no personal shopper data stored, no bot-wall evasion. Plain-language draft: [docs/data-policy.md](docs/data-policy.md).
