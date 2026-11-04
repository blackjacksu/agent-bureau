# AgentMap — Detailed Implementation Plan

**Status:** Draft v0.2 · **Date:** 2026-11-02 · **Owner:** Willy
**Source spec:** [agentmap-proposal-and-spec.md](/Users/willytwsu/Documents/agent-bureau/agentmap-proposal-and-spec.md:1) (Proposal + Design Spec v0.1, §§1–23)
**Supersedes in detail:** the inline Phase 0 plan agreed 2026-11-02 (TypeScript first, hosted MCP, benchmark-first). This file expands it to implementable detail.
**How to use this file:** §2 locks decisions. §§3–15 specify what to build. §16 specifies coupon expansion room. §§17–19 specify testing and validation. §20 sequences the work. §§21–23 govern coordination, risks, and open decisions. Do not start a step until its entry criteria are met; do not call a step done until its exit validation in §19 passes.

---

## 1. Goal and success definition

### 1.1 Goal

Build Phase 0–1 of AgentMap: a hosted, shared, pre-built map of how to use websites, served to AI agents over MCP (spec §1). The first agent to need a site pays the discovery cost; every later agent gets a short, cheap, fast answer (§10–§13).

### 1.2 Success criteria (Phase 0 exit — all required)

| ID | Criterion | Measured by |
| --- | --- | --- |
| S1 | `is_mapped`, `find`, `get_path`, `live_check`, `report_outcome`, `request_mapping`, `my_sites` all live over hosted MCP | §19.4 E2E suite green |
| S2 | 3–5 sites mapped deeply, ~20 realistic tasks each (§20 of spec) | Benchmark corpus in repo (`tools/bench/corpus/`) |
| S3 | Warm-map runs 2–5 beat raw browsing on tokens and time, accuracy ≥ parity (spec G1–G3) | §18 benchmark report committed to `docs/bench/` |
| S4 | Every path use emits an Event; failures mark branches stale with no manual step (§14) | §19.4 broken-path E2E |
| S5 | No shopper personal data stored anywhere; robots-disallowed sites never mapped (§17) | §19.6 compliance checks |
| S6 | Coupon extension seam exists and is dark-launched (types + flag + empty provider), returning nothing in Phase 0 | §16.6 acceptance checks |

### 1.3 Non-goals (Phase 0–1, from spec §6 plus this plan)

- No cached price/stock served as truth. Price/stock are always live-checked (§14).
- No checkout, no payments, no inventory, no acting as retailer.
- No storing shopper personal data: names, addresses, logins, order history, payment details.
- No mapping of sites that forbid crawling (robots.txt is the default rule, §17).
- No live coupon redemption, no affiliate-link rewriting, no private/leaked code sourcing in Phase 0–1. Coupon work in Phase 0 is seam-only (§16).
- No merchant dashboard (Phase 3) and no Bureau trust scoring (Phase 4), beyond the groundwork in §12–§13 of this plan.
- No Rust in Phase 0–1 (see §2.2 for the extraction triggers that would change this).

---

## 2. Locked decisions

These were settled with the owner on 2026-11-02. Changing any of them requires an ADR (§21.4) and a plan revision, not a silent code change.

### 2.1 Decision table

| ID | Decision | Choice | Rejected alternative and why |
| --- | --- | --- | --- |
| D1 | Language / runtime | TypeScript on Node.js (LTS) everywhere in Phase 0–1 | Rust everywhere: best perf, but Phase 0 bottleneck is iteration on messy per-site extraction, not CPU. Python first: strong embeddings story, weaker MCP + browser ergonomics. |
| D2 | MCP transport | Remote hosted Streamable HTTP, single `/mcp` endpoint (POST + GET), per MCP spec 2025-03-26 | Local stdio only: fragments maps and event log per user, undercutting the shared-map thesis (spec G4, §9). |
| D3 | Phase 0 scope shape | Benchmark-first: 3–5 sites deep, ~20 tasks each | Breadth-first: weaker benchmark story, more breakage surface before value is proven. |
| D4 | Primary store | One PostgreSQL + pgvector for graph, vectors, registry, events | Separate vector DB: extra system before scale justifies it; graph + vectors + events need joins. |
| D5 | Browser automation | Playwright (Chromium first) for Indexer and Live Verifier | Raw HTTP fetching: fails on JS-rendered retail sites, which are the target set. |
| D6 | Contract discipline | Zod schemas in `packages/contracts` are the single source of truth for every MCP/REST payload | Hand-written types per app: drift between server, indexer, and bench is the top integration risk. |
| D7 | Coupon posture | Seam now, product later; only public or merchant-provided offers; full provenance and disclosure (§16) | Honey-style silent affiliate/code behaviour: spec §8 documents the trust collapse that followed. AgentMap's merchant side (Phase 3) dies if merchants suspect this. |

### 2.2 Rust revisit triggers (do not pre-build for these)

Extract a component to Rust only when a profile names it, in this order:

1. **Indexer CPU saturation** — sustained crawl workers CPU-bound (not network/browser-bound) at agreed crawl volume.
2. **Live Verifier latency** — p95 live-check latency dominated by our code, not target-site latency, at production QPS.
3. **Query serving p99** — MCP `find` p99 dominated by in-process matching rather than DB/embedding calls.

The seams that keep extraction cheap are mandatory from day one (§3.3): Indexer and Verifier sit behind queue + HTTP boundaries with JSON payloads defined in `packages/contracts`. No Indexer internals imported into the MCP server. If that boundary erodes, the Rust option erodes with it — treat boundary violations as bugs in review.

### 2.3 Reversible defaults (changeable without ADR, note in PR description)

| ID | Default | Change when |
| --- | --- | --- |
| R1 | Postgres-backed job queue (no Redis in Phase 0) | Queue depth/latency metrics show polling contention; then move to Redis/BullMQ behind the same job payloads |
| R2 | Hosted embedding API for Node/Path embeddings | Cost or latency at re-index volume justifies self-hosting; embedding model change always needs re-index plan (§6.4) |
| R3 | Stateless MCP request handling; session state (if needed) in Postgres | MCP client behaviour proves long-lived sessions are required |
| R4 | Chromium only | A target site requires WebKit/Firefox fingerprinting (log ADR if this becomes permanent) |
| R5 | Monorepo with pnpm workspaces | Team or deploy friction proves otherwise |

---

## 3. System architecture

### 3.1 Runtime topology

```text
                        ┌─────────────────────────────────────────────────┐
  Agent (any lab)       │  AgentMap hosted service                        │
  ── MCP (HTTPS) ──────▶│  ┌───────────────────────────────────────────┐  │
                        │  │ apps/mcp-server                            │  │
  Agent builder         │  │  POST/GET /mcp  (Streamable HTTP)          │  │
  ── REST (HTTPS) ─────▶│  │  /api/v1/*      (REST mirror, §9.3)       │  │
                        │  │  auth → rate limit → tool router → audit  │  │
                        │  └──────┬───────────────┬─────────────┬─────┘  │
                        │         │               │             │        │
                        │   Query/Matching   Feedback      Registry     │
                        │   (§8)             intake (§10)  (§12)        │
                        │         │               │             │        │
                        │  ┌──────▼───────────────▼─────────────▼─────┐  │
                        │  │ PostgreSQL + pgvector (§6)               │  │
                        │  │ map graph · path cache · agents · events │  │
                        │  │ job queue · offers (dark, §16)           │  │
                        │  └──────▲──────────────────────┬────────────┘  │
                        │         │ graph writes         │ live jobs    │
                        │  ┌──────┴──────────┐    ┌──────▼──────────┐   │
                        │  │ apps/indexer    │    │ apps/verifier   │   │
                        │  │ Playwright pool │    │ Playwright/fetch│   │
                        │  │ (§7)            │    │ (§9)            │   │
                        │  └─────────────────┘    └─────────────────┘   │
                        └─────────────────────────────────────────────────┘
                                       │
                        Phase 3: merchant dashboard reads events + demand
                        Phase 4: Bureau scoring reads events + registry
```

### 3.2 Deployables

| Deployable | Process model | Scaling unit | Phase |
| --- | --- | --- | --- |
| `apps/mcp-server` | Stateless HTTP server, multiple replicas behind load balancer | Replica count by QPS | 0 |
| `apps/indexer` | Queue worker pool; one browser context per job, bounded concurrency per domain | Worker count + per-domain caps (§7.6) | 0 |
| `apps/verifier` | Queue worker + synchronous fast path for single-page checks (§10.2) | Worker count | 0 (basic) / 1 (full) |
| `tools/bench` | CLI / CI job, not a service | n/a | 0 |

### 3.3 Boundary rules (enforced in review, lint where possible)

1. `apps/mcp-server` never imports from `apps/indexer` or `apps/verifier` source. It enqueues jobs and reads Postgres only.
2. `apps/indexer` and `apps/verifier` never serve agent traffic. They consume job payloads validated by `packages/contracts` schemas.
3. All cross-boundary payloads (jobs, graph writes, verify results, events) are Zod-validated on both produce and consume sides in Phase 0; relax consume-side only with a perf ADR.
4. `packages/matching` is a library used by `apps/mcp-server`; it must stay free of HTTP and Playwright imports so it can move with the server or be extracted later.
5. Coupon code (§16) lives behind the offers boundary: `packages/offers` interface, `apps/mcp-server` calls it, Indexer does not write offers in Phase 0–1.

### 3.4 Request lifecycle (mapped-site `find`, the money path)

1. Agent sends MCP `tools/call find { domain, question }` to `POST /mcp` with `Authorization: Bearer <api_key>`.
2. Auth middleware resolves key → `agent_id`, `operator_id`, `tier`, `verified` (§12). Unknown/revoked key → MCP error `-32001` shape in §9.4, no tool execution, Event type `auth_rejected` (no question text stored beyond hash, §13.3).
3. Rate limiter checks tier budget (§12.5). Over budget → `rate_limited` error with `retry_after_ms`.
4. Query service normalizes domain (lowercase, strip `www.`, IDNA), checks Site status. Not `mapped` → returns `{ mapped: false, queue_position? }` and records demand (§8.6).
5. Matching (§8): PathCache lookup → Node retrieval → path composition → parameter binding. Produces `steps[]`, `result_url_template`, `needs_live_check[]`, `path_id`, `confidence`.
6. If `confidence < abstain_threshold` (§8.7): return `{ mapped: true, found: false, reason: "low_confidence" }` rather than a guessed path. A confident wrong path is worse than no path.
7. Offers hook (§16.4): if `offers` feature flag on for this agent's tier and domain has eligible offers, attach `offers[]` (empty in Phase 0). Hook must not add >5 ms p95; on timeout/error, return path without offers and log `offers_hook_failed`. Offers never block or fail the core answer.
8. Event `query` + `path_used` written (async, buffered, §13). Response returned. Target: p95 < 300 ms excluding live check (validate §19.5).
9. Agent follows steps or opens result URL, calls `live_check`, then `report_outcome` (§10 closes the loop).

