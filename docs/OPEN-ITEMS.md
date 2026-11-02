# Open items — what remains and exactly what unblocks each

**Updated:** 2026-11-02 · **Code state:** all implementable plan items built; full suite green (see §3). These are the only remaining items. None is a code defect.

## 1. W-unit inventory (plan §20)

| Unit | Status | Evidence |
| --- | --- | --- |
| W1 scaffold | Done | pnpm monorepo, CI, Compose, env validation |
| W2 contracts v0.1 | Done | `packages/contracts`, spec §12 golden fixture, table-driven tests |
| W3 DB layer | Done | Migrations, queue, batched events; real pgvector integration (5 tests) |
| W4 site selection + corpus v1 | Done | ADR-0001, superseded domains ADR-0003; corpora for 6 domains |
| W5 MCP server | Done | Streamable HTTP, auth, rate limits, compiled boot verified |
| W6 indexer v0 | Done | Robots/opt-out gates, bounded crawl, atomic publish; live graphs in DB |
| W7 matching + find/get_path | Done | 98% found on 60 real tasks |
| W8 feedback/self-healing | Done | Corroboration, stale marking, reindex queue; E2E heal loop test |
| W9 live verifier | Done | JSON-LD-first normalization, SSRF guard, freshness E2E |
| W10 request_mapping/my_sites/demand | Done | Admin CLI + registration API on real DB |
| W11 offers seam (dark) | Done | Types, empty provider, hook, grep gate |
| W12 sites #2–5 configs | Done (substituted set) | ADR-0003 primaries indexed |
| W13 benchmark | Done with proxy caveat | §2 below |
| W14 hardening | Done | Dashboards metrics, runbooks, data policy page + route, CI, load test |
| W15 Phase 1 slices | Done as first slices | Registration/usage/verification endpoints, merchant dashboard, Bureau score, offers engine behind flag |

## 2. Remaining items (owner/external inputs only)

### OI-1 — ADR-0003 approval

- **What:** carparts.com / shadesoflight.com / paulaschoice.com replaced the bot-walled ADR-0001 trio (all originals and backups returned `blocked: bot_protection`; no evasion attempted).
- **Already built:** configs, corpora, live indexes (CarParts v2), benchmark reports.
- **Decision needed:** approve, approve for Phase 0 only, or reject (then: merchant opt-in or a different egress before any re-index).
- **When answered:** rejection requires re-indexing work only; no code change.

### OI-2 — Q1 pricing

- **What:** tier names/prices and per-query price; whether offers are a verified-tier perk.
- **Already built:** per-agent usage metering (`GET /api/v1/usage`), tiered rate limits, tier field on agents.
- **Decision needed:** price points, or "defer" (defaults: spec §7 Free / Builder $49 / Scale $99 as config only).
- **When answered:** config + ADR, ~1 PR. No schema change needed.

### OI-3 — Q3 KYC provider

- **What:** in-house identity check vs KYC partner for operator verification.
- **Already built:** verification state machine + admin transition endpoint; `agent.verified` derivation; trust scoring is independent of it.
- **Decision needed:** provider choice (and budget). 
- **When answered:** one adapter behind the existing transition endpoint, ~1–2 PRs.

### OI-4 — Q4 merchant sharing terms

- **What:** what event-log data merchants see, on what terms.
- **Already built:** demand/journey read models + dashboard, currently admin-token only precisely because terms are unset.
- **Decision needed:** sharing scope/terms.
- **When answered:** flip dashboard auth from admin to merchant-scoped keys, ~1 PR.

### OI-5 — Hosted embeddings

- **What:** replace the deterministic token-hash embedding provider with a hosted model (ADR for model choice).
- **Already built:** provider interface, hosted adapter, 1536d consistency, nightly-shaped tests. Verified: no `EMBEDDING_API_KEY` in this environment.
- **Needed:** an API key + model pick.
- **When answered:** set env, re-index 3 sites, expect pattern-precision above the current 77%.

### OI-6 — Stricter Arm A benchmark

- **What:** §18 Arm A as an LLM reference agent browsing raw, replacing the deterministic raw-browsing proxy.
- **Already built:** Arm A proxy (`tools/bench/src/raw-arm.ts`) + both-arm report (`docs/bench/2026-11-02-live-ab.md`): B 244 median tokens / 16 ms / 23-of-30 vs A 312k / 1,197 ms / 18-of-30.
- **Needed:** an agent harness/allowance to run an LLM browser on 60 tasks.
- **When answered:** one bench run; report supersedes the proxy numbers.

## 3. Reproduce the green state

```bash
# Postgres 17 + pgvector on 55432 (cluster at /tmp/agentmap-pg), DB agentmap_test
pnpm -r build && pnpm -r typecheck
DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test pnpm test        # 355 passed
DATABASE_URL=postgres://postgres@127.0.0.1:55432/agentmap_test npx vitest run --coverage  # 91.9/75.6/81.9
node scripts/offers-grep-gate.mjs
```
