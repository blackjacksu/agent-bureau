# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm monorepo (Node ≥20, pnpm 9). Postgres+pgvector via `docker-compose.yml`; set `DATABASE_URL` for DB integration tests (skipped otherwise).

- `pnpm install` · `pnpm -r build` · `pnpm -r typecheck` (strict tsc is the lint gate)
- `pnpm test` — builds all packages, then runs every suite from the root `vitest.config.ts` (packages, apps, tools, `test/e2e`)
- `pnpm test:unit` — run tests without building; `pnpm test:cov` — coverage with plan §17.8 thresholds
- Single file / test: `npx vitest run apps/mcp-server/test/feedback.test.ts -t "<name>"`
- `node scripts/offers-grep-gate.mjs` — coupon guardrail, also run in CI (`.github/workflows/ci.yml`)

## Folder map

| Folder | Role |
| --- | --- |
| `apps/mcp-server` | Agent-facing service: Streamable HTTP `/mcp` + parallel REST `/api/v1/*`, auth/API keys, rate limits, metrics, feedback/self-healing (`feedback.ts`, `sweep.ts`), admin CLI. Talks to Postgres via `packages/db`, never to indexer/verifier source. |
| `apps/indexer` | Playwright crawler: robots/opt-out gate (`crawl/robots.ts`), bounded frontier, page classification (`discover/`), graph + URL-template emit and atomic publish (`emit/`). Per-site configs in `src/sites/`. |
| `apps/verifier` | Live price/stock checks: HTTP-then-Playwright fetch ladder, SSRF guard, short TTL cache, JSON-LD-first extractors (`extract/`). |
| `packages/contracts` | Zod schemas for every tool, event, job, graph, offer, and error payload. Change here first. |
| `packages/db` | SQL migrations (`migrations/`, forward-only), pg client, job queue, batched event writer, registry/API keys, analytics read models, offers tables. |
| `packages/matching` | Question → path: normalize, param extraction, embeddings, retrieval, path composition, confidence/abstain. |
| `packages/offers` | Coupon seam: `getOffers` + `EmptyOfferProvider`, eligibility logic, and (beyond Phase 0 scope) public-page ingest. Gated by `OFFERS_ENABLED`. |
| `tools/bench` | Benchmark harness: corpora (`corpus/*.json`), raw-browsing proxy arm vs mapped arm, report writer → `docs/bench/`. |
| `test/e2e` | Boots the compiled server end-to-end. |
| `docs/` | `adr/` decisions, `bench/` reports, `runbooks/` ops procedures, `data-policy.md`, `site-status.md` (per-domain index state), `OPEN-ITEMS.md`. |
| `scripts/` | Repo guardrails (offers grep-gate). |

## Planning documents

- `agentmap-proposal-and-spec.md` — Proposal + Design Spec v0.1 (§§1–23): problem, goals/non-goals, system overview, data model, MCP tools, core flows, freshness, compliance, benchmark plan, roadmap.
- `plan.md` — Implementation plan v0.2 (§§1–23 + appendices): success criteria S1–S6, locked decisions, architecture, repo layout (§4), data model, per-app specs, coupon seam (§16), testing/benchmark/validation gates (§§17–19), work plan W1–W15 (§20). Check a step's entry/exit criteria here before implementing it.

## What is being built

**AgentMap**: a hosted, shared, pre-built map of how to use websites, served to AI agents over MCP. The first agent to need a site pays the discovery cost; later agents get a short, cheap answer. Phase 0 MCP tools: `is_mapped`, `find`, `get_path`, `live_check`, `report_outcome`, `request_mapping`, `my_sites`.

## Locked decisions (plan.md §2 — changing any requires an ADR + plan revision, not a silent code change)

- **D1** TypeScript on Node.js LTS everywhere in Phase 0–1. No Rust until a profile triggers it (plan §2.2: indexer CPU saturation → live-verifier latency → `find` p99).
- **D2** Remote hosted MCP over Streamable HTTP, single `/mcp` endpoint (POST + GET), MCP spec 2025-03-26. Not stdio.
- **D3** Benchmark-first: 3–5 sites mapped deeply, ~20 tasks each (corpus in `tools/bench/corpus/`, reports in `docs/bench/`).
- **D4** One PostgreSQL + pgvector for graph, vectors, registry, and events.
- **D5** Playwright (Chromium first) for the Indexer and Live Verifier.
- **D6** Zod schemas in `packages/contracts` are the single source of truth for every MCP/REST payload.
- **D7** Coupons: seam only in Phase 0 (types + flag + empty provider, dark-launched). Only public/merchant-provided offers, full provenance and disclosure; no affiliate-link rewriting.

## Architectural rules

- Indexer and Live Verifier sit behind queue + HTTP boundaries with JSON payloads defined in `packages/contracts`. Never import Indexer internals into the MCP server — treat boundary violations as bugs (keeps Rust extraction cheap).
- Price/stock are never served from cache as truth; always live-checked.
- Every path use emits an Event; failures mark branches stale automatically (no manual step).
- Never store shopper personal data (names, addresses, logins, order history, payment details). Never map robots.txt-disallowed sites.
- Out of scope for Phase 0–1: checkout/payments, merchant dashboard (Phase 3), Bureau trust scoring (Phase 4).
