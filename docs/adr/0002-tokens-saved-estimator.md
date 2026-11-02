# ADR-0002: `tokens_saved_estimate` estimator

**Status:** Accepted · **Date:** 2026-11-02 · **Decides:** plan.md §13.2

## Context

`event.tokens_saved_estimate` shipped NULL because no honest estimator existed. Fabricating per-event savings would poison the Phase 3 sales chart, which is built from this column.

## Decision

Estimate only from measured benchmark data, never from a constant:

```
tokens_saved_estimate(event) = max(0, baseline_median_tokens(domain, task_class) - mapped_tokens(event))
```

- `baseline_median_tokens` comes from committed bench reports (`docs/bench/`), Arm A median tokens per (domain, task_class), loaded as config — not hard-coded.
- `task_class` is the canonical question with params stripped (§8.4), matched to the nearest bench task class; no match → NULL.
- `mapped_tokens` is the token cost of the `find` response actually returned (estimated at 4 chars/token, same estimator as the bench harness).
- Until a domain has a committed real-site bench report, its events keep NULL. Fixture benches never feed the estimator.
- Backfill is forbidden (would fabricate history).

Implemented as `estimateTokensSaved` in `apps/mcp-server/src/tokens-saved.ts` (pure, unit-tested). Wiring into the event writer activates per domain when its first real bench report lands.

## Consequences

Phase 3 reporting can sum this column honestly per domain. Domains without benchmarks show "not yet measured" instead of invented savings.
