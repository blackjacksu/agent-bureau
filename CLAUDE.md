# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

Pre-code. The repo holds only planning documents; there is no build, lint, or test tooling yet. Add commands here once `package.json` / workspace config exist.

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
