# Runbook: reindex a site / branch
Trigger: stale fraction >5% for a domain, merchant redesign report, or manual quality fix.
1. Check docs/site-status.md and the stale dashboard for the domain.
2. Enqueue `reindex_branch` (single branch) or `index_domain` (full) via the job queue; confirm the job is claimed by an indexer worker.
3. Watch job result: `published` flips map_version atomically; `blocked: bot_protection` means stop — do not evade, escalate to merchant opt-in route.
4. Smoke `find` for 3 known tasks on staging, then prod. Update docs/site-status.md.
