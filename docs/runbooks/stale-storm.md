# Runbook: stale storm (many branches stale at once)
Trigger: alert stale fraction >5%/domain or mass step_failed events.
1. Assume site redesign first. Check verifier extractor_conflict metric for the domain.
2. Pause scheduled sweeps for the domain to avoid hammering a redesigning merchant.
3. Run one bounded `index_domain` on staging; compare node/edge counts to previous version.
4. If new graph validates, publish; if bot-walled, mark blocked and follow the merchant opt-in route. Update docs/site-status.md.