### 3.5 Environments

| Env | Data | Indexer | Used for |
| --- | --- | --- | --- |
| `local` | Seeded mini-graphs (2 fixture sites, §17.3), ephemeral Postgres | Manual, fixture sites only | Dev, unit/integration tests |
| `staging` | The real 3–5 prototype sites, re-indexed on demand | Full, rate-limited | E2E, benchmark dry runs, demos |
| `prod` | Same sites + demand-driven additions | Scheduled + feedback-triggered | Agent traffic |

Promotion rule: Indexer or Matching changes must post staging benchmark deltas (§18) before prod deploy. Contracts changes must deploy server and workers in the same release window (§21.3).

---

## 4. Repository layout

```text
agent-bureau/
├── plan.md                          # this file
├── agentmap-proposal-and-spec.md    # source spec v0.1 (do not edit without owner review)
├── README.md
├── package.json                     # pnpm workspace root; scripts: build, test, bench, dev
├── pnpm-workspace.yaml
├── tsconfig.base.json               # strict TS for all packages
├── docker-compose.yml               # postgres+pgvector, (redis only if R1 flips)
├── .env.example                     # every var in §5, no real secrets
├── apps/
│   ├── mcp-server/
│   │   ├── src/
│   │   │   ├── index.ts             # entry: HTTP server, graceful shutdown
│   │   │   ├── transport.ts         # Streamable HTTP wiring (SDK), Origin validation
│   │   │   ├── tools/               # one file per MCP tool: is-mapped.ts, find.ts, …
│   │   │   ├── rest/                # REST mirror handlers (share services, §9.3)
│   │   │   ├── middleware/          # auth.ts, rate-limit.ts, audit.ts, errors.ts
│   │   │   └── services/            # query-service.ts, feedback-service.ts, registry-service.ts
│   │   ├── test/                    # unit + integration (§17)
│   │   └── package.json
│   ├── indexer/
│   │   ├── src/
│   │   │   ├── index.ts             # worker entry: poll queue, dispatch jobs
│   │   │   ├── jobs/                # index-domain.ts, reindex-branch.ts, sweep-stale.ts
│   │   │   ├── crawl/               # browser-pool.ts, robots.ts, frontier.ts, politeness.ts
│   │   │   ├── discover/            # nav.ts, search.ts, filters.ts, product.ts (per-kind)
│   │   │   ├── emit/                # graph-builder.ts, selector-rank.ts, url-template.ts
│   │   │   └── sites/               # per-site configs: <domain>.ts (§7.8)
│   │   ├── test/
│   │   └── package.json
│   └── verifier/
│       ├── src/
│       │   ├── index.ts
│       │   ├── extract/             # price.ts, stock.ts, status.ts (normalizers, §9)
│       │   └── fetch/               # http-fetch.ts, browser-fetch.ts, cache.ts
│       ├── test/
│       └── package.json
├── packages/
│   ├── contracts/                   # Zod schemas + inferred types; THE shared surface (§10)
│   │   ├── src/tools.ts  graph.ts  events.ts  jobs.ts  offers.ts  errors.ts
│   │   └── test/
│   ├── matching/                    # retrieval, param extraction, path composition (§8)
│   │   ├── src/retrieve.ts  params.ts  compose.ts  confidence.ts  index.ts
│   │   └── test/
│   ├── offers/                      # coupon seam (§16): interface + empty provider + flag
│   │   ├── src/provider.ts  types.ts  rank.ts  index.ts
│   │   └── test/
│   └── db/                          # migrations, queries, queue, event writer (§6, §13)
│       ├── migrations/
│       ├── src/client.ts  queue.ts  events.ts  queries/
│       └── test/
├── tools/
│   └── bench/                       # benchmark harness (§18): corpus/, arms/, report.ts
└── docs/
    ├── adr/                         # decision records (§21.4)
    ├── bench/                       # committed benchmark reports
    └── runbooks/                    # reindex, key revocation, stale storm, offers kill switch
```

Rules: (a) new MCP tool = new file in `apps/mcp-server/src/tools/` + schema in `packages/contracts` + tests at all three levels §17.2; (b) per-site knowledge lives only in `apps/indexer/src/sites/` and bench corpus — never hard-coded in Matching; (c) no package imports an app.

---

## 5. Configuration and secrets

All config via environment variables, validated at boot with a Zod env schema in each app (fail fast, name the missing var). `.env.example` lists every var; real values only in the host secret store, never committed.

| Var | App(s) | Notes |
| --- | --- | --- |
| `DATABASE_URL` | all | Postgres connection string |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` | indexer, mcp-server | Model + dims recorded per embedding row (§6.4) |
| `MCP_PORT`, `MCP_PUBLIC_URL`, `MCP_ALLOWED_ORIGINS` | mcp-server | Origin allowlist for DNS-rebinding protection (transport §9.1) |
| `API_KEY_PEPPER` | mcp-server | HMAC pepper for key hashing (§12.2) |
| `INDEXER_CONCURRENCY`, `INDEXER_PER_DOMAIN_CONCURRENCY`, `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH` | indexer | Defaults in §7.6 |
| `VERIFIER_FETCH_TIMEOUT_MS`, `VERIFIER_CACHE_TTL_S` | verifier | TTL default 30 s, fetch-only (§9.3) |
| `OFFERS_ENABLED` | mcp-server | Master kill switch, default `false` (§16.5) |
| `OFFERS_PROVIDER` | mcp-server | `none` in Phase 0–1 |
| `LOG_LEVEL`, `OTEL_EXPORTER_*` | all | Structured JSON logs (§14) |

Secrets rotation: API-key pepper rotation must keep old-pepper verification for 24 h (§12.2). Embedding key rotation is transparent. Any var added without a `.env.example` entry fails CI.

---

## 6. Data model (PostgreSQL + pgvector)

Conventions: `id` is `uuid` default `gen_random_uuid()` unless noted; timestamps are `timestamptz`; domains stored normalized (§8.2); every table has `created_at`; mutable tables have `updated_at`. Migrations in `packages/db/migrations/`, numbered, never edited after merge — forward-only with a down note in the PR.

### 6.1 Entity map

```text
operator 1───n agent 1───n api_key
agent    1───n event n───1 site(domain)
site     1───n node  1───n edge (from/to node)
site     1───n path_cache n───n edge (ordered)
site     1───n offer (dark, §16) n───1 offer_source
agent    n───n site via my_sites + demand_signal
job (queue) polymorphically targets site / node-branch / verify-url
```

### 6.2 Tables — core map

**`site`** — one row per domain (spec §11 Site).

| Column | Type | Notes |
| --- | --- | --- |
| `domain` | `text` PK | Normalized domain |
| `status` | `enum(mapped, queued, indexing, blocked, opted_out, failed)` | `blocked` = robots/technical; `opted_out` = merchant request, terminal for crawling |
| `map_version` | `int` not null default 0 | Increments on each atomic graph publish (§7.5) |
| `last_indexed_at` | `timestamptz null` | Set on publish only |
| `robots_policy` | `jsonb` | Parsed rules snapshot + `fetched_at` + `etag`; re-fetched per §7.2 |
| `demand_score` | `double precision` default 0 | Decayed aggregate of demand signals (§8.6) |
| `opt_out_at`, `opt_out_reason` | `timestamptz null`, `text null` | Merchant opt-out audit |

Indexes: `status`, `demand_score desc` (queue picking).

**`node`** — a page type/state (spec §11 Node).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `domain` | `text` FK→site | |
| `map_version` | `int` | Version this node belongs to; queries read `site.map_version` only |
| `url_pattern` | `text` | Canonical pattern, e.g. `/brakes-and-traction-control/{category}` |
| `kind` | `enum(home, search, category, filter, product, cart, other)` | Extensible via migration |
| `description` | `text` | Human + embedding source text; no copied product copy (§15 of spec: structure only) |
| `embedding` | `vector(N)` | N fixed per model, §6.4; HNSW index, cosine |
| `embedding_model` | `text` | e.g. provider/model@version — mixed-model rows never queried together |
| `last_verified_at` | `timestamptz null` | Last live-verifier or successful-use confirmation |
| `stale` | `boolean` default false | Set by §10; stale nodes excluded from answers |

Unique: `(domain, map_version, url_pattern, kind)`. Indexes: `(domain, map_version, stale)`, HNSW on `embedding`.

**`edge`** — an action between nodes (spec §11 Edge).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `domain`, `map_version` | FK-ish + int | Same versioning rule as node |
| `from_node_id`, `to_node_id` | `uuid` FK→node | |
| `action` | `enum(navigate, click, fill, select, set_vehicle, filter, submit)` | `set_vehicle`/`filter` kept distinct: they bind params (§8.5) |
| `selector` | `text null` | Ranked primary selector (§7.4); fallbacks in `selector_fallbacks text[]` |
| `url_template` | `text null` | Preferred when present: `{year}/{make}/{model}` placeholders |
| `params_schema` | `jsonb` | JSON Schema of bindable params (names, types, enums e.g. fitment) |
| `attempts`, `successes` | `int` default 0 | Raw counters; `success_rate` is a generated/derived value (§10.2) |
| `stale` | `boolean` default false | |

Invariant: exactly one of `selector`, `url_template` is the primary mechanism; both may exist (`url_template` wins). Check constraint enforces at least one non-null.

**`path_cache`** — a proven question→path binding (spec §11 Path cache).

| Column | Type | Notes |
| --- | --- | --- |
| `id` (`path_id`) | `uuid` PK | Returned to agents as `p_<short-id>` (§10.3) |
| `domain` | `text` FK→site | |
| `question_embedding` | `vector(N)` | Embedding of the canonicalized question |
| `question_canonical` | `text` | Normalized question text (params stripped, §8.4) |
| `ordered_edge_ids` | `uuid[]` | Ordered Edge ids forming the path |
| `param_bindings` | `jsonb` | Example/last bindings (never shopper data) |
| `hits`, `successes` | `int` | Usage counters |
| `last_success_at` | `timestamptz null` | Drives cache trust (§8.3) |
| `stale` | `boolean` default false | Set when any member edge/node goes stale |

### 6.3 Tables — registry, events, jobs

**`operator`** (spec §11): `id uuid PK`, `type enum(person, business)`, `verification_status enum(unverified, pending, verified, rejected, revoked)`, `verification_ref text null` (KYC partner ref — never raw identity documents), `created_at`.

**`agent`** (spec §11): `id uuid PK`, `operator_id FK`, `declared_model text`, `declared_model_version text`, `public_key text null`, `erc8004_id text null`, `verified boolean` (derived from operator status + good standing, §12.4), `tier enum(free, builder, scale, verified_builder, verified_scale)` (final tier names = open question §23 Q1 pricing).

**`api_key`**: `id uuid PK`, `agent_id FK`, `key_hash text` (HMAC-SHA256 of full key with pepper; full key shown once at creation), `key_prefix text` (first 8 chars for support lookup), `scopes text[]` default `{tools}`, `created_at`, `revoked_at null`, `last_used_at null`. Lookup by `key_prefix` then constant-time hash compare.

**`event`** (spec §11, append-only — `REVOKE UPDATE, DELETE` for the app role):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` identity PK | Monotonic; also the Phase 4 ordering key |
| `agent_id` | `uuid` FK | Nullable only for `auth_rejected` |
| `domain` | `text null` | |
| `type` | `enum(query, path_used, step_failed, live_check, outcome, auth_rejected, offers_served)` | `offers_served` reserved §16 |
| `path_id` | `uuid null` | |
| `question_hash` | `text null` | SHA-256 of canonical question — raw question text is NOT stored by default (§15) |
| `latency_ms` | `int null` | |
| `tokens_saved_estimate` | `int null` | Nullable until methodology ADR lands (§13.2) — do not fake it |
| `metadata` | `jsonb` | Allowlisted keys only (Zod-checked): confidence bucket, stale flag, error code |
| `created_at` | `timestamptz` | |

