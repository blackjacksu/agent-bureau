# Offers kill switch (plan 16.5)

Phase 0: offers are dark. `OFFERS_ENABLED` defaults to `false` and `EmptyOfferProvider` returns `[]`.

To disable offers instantly (Phase 5 incident or precaution):

1. Set `OFFERS_ENABLED=false` in the mcp-server environment and redeploy/restart. The `find` hook returns `[]` within one deploy; `find` itself is unaffected.
2. Per-domain surgical off: set `site.offers_enabled=false` for the affected domain.
3. Verify: `find` responses contain `offers: []`, `find_offers` remains absent from `tools/list`, and the `offers_hook_latency_ms` metric in `/metrics` reads near zero.
