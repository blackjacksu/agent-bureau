# Demo setup — AgentMap 3-minute video

Everything needed to record [VIDEO-SCRIPT.md](./VIDEO-SCRIPT.md). Follow [RUNBOOK.md](./RUNBOOK.md) on the day. Demo site: **shadesoflight.com** (live-indexes in seconds, visual product category). Backup: **paulaschoice.com**. Do not live-index carparts.com on camera (7,475-node index, ~68 s — use it pre-indexed only).

Also here: [QA.md](./QA.md) (why it's designed this way, unbuilt performance work, will-we-be-replaced) and [COUPON-MINING.md](./COUPON-MINING.md) (the coupon-incentive highlight — separate topic, design-stage).

## 1. Prerequisites

- Node ≥ 20, pnpm 9 (`corepack enable` if pnpm is absent)
- Docker (for Postgres+pgvector) — or the local cluster in [../postgres-setup.md](../postgres-setup.md)
- Chromium for Playwright: `pnpm --filter @agentmap/indexer exec playwright install chromium`
- An MCP-capable agent for the on-camera client: Claude Code or Cursor

## 2. Build and database

```bash
pnpm install
pnpm -r build

# Option A: Docker Postgres (fresh state)
docker compose up -d postgres
export DATABASE_URL=postgres://agentmap:agentmap@localhost:5432/agentmap

# Option B: reuse the existing local cluster
export DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test

pnpm test   # sanity: 364 passed (expected with DATABASE_URL set)
```

## 3. Environment

```bash
export MCP_PORT=8080
export API_KEY_PEPPER=demo-pepper-change-me
# EMBEDDING_API_KEY=...   # optional; demo runs on the deterministic fallback
```

## 4. Start the MCP server (terminal 1)

```bash
DATABASE_URL=$DATABASE_URL MCP_PORT=8080 API_KEY_PEPPER=$API_KEY_PEPPER \
  pnpm --filter @agentmap/mcp-server start
curl -s localhost:8080/healthz   # {"ok":true}
```

## 5. Issue an API key (terminal 2)

```bash
DATABASE_URL=$DATABASE_URL API_KEY_PEPPER=$API_KEY_PEPPER \
  node apps/mcp-server/dist/cli.js issue-key --model demo-agent --tier free
# api_key=am_live_...  (shown once — copy it now)
```

## 6. Onboard the MCP in your agent

Claude Code:

```bash
claude mcp add agentmap --transport http http://localhost:8080/mcp \
  --header "Authorization: Bearer am_live_<key>"
```

Cursor / other Streamable-HTTP clients (`mcp.json`):

```json
{
  "mcpServers": {
    "agentmap": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer am_live_<key>" }
    }
  }
}
```

Verify in the agent: ask *"List the AgentMap tools"* — expect `is_mapped`, `find`, `get_path`, `live_check`, `report_outcome`, `request_mapping`, `my_sites` (7 tools; `find_offers` appears only with `OFFERS_ENABLED=true`, keep it off for the demo).

## 7. Start the indexer worker (terminal 3)

```bash
DATABASE_URL=$DATABASE_URL node apps/indexer/dist/index.js
```

Leave it running: when the agent calls `request_mapping`, the worker claims the job and crawls. To pre-check crawling without the agent:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.shadesoflight.com/robots.txt
```

## 8. Reset between takes

Re-recording the "first time" beat needs an unmapped domain. Either pick a fresh backup domain, or clear the demo domain's map (staging/local DB only):

```bash
psql "$DATABASE_URL" -c "UPDATE site SET status='queued', map_version=0 WHERE domain='shadesoflight.com'; DELETE FROM node WHERE domain='shadesoflight.com'; DELETE FROM edge WHERE domain='shadesoflight.com'; DELETE FROM path_cache WHERE domain='shadesoflight.com';"
```

## 9. Pre-flight checklist

- [ ] `pnpm test` green, server healthy, 7 tools listed in the agent
- [ ] Indexer worker running; demo domain reset to unmapped (for take 1)
- [ ] One pre-indexed domain ready (paulaschoice.com) in case live indexing stalls
- [ ] Benchmark report open in a tab: [../bench/2026-11-02-speed.md](../bench/2026-11-02-speed.md)
- [ ] Screen recording at 1080p+, terminal font ≥16pt, notifications off