Partition by month from Phase 1 if volume demands; Phase 0 single table + index `(agent_id, created_at)`, `(domain, created_at)`.

**`job`**: `id uuid PK`, `kind enum(index_domain, reindex_branch, sweep_site, verify_url)`, `payload jsonb` (contracts `jobs.ts`), `status enum(queued, running, succeeded, failed, dead)`, `attempts int`, `max_attempts int default 3`, `run_after timestamptz`, `locked_by text null`, `locked_at null`, `last_error text null`. Claimed with `SELECT … FOR UPDATE SKIP LOCKED`; exponential backoff 30 s → 5 m → 30 m, then `dead` + alert.

**`my_site`**: `(agent_id, domain)` PK, `created_at`. **`demand_signal`**: `id`, `domain`, `agent_id null`, `source enum(request_mapping, my_sites, is_mapped_miss, find_miss)`, `created_at`. Demand score recomputed hourly: `score = Σ signal_weight × 0.9^(age_days)` (weights in config, ADR-noted).

### 6.4 Embeddings

- One model for Phase 0 across Node descriptions, canonical questions, and PathCache. Dimensions `N` fixed at first migration; recorded in `embedding_model` on every row.
- Index: HNSW (`m=16, ef_construction=64`) cosine. Query-time `ef_search` = 40 default, tuned by §17 recall tests.
- Model change = new `embedding_model` value + backfill job + dual-read window; never silently re-embed in place. This is an ADR (§21.4) every time.
- Embedding input text: Node = `kind + url_pattern + description + param names`; Question = canonicalized text (§8.4). Product descriptions/images are never embedded or stored (spec §17, structure only).

### 6.5 Versioning and atomic publish

Indexer builds version `v+1` in full (nodes/edges/embeddings), validates (§7.5), then in one transaction flips `site.map_version = v+1`, `status=mapped`, `last_indexed_at=now()`. Readers always join on current `map_version`. Old versions retained 7 days for rollback (`UPDATE site SET map_version = v`), then vacuumed by a cleanup job. PathCache rows referencing old-version edges are marked stale on publish unless re-validated.

---

## 7. Indexer (`apps/indexer`)

Purpose (spec §10): crawl a site with a headless browser, discover navigation/search/filters/product patterns, build the versioned site graph. Respects robots.txt. This is the most site-specific, failure-prone component — budget per-site hand-tuning (§7.8) instead of pretending full generality.

### 7.1 Job entry points

| Job | Trigger | Scope |
| --- | --- | --- |
| `index_domain { domain, reason }` | `request_mapping` threshold, `my_sites` demand, manual, schedule | Full domain → new `map_version` |
| `reindex_branch { domain, node_id }` | Feedback stale-marking (§10), verifier failure | Subgraph rooted at node; merged into a patch version |
| `sweep_site { domain }` | Scheduler (high-demand sites weekly; all mapped sites monthly) | Light re-check: verify home/search/category edges only, full re-index on drift |

### 7.2 Robots and politeness gate (runs before any fetch)

1. Fetch `/robots.txt` (cache 24 h, honour `ETag`). Parse with a spec-compliant parser; store snapshot in `site.robots_policy`.
2. If our user-agent is disallowed for a path prefix, that prefix is excluded from the frontier. If `/` is disallowed → `site.status = blocked`, job ends, demand signals still recorded (we may report "cannot map" honestly).
3. Merchant opt-out check: `site.status = opted_out` → job aborts before any fetch, even if robots allows. Opt-out beats robots.
4. Crawl-delay from robots.txt honoured; default delay 1 s between page loads per domain (§7.6). User-agent string identifies AgentMap + contact URL (transparency, spec §8 Honey lesson).
5. Legal-review flag: domains on the `LEGAL_REVIEW_REQUIRED` list (large retailers, spec §17) cannot leave `queued` until owner clears them. Enforced in job claim, not just UI.

### 7.3 Crawl loop

1. **Browser pool:** Playwright Chromium contexts, one per concurrent job slot; context per domain (fresh storage, no cookies carried across domains). Block images/fonts/media for speed; keep JS on (target sites are JS-heavy). Timeout 30 s/page, 2 retries with backoff.
2. **Frontier:** BFS from home, priority queue ordered by (nav prominence, depth, kind-heuristic). Dedupe by canonical URL (§7.4). Seed URLs from per-site config (§7.8) supplement home discovery.
3. **Per-page processing:** wait for network idle (bounded), extract: links with anchor text + ARIA labels, forms (search boxes, filter facets with option counts), headings, URL. Classify page kind (§7.4 classifier). Record a Node candidate + Edge candidates. **Store structure only** — link text and facet names yes; product description bodies and images no (spec §17).
4. **Interaction probes (bounded):** on search pages, submit 2–3 probe queries from site config and record result URL pattern; on category pages, toggle one filter and record URL/selector effect; on product pages, record pattern only (no per-SKU crawl). Probes are how `url_template` and `params_schema` are learned — without them edges are guesses.
5. **Termination:** page cap, depth cap, time cap (§7.6), frontier empty, or error budget exhausted (>20% page failures → abort, mark job failed, keep previous version live).

### 7.4 Page-kind classifier, canonicalization, selectors

- **Kind classifier:** ordered rules — URL regexes (site config first, generic second: `/search`, `?q=`, `/product/`, `/cart`) → form/facet presence → heading signals. Ambiguous pages → `other`. Classifier is a pure function, unit-tested per site fixture (§17).
- **URL canonicalization:** lowercase host, strip tracking params (`utm_*`, session ids — per-site denylist + generic list), sort query params, collapse ids in path segments to `{id}` placeholders after pattern-frequency analysis. This produces `url_pattern` and `url_template`.
- **Selector ranking (when no URL template exists):** prefer `data-testid`/`data-*` → ARIA role+name → stable `id` → scoped CSS. Reject generated/hash classes. Store primary + up to 3 fallbacks. Selectors are validated by re-locating the element before publish.
- **Edge extraction:** link click → `navigate` (url_template); form submit → `fill`+`submit` or `navigate` with template; facet toggle → `filter` with param enum; vehicle picker → `set_vehicle` with year/make/model schema. Every edge records how it was observed (`probe` vs `static`) in metadata for confidence weighting.

### 7.5 Graph build and publish

1. Assemble Nodes/Edges for `v+1`; dedupe nodes by `(url_pattern, kind)`; drop orphan nodes (unreachable from home in ≤6 hops, except `product` reachable via search template).
2. Embed Node descriptions (§6.4). Embedding failure for >5% of nodes fails the build.
3. **Pre-publish validation:** every edge target exists; every `url_template` renders (placeholders ⊆ params_schema); home reachable; ≥1 search or category path exists; selector spot-check on 10 sampled edges. Fail → job `failed`, old version untouched, alert with reason.
4. Publish atomically (§6.5). Emit Event-adjacent internal log + metrics (`index_duration_s`, `nodes`, `edges`, `probe_success_rate`).
5. `reindex_branch` variant: rebuild only the stale subtree, re-validate locally, publish as patch version; if local validation fails twice, escalate to full `index_domain`.

### 7.6 Limits and concurrency (defaults; per-site override in config)

| Knob | Default | Notes |
| --- | --- | --- |
| Max pages / domain | 2,000 | Prototype sites expected ≪ this |
| Max depth | 6 | |
| Max wall time / domain | 45 min | |
| Global concurrency | 4 browser contexts | |
| Per-domain concurrency | 1 | Politeness: never parallel-hammer one merchant |
| Inter-page delay | 1 s (or robots crawl-delay if larger) | |
| Retries / page | 2, backoff 2 s/8 s | |

### 7.7 Failure modes

Bot-protection walls (CAPTCHA, hard 403s): detect, stop, mark `blocked` with reason `bot_protection`, do not attempt evasion (no fingerprint spoofing, no CAPTCHA solving — spec §22 lists the extension/merchant-opt-in route instead; attempting evasion is a firing-level policy breach for this project). Login-walled structure: map public structure only. Timeouts/5xx storms: error budget abort (§7.3.5). All failures keep the last good version serving.

### 7.8 Per-site config (`apps/indexer/src/sites/<domain>.ts`)

Typed object: `domain`, `seedUrls[]`, `probeQueries[]`, `kindRules[]` (regex→kind), `trackingParams[]`, `limitOverrides`, `notes` (quirks log, dated). Site config changes are code-reviewed like code — they are effectively per-merchant integration contracts. Adding a site = one config file + bench corpus (§18) + classifier fixtures. No site conditionals in generic crawl code; if a quirk cannot be expressed in config, that is a design discussion, not an `if (domain === …)`.

---

## 8. Matching — question → path (`packages/matching`)

Purpose (spec §16): people phrase the same need differently; match by meaning (embeddings) plus extracted parameters, never exact keys. Separate the stable path from per-query parameters. This package decides whether the product feels magical or broken — it gets the deepest unit tests (§17.4).

### 8.1 Pipeline (invoked by Query service for `find` and `get_path`)

```text
question ──▶ normalize (§8.2) ──▶ extract params (§8.5) ──▶ canonical question
                                                              │
              ┌───────────────────────────────────────────────┼────────────────┐
              ▼                                               ▼                │
        PathCache NN lookup                            Node NN lookup          │
        (cosine, same domain,                          (top-k Nodes,         │
         not stale, last_success fresh)                 not stale)           │
              │                                               │                │
              ▼                                               ▼                │
        hit + params bind OK? ──yes──▶ return path      compose path (§8.3)  │
              │no                                             │                │
              └───────────────────────────────────────────────┘                │
                                                              ▼
                                              bind params → steps + result_url_template
                                                              │
                                                              ▼
                                              confidence (§8.7) → return or abstain
```

### 8.2 Normalization

Domain: lowercase, strip scheme/`www.`, IDNA/punycode, reject non-host input. Question: trim, collapse whitespace, lowercase a copy for hashing (keep original case for embeddings), strip filler ("please find me", "I need") via a small tested rule list. Locale: Phase 0 English only; non-English questions still embed (multilingual model behaviour noted in ADR) but params extraction is English-only — document the limitation in tool description so agents know.

