# Postgres setup (brief)

One Postgres 16 + pgvector holds the graph, vectors, registry, and events (plan D4).

## Enable it

Docker path (matches `docker-compose.yml`):

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://agentmap:agentmap@localhost:5432/agentmap
```

No-Docker path (this machine has neither `docker` nor `psql` right now):

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
createuser -s agentmap && createdb -U agentmap -O agentmap agentmap
```

Then apply migrations in order:

```bash
psql "$DATABASE_URL" -f packages/db/migrations/0001_core.sql
psql "$DATABASE_URL" -f packages/db/migrations/0002_registry_events_jobs.sql
psql "$DATABASE_URL" -f packages/db/migrations/0003_offers.sql
```

Point the server at it with `DATABASE_URL` in `.env` (see `.env.example`). Without it, `apps/mcp-server` falls back to `InMemoryStore`.

Verify: `curl localhost:8080/readyz` returns `{"ok":true}`.

## Why it benefits us

- Persistent map: `site` / `node` / `edge` / `path_cache` survive restarts (in-memory does not).
- Vector search: pgvector HNSW indexes power `find` embedding retrieval.
- Registry + keys: operators, agents, and API keys live in Postgres; `agentmap-admin issue-key` needs it.
- Events + Jobs: outcome/failure events, stale-marking, and index queue need it.
- Benchmarks: corpus runs and `report_outcome` learning only accumulate with a real DB.
