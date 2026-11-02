# ADR-0001: Phase 0 prototype sites (Q2)

**Status:** Accepted · **Date:** 2026-11-02 · **Decides:** plan.md §23 Q2 · **Unblocks:** W4, W12, W13

## Context

Plan §18/W4 needs 3–5 sites without MCP, across categories (spec §20: auto parts, home improvement, skincare), ~20 tasks each, to prove token/time savings at accuracy parity. Owner chose the "crawl-friendly specialists" strategy on 2026-11-02 over spec-faithful flagships (AutoZone/Home Depot/Ulta), to reach a credible benchmark faster and defer flagship bot/legal risk to Phase 1.

Candidates were screened on 2026-11-02 by fetching each domain's `/robots.txt` (the plan §7.2 default rule). Robots permission is necessary, not sufficient: the Indexer's live gate (robots + opt-out + legal flag + bot-wall detection) remains authoritative at crawl time, and a 403/bot-wall at crawl time moves the site to its backup without evasion (plan §7.7).

## Decision

Primary three (one per category):

| Category | Domain | Robots evidence (2026-11-02) | Known constraint |
| --- | --- | --- | --- |
| Auto parts | rockauto.com | `User-agent: *` disallows only `/info/`, `/cgi-bin/` | AgentMap UA is not ClaudeBot (separately disallowed); our UA follows `*` rules |
| Home improvement | fergusonhome.com (Build.com successor; build.com redirects here) | `*` disallows account/checkout and `sortBy`/`viewtype`/`categoryid` query variants; category/product-family sitemaps published | Paths must avoid disallowed sort/view query params; use path navigation |
| Skincare | dermstore.com | `*` disallows `search=`, `facetFilters=`, `sortBy=`/`sortOrder=` query params, checkout | Filter/search must be expressed as URL paths, not query facets; if the map needs disallowed query facets, this site drops to backup review |

Backups, in order, used only if a primary fails the live crawl gate, legal review, or per-site benchmark accuracy gate (plan §18.3):

| Category | Backup | Robots note |
| --- | --- | --- |
| Auto parts | 1aauto.com | `/search` disallowed, crawl-delay 1; category navigation allowed |
| Auto parts (last resort) | partsgeek.com | `/search/`, `/ym*` vehicle search disallowed — fitment tasks weakened; use only if both above fail |
| Home improvement | wayfair.com | `/filter(s)/` disallowed; large retailer — set `LEGAL_REVIEW_REQUIRED` before indexing |
| Skincare | none accepted | lovelyskin.com returned 403 on `/robots.txt` itself, which plan §7.2 treats as blocked until reviewed; a new candidate needs a fresh robots check + owner note in this ADR's successor |

Rejected for Phase 0: AutoZone/Home Depot/Ulta (flagship strategy, owner-deferred to Phase 1); skinstore.com (redirects into dermstore.com, duplicate); carparts.com (`/search`, `/results/` disallowed, weaker than RockAuto).

## Consequences

- W4 can now write site configs (`apps/indexer/src/sites/<domain>.ts`), classifier fixtures, and ~20-task bench corpora for the three primaries. Adding each site is still one config file per plan §7.8.
- Dermstore and FergusonHome maps must be designed around path-based navigation; query-facet edges that robots disallows must not be emitted, even if technically crawlable.
- `LEGAL_REVIEW_REQUIRED` (plan §7.2): set for wayfair.com if ever promoted; primaries proceed under the standard robots/opt-out gates with the data-policy page required before prod indexing (plan §15.2).
- If a primary is replaced by a backup, note it in `docs/site-status.md` and amend this ADR by a successor ADR (plan §21.4: supersede, do not edit).

## Evidence

Robots files fetched 2026-11-02: rockauto.com, partsgeek.com, 1aauto.com, carparts.com, fergusonhome.com (via build.com redirect), wayfair.com, dermstore.com (all HTTP 200 with rules above); lovelyskin.com `/robots.txt` HTTP 403.