### 8.3 Retrieval and path composition

- **PathCache first:** cosine NN over `path_cache.question_embedding` for the domain, `stale=false`, top 3. Accept a hit when `similarity ≥ cache_accept` (default 0.86, tuned §17.4) AND param binding succeeds AND every edge in the path is non-stale at current `map_version`. Cache hits increment `hits`.
- **Node retrieval fallback:** cosine NN over Node embeddings (top 8, `similarity ≥ node_floor` default 0.55). Candidate target nodes ranked by similarity × kind prior (product/category/search preferred over home/other).
- **Composition:** shortest path (fewest edges, BFS) in the current graph from a `home` or `search` entry node to the target node, preferring `url_template` edges over selector edges and higher `success_rate` edges (weight = hops + (1 − success_rate)). Max path length 6 steps; longer → abstain.
- **No-match:** return `found:false, reason:"no_path"` (distinct from low-confidence abstain for metrics).

### 8.4 Canonical question (params stripped)

Replace extracted param values with placeholders: "front brake pads for a 2018 Honda Civic" → "brake pads for {year} {make} {model} + {position}". Canonical text is embedded for PathCache writes and hashed for Event `question_hash`. On a successful outcome (§10), Query service upserts PathCache with this canonical pair — this is how the warm-map curve (§18) is built.

### 8.5 Parameter extraction

Two stages, both unit-tested with golden sets (§17.4):

1. **Deterministic extractors:** year (4-digit 1950–2030), sizes/dimensions (regex + unit normalization), quantities. Pure functions, no I/O.
2. **Schema-driven extraction:** for the target node's incoming `filter`/`set_vehicle` edges, match question tokens against `params_schema` enums (make/model/facet values) with fuzzy matching (normalized edit distance + alias table per site config, e.g. "Civic" → model enum). Unmatched schema-required params → step is emitted with `params: {}` and listed in `missing_params[]` so the agent can ask/fill, never guessed.
3. LLM-based extraction is **not** in Phase 0. If golden-set recall < 85% on bench corpus, propose it as an ADR with cost/latency numbers — do not sneak it in.

### 8.6 Unmapped and demand handling

`find`/`is_mapped` on an unmapped domain: write `demand_signal`, create Site row `queued` if absent, enqueue `index_domain` only when decayed `demand_score` crosses `INDEX_DEMAND_THRESHOLD` (default: 5 distinct agents or 20 signals/7d — config, ADR-noted) or an agent with `my_sites` priority requests it. Response includes `mapped:false` and, if queued, `queue_position` (rank by demand_score). Never promise an ETA in Phase 0.

### 8.7 Confidence and abstention

`confidence = w1·retrieval_similarity + w2·path_edge_success_rate(min) + w3·param_coverage − w4·staleness_penalty` (weights in config, initial 0.5/0.25/0.2/−, tuned only via bench + golden sets, changes noted in PR). `abstain_threshold` default 0.45. Below it: `found:false, reason:"low_confidence"`, log the candidate in Event metadata for offline tuning. Threshold and weights are product-safety knobs: a wrong path costs the agent more than an honest miss (spec G3 accuracy parity).

---

## 9. MCP server and tool contracts (`apps/mcp-server`, `packages/contracts`)

### 9.1 Transport

Streamable HTTP per MCP spec 2025-03-26: single endpoint `POST/GET /mcp`; validate `Origin` against `MCP_ALLOWED_ORIGINS` (DNS-rebinding protection); require `Accept: application/json, text/event-stream`; JSON-RPC 2.0 bodies; SDK `StreamableHTTPServerTransport`. Stateless mode preferred (fresh server+transport per request, R3); enable sessions only via ADR. CORS: allowlist origins only, no `*` on authenticated routes. Health: `GET /healthz` (liveness) and `GET /readyz` (DB reachable + migrations current). Graceful shutdown: drain in-flight, 10 s cap.

### 9.2 Tool catalogue (Phase 0 — spec §12, expanded)

All tools require auth (§12) except none. All inputs/outputs are Zod schemas in `packages/contracts/src/tools.ts`; the tables below are normative — code that disagrees with them fails contract tests (§17.5).

#### `is_mapped`

Input: `{ domain: string }`. Output: `{ mapped: boolean, map_version: number|null, last_indexed_at: string|null, status: SiteStatus }`.
Errors: invalid domain → `invalid_input`. Side effects: demand signal on miss. Latency budget p95 < 100 ms.

#### `find`

Input: `{ domain: string, question: string (1–500 chars) }`.
Output (mapped + found): `{ mapped: true, found: true, steps: Step[], result_url_template: string|null, needs_live_check: ("price"|"stock"|"availability")[], path_id: string, confidence: number, missing_params: string[], offers: Offer[] }` — `offers` always present, `[]` unless §16 hook serves (forward-compatible: agents written in Phase 0 never break when coupons light up).
Output (mapped, not found): `{ mapped: true, found: false, reason: "no_path"|"low_confidence" }`.
Output (unmapped): `{ mapped: false, status, queue_position: number|null }`.
`Step = { action, url?, selector?, selector_fallbacks?, params?, purpose }` — `purpose` is a one-line human/agent-readable label ("Set vehicle to 2018 Honda Civic"); steps must be executable without seeing raw HTML (that is the token saving).
Example: spec §12 `find` example is the golden fixture (§17.5) — illustrative URLs aside, shape must match exactly.

#### `get_path`

Input: `{ domain: string, goal: string }` where goal is a target description or a `node_id`. Output: same step shape as `find` plus `{ from_node, to_node }`. Difference from `find` (resolving the spec §12 overlap flagged earlier): `find` answers a shopper question end-to-end (search + filters bound); `get_path` returns navigation between known graph nodes without param binding. Tool descriptions must say this in one sentence each so agents choose correctly; a conformance test asserts the descriptions (§17.5).

#### `live_check`

Input: `{ url: string (absolute, http/https), fields?: ("price"|"stock"|"availability")[] }`.
Output (§10 verifier, §6 data model): `{ url, status: "ok"|"not_found"|"blocked"|"error", price: { amount_minor: number, currency: string }|null, stock: "in_stock"|"low_stock"|"out_of_stock"|"unknown", checked_at, source: "cache"|"live" }`. Money in minor units + ISO currency, never floats. Domain need not be mapped (live_check works on any public URL) but URL host is SSRF-checked (§15).

#### `report_outcome`

Input: `{ domain, path_id, success: boolean, failed_step_index?: number, note?: string (≤500 chars) }`. Output: `{ acknowledged: true, branch_status: "ok"|"marked_stale"|"reindex_queued" }`. Idempotent per `(agent_id, path_id, outcome_hash)` 10-min window (duplicate reports ack without double-counting).

#### `request_mapping`

Input: `{ domain }`. Output: `{ queued: boolean, queue_position: number|null, already_mapped: boolean }`. Writes demand signal (§8.6).

#### `my_sites`

Input: `{ action: "add"|"remove"|"list", domains?: string[] (≤100) }`. Output: `{ sites: { domain, status, map_version }[] }`. Added domains get demand priority for this agent; list reflects freshest known status. Per-agent cap 100 (config).

### 9.3 REST mirror

`POST /api/v1/find`, `GET /api/v1/is-mapped?domain=`, etc. — one route per tool, same services, same Zod schemas, same auth. REST exists for non-MCP agents (spec §15.2); it must never diverge semantically: contract tests run the same fixtures through both transports (§17.5). Versioning: `/api/v1/`; MCP tool shapes versioned by contracts package semver (§21.3).

### 9.4 Error model

MCP errors use JSON-RPC error objects with `data: { code, message, retryable, retry_after_ms? }`:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `invalid_input` | Zod validation failed (field path in message) | no |
| `unauthorized` (-32001) | Missing/invalid/revoked API key | no |
| `rate_limited` | Tier budget exhausted | yes, `retry_after_ms` set |
| `domain_blocked` | opted_out or robots-blocked (honest, no path) | no |
| `not_found` | Unknown path_id / node | no |
| `upstream_error` | Embedding/DB/verifier failure | yes |
| `internal` | Anything else (stack logged, generic message returned) | no |

No stack traces, SQL, selectors-beyond-contract, or internal URLs in error messages. Every error path writes an Event (type per §6.3, error code in metadata).

### 9.5 Tool descriptions (agent-facing copy is a deliverable)

Each tool's MCP `description` is reviewed copy, not an afterthought: one sentence what it does, one sentence when to use it vs. siblings, param hints, and honesty notes ("price/stock from `find` are never current — call `live_check`"). Description changes require the same review as schema changes (agents behaviourally depend on them).

---

## 10. Live Verifier (`apps/verifier`)

Purpose (spec §10, §14): fetch only the terminal page(s) to confirm price, stock, and that the path still works. Never serves cached values as truth. Invoked via `live_check` tool (§9.2) and by scheduled sweeps (§7.1).

### 10.1 Extraction pipeline

1. **Fetch strategy ladder:** (a) plain HTTP GET with browser UA (fast, ~60% of pages) → (b) Playwright render if price/stock markers absent or page requires JS → (c) give up with `status:"error"`. Record which rung succeeded (feeds per-site config).
2. **Structured data first:** JSON-LD `Product`/`Offer`, microdata, OpenGraph price tags — highest precision. Fall back to per-site config selectors, then generic heuristics (currency-pattern proximity to buy-box). Every extraction records its source (`json_ld|selector|heuristic`); heuristic-only results with low extractor confidence return `price:null` rather than a guess.
3. **Normalization:** price → `{ amount_minor:int, currency: ISO-4217 }` (parse locale separators; reject ranges by taking the purchasable price only when unambiguous, else null). Stock → `in_stock|low_stock|out_of_stock|unknown` from per-site phrase tables in site config ("Only 3 left" → low_stock). Page status → `ok|not_found(404/gone)|blocked(401/403/CAPTCHA)|error`.
4. **Path-still-works check:** when called with a `path_id` context (internal sweep mode), also verify terminal node URL pattern matches; mismatch → emit step_failed signal into §11.

### 10.2 Serving modes and cache

- **Synchronous fast path:** `live_check` tool calls verifier in-process-via-queue with a 8 s deadline; single URL only in Phase 0.
- **Cache:** in-memory + Postgres `verify_cache(url_hash PK, result jsonb, fetched_at)` TTL 30 s default (`VERIFIER_CACHE_TTL_S`). Cache exists to absorb duplicate agent checks, never to answer "current price" beyond 30 s: response always carries `checked_at` and `source`. Rows older than TTL are invisible to reads.
- **Per-domain politeness:** same caps as indexer (1 concurrent/domain, ≥1 s spacing); live_check bursts queue rather than hammer — queue wait counts toward the 8 s deadline, then `upstream_error retryable`.

### 10.3 Failure handling

Target 403/CAPTCHA → `blocked` (honest, no evasion, §7.7 policy). Timeout → `error` retryable. Extractor disagreement (JSON-LD vs selector price differ >1 minor unit) → return JSON-LD value, log `extractor_conflict` metric per domain (rising conflicts = site redesign signal → suggest sweep).

---

## 11. Feedback intake and self-healing (spec §13–§14)

### 11.1 Intake

`report_outcome` (§9.2) → Feedback service: validate path exists at some map_version; idempotency window; then in one transaction: increment edge `attempts` for every edge in path, `successes` on success, or on failure increment only edges up to `failed_step_index` (edges after the failure were never exercised — counting them would corrupt rates). Write Event `outcome` (+ `step_failed` when index present). `note` text is stored in a quarantined `feedback_note` table (agent_id, path_id, note, created_at; 90-day retention) — never in Event metadata, never echoed to merchants raw (Phase 3 aggregates only).

### 11.2 Success rate and stale rules (initial constants; tuning via §19 metrics, ADR-noted)

- `success_rate = successes / attempts` with Bayesian smoothing `(successes+9)/(attempts+10)` for display/ranking (prior 0.9).
- **Immediate stale:** single confirmed failure from a *verified* agent on an edge with ≥20 prior successes still marks `stale` only after verifier corroboration (enqueue `verify_url`/`reindex_branch` check within 5 min); unverified-agent single failures increment a `suspect` counter.
- **Threshold stale:** smoothed rate < 0.7 with ≥10 attempts in 7 days → edge + dependent PathCache rows `stale=true`, excluded from answers, `reindex_branch` enqueued at the earliest failed node.
- **Recovery:** reindex publish clears stale on rebuilt branch; PathCache rows re-validate lazily on next hit (§8.3).
- Every use is a test (spec §14): successful `live_check` on a path's terminal node also refreshes node `last_verified_at`.

### 11.3 Anti-poisoning (spec §18 says outsiders can't poison maps — feedback is the exception, design for it)

Agents cannot write graph structure, but false failure reports could DoS branches into staleness. Defences: verified-agent reports weigh 5× unverified; per-agent daily report caps by tier; an agent whose reports are contradicted by verifier corroboration >30% over 50 reports gets feedback weight decayed to 0 and an anomaly flag (§12.6) — its core query access is unaffected (separate the feedback privilege from the query privilege). All thresholds config + metrics, reviewed monthly.

### 11.4 Scheduled freshness

Nightly job: rank mapped sites by demand_score; enqueue `sweep_site` for top decile weekly, all mapped monthly (§7.1). Stale-rate dashboard (§14) alerts when a domain's 7-day stale fraction >5% (redesign detector).

---

## 12. Agent registry, auth, and rate limiting (spec §18; Phase 1–2 build-out, Phase 0 minimal)

### 12.1 Phase split

Phase 0: operator+agent rows exist, API keys issued manually (CLI), tiers enforced, verified=false for all. Phase 1: self-serve key issuance + usage billing hooks. Phase 2 (spec §21): operator verification flow (§12.4). Do not build verification UI in Phase 0.

### 12.2 API keys

Format `am_live_<prefix8>_<secret32>` (base62). Stored as HMAC-SHA256(secret, pepper) (§6.3). Shown once. Auth middleware: parse → prefix lookup → constant-time compare → load agent/operator/tier → attach to request context → async `last_used_at` touch (batched, never on hot path). Revocation: set `revoked_at`; middleware checks per request (cache 30 s, revocation propagates ≤30 s — document this). Optional signed requests (UCP-style HTTP Message Signatures) and ERC-8004 id: schema fields exist (§6.3); enforcement is Phase 2, behind per-agent flag.

### 12.3 Registration API (Phase 1; MCP-adjacent REST only, not MCP tools)

`POST /api/v1/operators`, `POST /api/v1/agents` (declares model+version — spec §18 model-swap rule: changing declared model requires re-declaration endpoint; undeclared swap detection is Phase 4 analytics, not Phase 1 enforcement), `POST /api/v1/agents/:id/keys`, `DELETE …/keys/:keyId`. Admin CLI mirrors these for Phase 0 manual issuance.

### 12.4 Verified check (Phase 2; spec §18 semantics are normative)

Verified means "a real, accountable operator", never "paid us": requires operator identity check (in-house vs KYC partner = spec §23 Q3, decide before Phase 2 starts); free or cheap; removable for bad behaviour (status → `revoked`, keys keep working at unverified tier unless fraud, verified badge/query benefits stop). Verification state derives `agent.verified`; tier benefits (higher limits/discounts, spec §7) attach to tier, not to payment alone.

### 12.5 Rate limits and quotas

Token-bucket per agent (Redis if R1 flips, else Postgres advisory-lock bucket — acceptable at Phase 0 QPS): defaults free 60 find/min, builder 600/min, live_check stricter per domain (merchant politeness shared across agents: global per-domain live_check cap). Monthly query quota per tier feeds billing (spec §7 subscription + per-query fallback; prices = Q1 open). Over-limit → §9.4 `rate_limited`. Verified tiers get higher buckets (config table, not code).

### 12.6 Anomaly flags

Counters per agent/day: requests/domain/minute spikes, checkout-path probing (paths ending at `cart` nodes repeatedly without outcome), promo-code abuse signals (Phase ≥16.3: repeated offer queries across domains without purchases — detection only, flagged for Phase 3 merchant view, spec §19). Flags land in Event metadata + `agent_flag` table; Phase 0 only records, Phase 4 scores.

---

## 13. Event log and analytics groundwork (spec §§5 G5, 11, 19)

### 13.1 Write path

Services emit events via `packages/db/events.ts` → in-process buffer (flush 100 rows or 500 ms) → batched INSERT. Event write failure never fails the agent request (log + metric `event_drop_total`; sustained drops alert — silently losing the Bureau's raw material is worse than a slow response, so buffer is bounded and drops are loud).

### 13.2 `tokens_saved_estimate`

Ships as NULL until an ADR defines the estimator from benchmark data (baseline tokens/task per site-task class minus mapped-path tokens). Backfill is forbidden (would fabricate history). This column is the Phase 3 sales chart's raw material — its integrity matters more than its availability.

### 13.3 Privacy shape of events

No raw question text by default (hash only, §6.3); no IPs stored (hash with daily-rotating salt if abuse analysis needs it, Phase 1 decision); no user/shopper identifiers exist in the system to store. Retention: events 25 months hot, then aggregate-only rollup (`event_daily_agent_domain` counts) — rollup design Phase 1, retention job Phase 1.

### 13.4 Phase 3/4 read models (design now, build later)

Merchant demand view = demand_signal + `found:false` canonical-question aggregates per domain. Journey view = path_used/step_failed sequences per domain. Bureau score inputs = per-agent outcome rates, corroboration rates (§11.3), anomaly flags (§12.6). Because these are pure reads over §6.3, Phase 0's only obligation is: never add an event type without a Zod metadata schema, and never store what Phase 3 must not see (shopper data) anywhere upstream.

---

## 14. Observability

- **Logs:** structured JSON (pino), fields: `ts, level, service, request_id (uuid per MCP call, propagated to jobs/events), agent_id, domain, tool, latency_ms`. No question text, no keys, no notes (§11.1) in logs. Errors log stack server-side only.
- **Metrics (Prometheus):** per-tool latency histograms + error rates by code (§9.4); matching confidence histogram + abstain rate; pathcache hit rate; edge stale rate per domain; index job duration/node counts; verifier extractor-conflict rate; event drop counter; queue depth/age per job kind; offers hook latency (§16) even while dark.
- **Traces:** OpenTelemetry spans for find pipeline stages (retrieve/compose/bind/offers) — the abstain-tuning work (§8.7) depends on stage attribution.
- **Alerts (Phase 0 minimal):** p95 find > 600 ms 15 min; error rate >2%; dead jobs >0; stale fraction >5%/domain; event drops >0. Runbooks in `docs/runbooks/` for each alert before prod.
- **Dashboards:** one ops dashboard (latency/errors/queue), one product dashboard (queries/day, mapped hit rate, warm-curve proxy: repeat-domain query latency). Product dashboard is the §18 benchmark's live cousin.

---

## 15. Security, privacy, and legal (spec §17–§18)

### 15.1 Security controls

| Threat | Control |
| --- | --- |
| DNS rebinding against hosted/local MCP | Origin validation (§9.1); bind local dev to 127.0.0.1 |
| API key leak | Hashed storage, prefix-only logs, revocation ≤30 s, per-key scopes |
| SSRF via `live_check` URL | Allow http/https only; resolve + block private/loopback/link-local ranges; re-check after redirects (max 3); DNS-pinning per fetch |
| Feedback poisoning | §11.3 weighting, corroboration, weight decay |
| Map poisoning | Only Indexer writes graph; no agent-writable graph surface exists |
| Injection via question/note text | Parameterized queries; note quarantine table; output encoding in any future dashboard |
| Dependency/supply chain | Lockfile, `pnpm audit` in CI, Playwright browser binaries pinned |
| Secrets | §5; boot-time env validation; no secrets in repo/logs; CI secret-scan |

### 15.2 Privacy (non-negotiable, test-enforced §19.6)

Store structure, demand, and agent behaviour — never shopper identity. No product description/image copying (link/facet names and our own generated Node descriptions only). Plain-language data policy page published before prod indexing (spec §17) covering: what we crawl, UA identity, opt-out route, what agent data we record, merchant data sharing terms (Q4). Merchant opt-out endpoint + manual route, effective: crawl stop immediate, existing graph retired from answers within 24 h, `opted_out` terminal (§7.2).

### 15.3 Legal gates

Robots default-deny (§7.2); legal review before large retailers (spec §17) via `LEGAL_REVIEW_REQUIRED`; ToS-sensitive categories flagged in site config `notes`; coupon sourcing rules §16.2 are legal-reviewed before Phase 5 activation. None of this blocks Phase 0 prototype sites, but the flags ship in Phase 0 code.

---

## 16. Expansion room — coupons / offers on agent query (Honey-like, done transparently)

> **Intent:** reserve the seam now so a future "agent asks for brake pads → answer also carries a legitimate coupon" feature is an additive change, not a refactor. Phase 0 ships types, flag, empty provider, and response field only. No coupon is ever served in Phase 0–1.

Honey proved demand: shoppers (now agents acting for them) value automatic savings at the moment of intent. Spec §8 also documents exactly how Honey destroyed trust: misused affiliate links, scraped private codes, lost ~40% of Chrome users and thousands of merchant partners. So AgentMap's version is designed inside-out from that lesson: **the agent asks, we disclose, the merchant can see it.** Coupons are a merchant-visible feature or they do not ship.

### 16.1 Product shape (future Phase 5 — not Phase 0)

- Agent calls `find` as today. When the resolved path targets a product/category on a mapped domain, the response may additionally carry `offers[]` (§9.2 `find` output already includes the field, `[]` by default).
- Alternatively the agent explicitly calls a dedicated tool `find_offers { domain, product_url? | category?, question? }` when it wants savings without navigation help. This mirrors Honey's "check for codes" moment but as an explicit, loggable agent query instead of silent browser injection.
- The agent (not us) decides whether to surface/apply the code to its user. We never auto-apply, never inject into a session, never rewrite links silently (§16.2 red lines).
- Saving is verified the Honey way, minus the abuse: at `live_check` time or via a dedicated `verify_offer` step, the code is tested against the live cart/product context by the *agent's* browser context — not by us completing checkout (spec §6 non-goal stands: no checkout, no payments, ever).

### 16.2 Red lines (hard constraints; violating any one blocks launch regardless of revenue)

| # | Rule | Rationale |
| --- | --- | --- |
| C1 | **Sources: public or merchant-provided only.** Codes published by the merchant on-site/on its official channels, codes a merchant/affiliate network explicitly feeds us (`offer_source`, §16.3), or codes a merchant opts in via Phase 3 dashboard. Never scraped private/leaked/single-use codes, never codes behind login, never codes harvested from user sessions/checkouts. | Spec §8 Honey lesson; private-code scraping is what merchants experienced as theft. |
| C2 | **No silent affiliate rewriting.** If an offer carries an affiliate relationship, the response says so (`commercial_relationship`, §16.3). We do not append affiliate tags to URLs the agent did not ask about. | Disclosure is the product difference vs Honey; merchant Phase 3 view shows it too. |
| C3 | **No shopper data upstream.** Offer queries key off domain/product/category/question only — never cart contents tied to an identified shopper, never order history (none exists in-system, §15.2). | Spec §§6, 17. |
| C4 | **Merchant opt-out covers offers first.** `opted_out` domains serve `offers: []` unconditionally, checked before any provider call; merchants can opt out of offers while staying mapped. | Gives merchants a finer lever than nuke-the-map; builds Phase 3 goodwill. |
| C5 | **Expired/invalid codes are pruned by verification, not by agent complaints alone** (§16.4 verify loop + §11-style corroboration). Never serve a code whose `last_verified_at` exceeds its staleness window as "valid" — label it `unverified` or drop it. | Dead-code spam destroys agent trust faster than no codes. |
| C6 | **No pay-for-ranking without labelling.** Organic ranking is best-verified-saving first (§16.4). Any future sponsored placement is a separate, labelled list — never mixed silently. | Same transparency principle, pre-committed before revenue pressure exists. |
| C7 | **Extension/session harvesting is out of scope for offers** even if the §15-of-spec browser extension ships. It sends structure only, exactly as spec'd — not codes seen in a real user's session. | The extension's privacy review (spec §15) would fail otherwise, and rightly. |

### 16.3 Data model additions (created empty in Phase 0; no writes until Phase 5)

**`offer_source`** — where codes legitimately come from: `id uuid PK`, `kind enum(merchant_direct, affiliate_network, merchant_public_page, merchant_dashboard)`, `name`, `terms_url`, `feed_config jsonb null`, `commercial_relationship text` (disclosure copy shown to agents/merchants), `created_at`.

**`offer`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Exposed as `offer_id` |
| `domain` | `text` FK→site | |
| `source_id` | `uuid` FK→offer_source | Provenance is mandatory, not metadata |
| `code` | `text null` | Null for code-less offers (auto-discount links, "sale ends" info) |
| `title`, `description` | `text` | Our words; never copied merchant marketing wholesale |
| `discount_type` | `enum(percent, fixed_amount, free_shipping, bogo, info)` | |
| `discount_value` | `numeric null` | Percent points or minor units per `currency` |
| `currency` | `text null` | ISO-4217 when monetary |
| `applies_to` | `jsonb` | `{ scope: sitewide|category|product, url_patterns: [], category_keys: [], min_spend_minor: null }` — matched against the `find` target (§16.4) |
| `starts_at`, `expires_at` | `timestamptz null` | Unknown expiry → shorter verification window (C5) |
| `last_verified_at` | `timestamptz null` | Set only by the verify loop (§16.4), never by ingestion |
| `verify_attempts`, `verify_successes` | `int` | Same Bayesian treatment as edges (§11.2) |
| `status` | `enum(active, unverified, expired, revoked, merchant_disabled)` | `revoked` = source/merchant pulled it; served never |
| `affiliate_url_template` | `text null` | Only when C2 disclosure accompanies it |

Indexes: `(domain, status, expires_at)`, partial HNSW not needed in Phase 5 (offer counts/domain are small; revisit if >10k/domain).

**`offer_event`** — reuse the main Event log: `offers_served` (§6.3) with metadata `{ offer_ids, domain, via: find|find_offers }`, plus (Phase 5) `offer_outcome` reported through an extended `report_outcome { offer_id?, offer_applied?: boolean, saved_minor?: number }` — same corroboration weighting as §11.3 so agents cannot farm fake savings.

### 16.4 Serving and ranking (Phase 5 logic; Phase 0 builds only the hook shape)

1. **Hook point:** `find` step 7 in §3.4, and the standalone `find_offers` tool, both call `packages/offers` → `getOffers({ domain, targetNode, question, params, agentTier }) : Offer[]`. Single interface, two entry points — implement the interface once.
2. **Eligibility filter (in order, cheap→expensive):** domain not `opted_out`-for-offers → `status=active` → time window contains now → `applies_to` matches target node URL pattern/category → agent tier entitled (offers may be a verified-tier benefit — pricing Q1 decides; default all tiers in design).
3. **Ranking:** verified saving estimate desc (percent/fixed normalized against the live price when `live_check` context exists, else nominal), tie-break `last_verified_at` desc, then success-rate desc. Cap 3 offers per response (agents have context budgets too — this product exists to *save* tokens; a 20-code dump betrays that).
4. **Response shape** (contracts `offers.ts`, shipped Phase 0):

```json
{ "offer_id": "o_…", "code": "SAVE10", "title": "10% off brake pads",
  "discount": { "type": "percent", "value": 10 },
  "expires_at": "…", "verified": true, "last_verified_at": "…",
  "source_kind": "merchant_public_page",
  "commercial_relationship": "AgentMap may earn a commission via the merchant's affiliate programme.",
  "apply_hint": "Enter at checkout — AgentMap does not apply codes for you." }
```

`verified:false` offers are served only when no verified offer exists and must say so. `code:null` offers carry `url` instead.

5. **Verify loop:** background job re-tests active offers against live pages on a cadence (daily; hourly inside 48 h of expiry): apply-code-in-sandboxed-browser-context where the merchant allows, else confirm code still published at source. Failures ×3 → `unverified`; confirmed removal/expiry → `expired`. Merchant-dashboard-disabled → `merchant_disabled` instantly (C4).
6. **Agent-side application:** the agent applies the code in its own browsing/checkout flow (we are not in the checkout, spec §6). `report_outcome` extension (§16.3) closes the savings loop and feeds ranking — claimed `saved_minor` is corroborated statistically, never trusted per-report (§11.3 pattern).

### 16.5 Feature-flag and rollout design (built Phase 0, exercised Phase 5)

- `OFFERS_ENABLED` (default `false`) master switch + per-domain allowlist column `site.offers_enabled boolean default false` + per-tier gate in `getOffers`. Three independent off-switches because coupon incidents need surgical response.
- **Kill-switch runbook** (`docs/runbooks/offers-kill-switch.md`, written before Phase 5 launch): flip `OFFERS_ENABLED=false` → hook returns `[]` within one deploy/config push, `find` unaffected. This runbook is also the incident answer if a bad code batch ships.
- **Rollout (Phase 5):** 1 opted-in merchant domain (ideally a Phase 3 dashboard merchant who *fed* us codes — cleanest provenance story) → verified agents only → measure `offers_served`→`offer_applied` rate, merchant feedback, support load → widen. Never launch offers on a domain whose merchant has not at minimum not-objected via the Phase 3 listing (C1/C4 spirit).

### 16.6 Phase 0 acceptance for the seam (the only coupon work now)

1. `packages/contracts/src/offers.ts` defines `Offer`, `find_offers` tool input/output (tool *not registered* until Phase 5), and the `offers` field on `find` output (§9.2).
2. `packages/offers` implements `getOffers` behind the §16.4 item 1 signature with an `EmptyOfferProvider` (always `[]`) and the eligibility *function shape* as pure, unit-tested code (domain opt-out check reads a stubbed flag) — real ranking/verification is Phase 5.
3. MCP server wires the §3.4 step-7 hook behind `OFFERS_ENABLED`; latency budget instrumented (§14 metric exists, reads ~0).
4. `offer`/`offer_source` migrations exist; tables empty; no ingestion code, no scraping code, no affiliate templates anywhere in the repo. A CI grep-gate fails the build on `affiliate_url_template` writes outside `packages/offers` (guardrail against quiet scope creep).
5. Tests: §17.7. Done = an agent on Phase 0 cannot distinguish offers-existing from offers-not-existing except the always-present empty `offers: []`.

### 16.7 Open decisions deferred to Phase 5 (recorded, not blocking)

Revenue share/affiliate network choice; whether verified agents get exclusive/better offers; merchant-fed-code onboarding UX (Phase 3 dependency); code-verification browser sandbox design (CAPTCHA policy §7.7 applies — if verifying requires evasion, we do not verify that merchant's codes that way); jurisdiction-specific disclosure wording (legal, §15.3).

---

## 17. Testing strategy — unit, integration, contract

Framework: Vitest across the monorepo (shared config at root), Playwright Test only for Indexer/Verifier browser fixtures. Testcontainers (Postgres+pgvector image) for DB integration — never mock SQL behaviour that pgvector indexes decide. Coverage gates are per-package (§17.8), not a vanity global number.

### 17.1 Test pyramid and placement

| Level | Location | Runs | Share |
| --- | --- | --- | --- |
| Unit (pure functions, mocked I/O) | `*/test/unit/` or `*.test.ts` beside src | Every PR, <2 min total | ~70% |
| Integration (real Postgres, real HTTP, stubbed external sites/embeddings) | `*/test/integration/` | Every PR, <8 min | ~20% |
| Contract (MCP + REST schemas vs fixtures) | `packages/contracts/test/`, `apps/mcp-server/test/contract/` | Every PR | part of above |
| E2E (MCP client → staging-shaped stack, fixture sites) | `test/e2e/` at root | Nightly + pre-release | ~10% |
| Benchmark (§18) | `tools/bench` | Staging, per Indexer/Matching PR + nightly | separate gate |

Rule: a bug found at any level gets a regression test at the *lowest* level that reproduces it. E2E-only bugs also get a unit/integration test before merge.

### 17.2 `packages/contracts` — unit tests

- Every Zod schema: valid fixture parses; each field's invalid variants (wrong type, missing required, oversize string, bad enum) fail with the field path asserted. Table-driven.
- Golden fixtures: spec §12 `find` example (§9.2) round-trips input→output; all 7 tool fixtures in `test/fixtures/tools/`; `Offer` fixture (§16.4 item 4) including `code:null` variant.
- Error model: every §9.4 code constructible and serializes to the JSON-RPC shape; `retryable` flags asserted per code.
- Backward-compat: previous minor version's fixtures still parse under additive-change rules (§21.3); a breaking fixture change fails CI until contracts major bumps.
- Jobs/events schemas: every `job.kind` payload and every `event.type` metadata schema has positive+negative cases (this is what keeps §13.4 enforceable).

### 17.3 `packages/db` — integration tests (Testcontainers)

- Migrations: up from empty, up from previous version, app boots against migrated DB; `map_version` publish transaction (§6.5) rolls back cleanly on injected mid-transaction failure (old version still served).
- Queue: concurrent claimers never double-claim (`SKIP LOCKED`), backoff schedule, dead-letter after max_attempts, stale-lock reclaim (>10 min).
- Vector: seed known vectors, NN query returns expected ordering (cosine), HNSW index used (`EXPLAIN` asserts index scan at test scale with `enable_seqscan=off` fallback check), mixed `embedding_model` rows never co-returned.
- Events: append-only enforced (UPDATE/DELETE rejected for app role), batched writer flush sizes/timing, hash-only question storage (assert no raw text column populated).
- Offers tables: FK/provenance NOT NULL enforced; `status` enum transitions used by §16.4 item 5 are representable (no writer exists yet — schema-level assertions only).

### 17.4 `packages/matching` — unit tests (deepest suite)

- **Normalization (§8.2):** domain cases (scheme, `www.`, case, trailing dot, IDNA, garbage → reject); question filler stripping never eats product words (golden pairs).
- **Param extraction (§8.5):** golden set ≥60 questions/site-category (auto-parts fitment, home-improvement sizes, skincare types): assert extracted `{year, make, model, position, size}` equality and `missing_params` exactness. Gate: precision ≥95%, recall ≥85% (below → §8.5 item 3 ADR discussion). Alias/fuzzy cases ("Civic", "civc", "Honda Civic 2018" orderings), adversarial cases (year inside model names, sizes inside SKUs).
- **Canonicalization (§8.4):** param values → placeholders; two paraphrases of one need canonicalize identically where expected; hash stability.
- **Retrieval/composition (§8.3):** in-memory fixture graphs (≥3 synthetic sites + serialized staging snapshots): PathCache hit/miss at threshold boundaries (similarity mocked via fixed vectors), stale edge in cached path forces fallback, BFS path choice prefers url_template + high success_rate, >6-hop abstains, kind-prior ranking.
- **Confidence/abstain (§8.7):** boundary values around `abstain_threshold`, weight config changes alter outcomes monotonically (higher min-edge-rate never lowers confidence).
- **Demand (§8.6):** decay math (`0.9^age`), threshold crossing enqueues exactly once.
- Embedding calls mocked at the provider interface; one integration test against the real provider in nightly only (cost control).

### 17.5 MCP server — unit + contract + integration

- **Unit:** auth middleware (valid/expired/revoked/malformed keys, pepper rotation window), rate limiter bucket math + `retry_after_ms`, domain normalization at the edge, error mapper (every thrown domain error → §9.4 code, no stack in payload), offers-hook timeout/failure isolation (hook throws → `find` still returns, metric incremented), tool-description snapshot test (§9.5 copy is diffed in review).
- **Contract:** MCP Inspector-style client calls each tool over real Streamable HTTP transport against a Testcontainers-backed server + fixture graph: assert response validates against contracts schemas, `tools/list` shapes/descriptions present, bad `Origin` rejected, missing `Accept` types rejected, JSON-RPC batch + notification handling per spec 2025-03-26. Identical fixtures replayed through REST mirror (§9.3) with deep-equal business payloads.
- **Integration:** full `find` pipeline with stubbed embeddings + fixture graph (mapped-found, no_path, low_confidence abstain, unmapped→demand→queue), `report_outcome`→stale→excluded-from-next-`find` loop, `live_check` against fixture product pages (§17.6 pages served locally), `my_sites` add/list/remove caps, rate-limit end-to-end.
- **Auth abuse:** revoked key ≤30 s propagation (§12.2) asserted with fake timers; key never appears in captured logs (log-scrub assertion over test output).

### 17.6 Indexer & Verifier — unit + fixture integration

- **Unit (pure):** robots parser fixtures (allow/disallow prefixes, crawl-delay, sitemap lines, malformed files → default behaviour), URL canonicalizer (§7.4 table-driven incl. tracking-param stripping + `{id}` collapsing), kind classifier per-site fixtures (saved HTML snapshots → kind), selector ranker (generated-class rejection), url_template renderer/placeholder validation, price parser (locales, ranges, minor-unit conversion), stock phrase tables, discount/eligibility helpers reused by offers (§16).
- **Fixture integration:** local static+JS fixture sites (`test/fixtures/sites/`: mini auto-parts store with search/filters/vehicle picker/product pages, one SPA variant, one robots-disallowed variant, one bot-wall variant): full `index_domain` → graph assertions (node kinds, search template learned, filter edges with enums, publish version flip), bot-wall → `blocked` without evasion attempts (assert no retry storm), robots variant → zero fetches beyond robots.txt (request log asserted).
- **Verifier integration:** fixture product pages (JSON-LD, selector-only, heuristic-only, 404, blocked, price-conflict JSON-LD-vs-selector): assert normalized outputs (§10.1 item 3), conflict metric, 30 s cache `source:"cache"` then expiry → `live`, SSRF guard rejects `169.254.169.254`/localhost fixture URLs without fetching.
- **Self-healing integration:** index fixture → corrupt one fixture page → `report_outcome` failure + verifier corroboration → stale → `reindex_branch` → healed path serves again (§11.2 timeline asserted end-to-end).
- Browser tests run headless Chromium in CI; HTML snapshots refreshed only via explicit `test:update-fixtures` with diff review (silent snapshot updates are how redesigns hide).

### 17.7 Offers seam — unit tests (Phase 0 scope only, §16.6)

Eligibility pure functions: opted-out domain → `[]` before provider call (provider mock asserts zero calls); expired/wrong-status filtered; `applies_to` matching (sitewide/category/url-pattern/min-spend) table-driven; ranking order + 3-cap with fabricated verified offers; `EmptyOfferProvider` always `[]`; flag matrix (`OFFERS_ENABLED` × per-domain × tier) all-off in defaults; hook latency isolation (slow fake provider → `find` p95 budget assertion in integration). *No test may ingest or serve a real code in Phase 0* — fixtures use `TESTCODE-*` values against fixture domains only.

### 17.8 Coverage and quality gates (CI blocking)

| Gate | Threshold |
| --- | --- |
| `packages/contracts`, `packages/matching` line+branch | ≥90% |
| `apps/mcp-server` services/middleware | ≥85% |
| `packages/db`, `packages/offers` | ≥85% |
| `apps/indexer`, `apps/verifier` pure modules (§17.6 unit list) | ≥80% (browser glue excluded, fixture-covered instead) |
| Typecheck (`tsc --strict`), lint, Zod env-vs-`.env.example` parity (§5), secret-scan, `pnpm audit` (high+) | zero errors |
| Mutation spot-check (quarterly, matching param extraction only) | surviving mutants reviewed, not gated |

Flaky-test policy: one retry in CI with quarantine issue filed same day; two flakes in a week → test fixed or deleted by its owner (§21.2). No `test.skip` without a linked issue and expiry date in the test name.

---

## 18. Benchmark plan (spec §20 — the Phase 0 exit evidence)

### 18.1 Corpus

3–5 sites without MCP across categories (auto parts, home improvement, skincare — final pick = §23 Q2, owner decision before Step W4 §20). ~20 tasks/site written as shopper goals with ground-truth target product/category + required params ("front brake pads for a 2018 Honda Civic" → expected category URL pattern + fitment). Corpus versioned in `tools/bench/corpus/<domain>.json`; task edits require re-running both arms.

### 18.2 Arms and protocol

- **Arm A (baseline):** reference agent browses raw with a browser tool, no AgentMap.
- **Arm B (mapped):** same agent + model + prompt scaffold, AgentMap MCP attached (`is_mapped`→`find`→follow steps→`live_check`→`report_outcome`).
- Runs 1–5 per task back-to-back (warm-map curve: PathCache §8.4 fills across runs). Fresh browser context per run; same time-of-day batching for A/B fairness; target-site rate limits respected (bench is a polite client too).
- Recorded per run: wall time, agent tokens (in/out), peak context tokens, tool calls, success (target reached + params correct, auto-checked against ground truth + human spot-check 20%), estimated cost.

### 18.3 Report and gate

`tools/bench/report.ts` emits `docs/bench/<date>-<sites>.md` + chart (time/tokens by run number, A vs B; accuracy table). **Phase 0 gate (S3):** median run 2–5 tokens and time below Arm A with accuracy ≥ Arm A − 0 (parity); if parity fails on any site, that site's map/matching is fixed and re-benched — the gate is per-site, not averaged away. Bench runs on staging against real sites; CI fixture-bench (mini sites) runs per PR as a smoke regression, never as the gate.

---

## 19. Validation plan (definition of done per layer)

### 19.1 Per-PR validation (all PRs)

CI green: unit + contract + integration suites (§17), coverage gates (§17.8), typecheck/lint, migration check (if `packages/db` touched: up/down on Testcontainers), `.env.example` parity, secret scan. Manual: PR description states which §20 step it serves, benchmark impact (number or "none — no indexer/matching change"), and any config/threshold touched (§8.7/§11.2 knobs named explicitly).

### 19.2 Per-step exit validation (§20 work units)

Each work unit in §20 lists its own exit check inline; the unit is not done until that check's output (command + result, or bench link) is pasted into the PR/issue. "Tests pass" alone never closes a unit that names a behavioural check (e.g. W5's staging MCP flow).

### 19.3 Release validation (staging → prod)

Deploy staging → run E2E suite (§19.4) → run fixture-bench + (for indexer/matching changes) real-site bench delta → check dashboards (§14) 30 min soak → promote same artifacts to prod → smoke `is_mapped`/`find`/`live_check` on each prod domain with a dedicated bench agent key → announce in changelog.

### 19.4 E2E suite (root `test/e2e/`, staging-shaped stack, fixture + real staging sites)

1. Mapped flow (§3.4) per prototype domain via real MCP client (Claude Code or SDK client script).
2. Unmapped flow: `is_mapped:false` → `request_mapping` → queue position → demand enqueue at threshold (staging config lowered).
3. Broken-path flow: fixture page broken → `report_outcome:false` → stale → excluded → reindex → healed.
4. Auth/rate-limit flow: revoked key rejected; burst hits `rate_limited` with `retry_after_ms`.
5. `live_check` freshness: change fixture price → within cache TTL `source:"cache"`, after → new price `source:"live"`.
6. Offers invisibility (§16.6.5): `find` responses contain `offers: []`; `find_offers` tool absent from `tools/list`.

### 19.5 Performance validation

Load harness (k6 or autocannon scripts in `tools/load/`): `find` p95 < 300 ms, `is_mapped` p95 < 100 ms at 50 RPS sustained 10 min against staging fixture graph; `live_check` p95 < 8 s deadline compliance; indexer: one prototype domain full index < 45 min within §7.6 caps. Budgets breached → profile before optimizing (Rust triggers §2.2 are evaluated only from these numbers). Soak: 2 h mixed traffic, event-drop counter zero, queue drains.

### 19.6 Compliance validation (before prod, then quarterly)

Robots-disallowed fixture + one real disallowed domain: zero crawl fetches (log audit). Merchant opt-out drill: opt out a staging domain → answers stop ≤24 h, crawl jobs abort. Data scan: automated grep/DB audit proving no columns contain emails/names/addresses patterns across event/note tables; log scrub replay. Data-policy page live and linked from MCP server `/.well-known/` + REST root. Coupon grep-gate (§16.6.4) verified by intentionally failing test commit in a scratch branch.

### 19.7 User acceptance (owner)

Willy runs 5 self-chosen tasks per prototype site through a real agent (Claude Code/Cursor) on staging, unscripted; friction notes filed as issues tagged `uAT`. Phase 0 exits when §18 gate + this pass + S1–S6 (§1.2) all hold.

---

## 20. Work plan (ordered units; dependencies; owners in §21.2)

| ID | Unit | Depends on | Exit validation |
| --- | --- | --- | --- |
| W1 | Repo scaffold: pnpm monorepo (§4), CI, Docker Compose PG+pgvector, env validation | — | Clean clone → `compose up` → `/healthz` 200; CI green on empty suites |
| W2 | Contracts v0.1: all §9 schemas + jobs/events + offers seam types (§16.6.1) | W1 | §17.2 suite green; spec §12 example round-trips |
| W3 | DB layer: migrations §6 + offers tables, queue, event writer | W2 | §17.3 suite green |
| W4 | Site selection + bench corpus v1 (3–5 sites, ~20 tasks each) + legal-review flags | owner Q2 | Corpus merged; `LEGAL_REVIEW_REQUIRED` set |
| W5 | MCP server: transport, auth, rate limit, `is_mapped` (registry-backed) | W2, W3 | MCP client lists tools; revoked key rejected (staging-shaped local stack) |
| W6 | Indexer v0: robots gate, crawl, classify, graph build, publish — site #1 end-to-end | W3, W4 | Fixture + real site #1 graph published; §17.6 green |
| W7 | Matching + `find`/`get_path` + PathCache write-back | W5, W6 | §17.4–17.5 green; golden `find` flow on site #1 |
| W8 | Feedback + self-healing + verifier corroboration + sweeps | W6, W7 | §17.6 self-healing integration green |
| W9 | Live Verifier + `live_check` (full §10) | W6 | Fixture matrix green; freshness E2E §19.4.5 |
| W10 | Remaining tools: `request_mapping`, `my_sites`, demand scoring; admin CLI key issuance | W5 | §19.4.2 green |
| W11 | Offers seam dark launch (§16.6 items 2–5) | W2, W7 | §17.7 green; §19.4.6 green; grep-gate verified |
| W12 | Sites #2–5: site configs, classifier fixtures, corpus runs | W6–W9 | Each site indexed + benched individually |
| W13 | Benchmark full run + report (§18) | W12 | S3 gate evaluated per site; report in `docs/bench/` |
| W14 | Hardening: dashboards/alerts/runbooks (§14), data-policy page, compliance suite (§19.6), load test (§19.5) | W13 | §19.5–19.6 green; owner UAT §19.7 → Phase 0 exit |
| W15 | Phase 1: self-serve registry/billing hooks, REST polish, retention rollups | W14 | Phase 1 plan revision (this file) approved |

Sequencing notes: W4 can start during W1 (it is research/config, owner-heavy). W11 is deliberately after W7 (hook needs the real `find`) but before W12 so every later site ships with the seam present. W13 is the highest-risk validation in the plan — schedule slack lives here, not in W6.

---

## 21. Coordination structure

### 21.1 Shape (solo now, team-ready)

Even with one person, work is organized as three surfaces with named ownership, because Phase 1 hiring/onboarding maps onto them:

| Surface | Owns | Review duty |
| --- | --- | --- |
| Server & Matching | `apps/mcp-server`, `packages/matching`, `packages/contracts` (co-owned) | Tool behaviour, agent-facing copy (§9.5) |
| Crawl & Verify | `apps/indexer`, `apps/verifier`, site configs | Per-site quality, politeness (§7.2/§7.6) |
| Data & Proof | `packages/db`, `tools/bench`, events, dashboards | Schema, benchmark integrity (§18) |

Cross-surface changes (contracts, schema, auth) need the Data surface's review regardless of author. One person wearing all hats still writes the PR as if handing to another surface — that discipline is what keeps §3.3 boundaries real.

### 21.2 Working agreements

- Trunk-based; short-lived branches `<surface>/<unit>-<slug>` (e.g. `crawl/W6-robots-gate`); PRs scoped to one §20 unit; §19.1 checklist in every PR template.
- Tests travel with code (same PR); fixture/snapshot updates called out separately in the PR description.
- Threshold/config changes (§8.7, §11.2, §7.6) are one-line-diff PRs with a metrics/bench justification — never bundled into feature PRs.
- Weekly: stale-fraction + abstain-rate review (§14 dashboards); dead-job triage. Per-site quality is a standing agenda item while W12 runs.
- Incidents: runbook first (`docs/runbooks/`), postmortem issue within 48 h, regression test as the fix's companion (§17.1 rule).

### 21.3 Versioning and compatibility

`packages/contracts` semver: additive (new optional field/tool) = minor; removal/retype = major + migration note + agent-facing changelog. MCP server supports current + previous contracts minor for one release window. DB migrations forward-only in prod; rollback is graph-version flip (§6.5) or restore, never down-migration on prod data. `find`'s always-present `offers` field (§9.2) is the template: future fields land as additive minors so Phase 0 agents never break (Phase 5 depends on this).

### 21.4 Decisions and ADRs

`docs/adr/NNNN-<slug>.md`: context, decision, alternatives rejected, consequences; superseded (never edited) by later ADRs. Required ADRs before/during build: embedding model choice (§6.4), abstain/confidence weights v1 (§8.7), stale thresholds v1 (§11.2), `tokens_saved_estimate` estimator (§13.2, Phase 1), demand threshold (§8.6), session-state need (R3, only if triggered). Spec §23 questions answered outside code (pricing Q1, KYC Q3, merchant sharing Q4, UCP Q5, extension Q6) become ADRs too when decided.

### 21.5 Communication artifacts

This plan (revised via PR, version header bumped), ADRs, bench reports (`docs/bench/`), runbooks, and a living `docs/site-status.md` (per-domain map_version, last index, stale %, known quirks). No decision lives only in chat.

---

## 22. Risks and mitigations (extends spec §22)

| Risk | Where handled |
| --- | --- |
| Per-site extraction harder than hoped; benchmark gate fails | Per-site gate §18.3; site configs §7.8; slack at W13; drop/replace a site (W4 picks 5 candidates for 3 slots if needed) |
| Confident wrong paths erode agent trust | Abstention §8.7; accuracy parity gate; confidence metrics §14 |
| Feedback poisoning / stale-DoS | §11.3 weighting + corroboration |
| Merchant/legal pushback | Robots/opt-out §7.2, data policy §15.2, coupon red lines §16.2, transparency UA |
| Bot-protection walls on best prototype sites | §7.7 honest blocked state; site substitution at W4; Phase 3 opt-in + possible extension (spec §15) later |
| Embedding provider cost/latency or model deprecation | Provider interface + model versioning §6.4; nightly real-provider test §17.4 |
| Scope creep into checkout/payments via coupons enthusiasm | Spec §6 non-goals; §16.2 C3/C7; offers grep-gate §16.6.4 |
| Solo-bus-factor | §21.5 artifacts; contracts-first design; runbooks before prod (W14 gate) |
| Rust rewrite pressure before profiling | §2.2 triggers are the only entry; seams §3.3 keep it possible and bounded |

---

## 23. Open questions (owner decisions; blocking step noted)

| # | Question (spec §23 + plan-found) | Blocks |
| --- | --- | --- |
| Q1 | Pricing — **DEFERRED by owner 2026-11-02**; spec §7 defaults remain config placeholders, nothing charged | Phase 1 billing (W15) when revisited |
| Q2 | **RESOLVED 2026-11-02** (ADR-0001): crawl-friendly specialists — rockauto.com (auto parts), fergusonhome.com (home improvement, Build.com successor), dermstore.com (skincare); backups 1aauto.com / wayfair.com per ADR. Robots re-checked 2026-11-02; live crawl gate in W4 is still authoritative. | W4 unblocked |
| Q3 | KYC provider — **DEFERRED by owner 2026-11-02**; verification stays admin-driven | Phase 2 (§12.4) when revisited |
| Q4 | Merchant sharing terms — **DEFERRED by owner 2026-11-02**; read models stay admin-only | Phase 3 rollout when revisited |
| Q5 | UCP extension vs protocol-neutral alongside it? | Contracts evolution (§21.3) if answered late |
| Q6 | Browser extension worth privacy/review cost? (also C7 interaction) | Post-Phase 2 at earliest |
| Q7 | Embedding model/provider final pick (ADR §21.4; candidate shortlist at W2) | W2/W6 |
| Q8 | Session-state need for Streamable HTTP (R3) | Only if client behaviour forces it |

Q2 is resolved (ADR-0001). None of Q1, Q3–Q8 blocks Phase 0 except Q7 (can default to a mainstream hosted model at W2 and ADR it). Coupon revenue questions (§16.7) block Phase 5 only.

---

## Appendix A — Phase map (spec §21, aligned)

| Phase | Scope in this plan | Exit |
| --- | --- | --- |
| 0 Prototype | W1–W14 | S1–S6 (§1.2) |
| 1 Beta | W15: self-healing at scale (already W8), `live_check` full, `my_sites`, keys, billing | 20+ builders weekly (spec §21) |
| 2 Verified agents | §12.4 | First verified operators |
| 3 Merchant side | §13.4 read models + dashboard — first slice built 2026-11-02 (admin-guarded demand/journeys APIs + `/dashboard` page; sharing terms Q4 still gate merchant-facing rollout) | First merchants |
| 4 AgentBureau | Trust scoring over §6.3/§12.6 | Paid lookups |
| 5 Offers (new) | §16.4–16.5 activation on opted-in domains | `offers_served`→applied rate + merchant sign-off |

## Appendix B — Sources (inspected 2026-11-02)

- [MCP Transports specification (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — Streamable HTTP single-endpoint + Origin rules (§9.1)
- [pgvector](https://github.com/pgvector/pgvector) — vector storage/ANN in Postgres (§6.4)
- [Playwright documentation](https://playwright.dev/docs/intro) — browser automation basis for §7/§10

*End of plan v0.2. Revision rule: change this file via PR with the version header bumped; chat decisions do not amend it (§21.5).*





