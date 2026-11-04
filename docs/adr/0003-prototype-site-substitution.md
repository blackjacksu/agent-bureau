# ADR-0003: Prototype site substitution after live crawl gate

**Status:** Accepted — owner-approved 2026-11-02 · **Date:** 2026-11-02 · **Supersedes:** ADR-0001 primary list (strategy unchanged)

## Context

ADR-0001 picked rockauto.com, fergusonhome.com, dermstore.com with backups 1aauto.com / wayfair.com, and stated a bot-wall at crawl time moves a site to its backup without evasion (plan §7.7). On 2026-11-02 bounded live crawls (12-page cap, HTTP and Playwright, honest `AgentMapBot` UA) returned `blocked: bot_protection` for all three primaries and both backups from this egress. Summit Racing returned an Incapsula wall in-browser. No evasion was attempted.

## Decision

Same strategy (crawl-friendly specialists, one per category), new domains that pass the live gate:

| Category | Primary | Live evidence (2026-11-02) | Robots constraint |
| --- | --- | --- | --- |
| Auto parts | carparts.com | Bounded crawl `published`: 50 nodes / 50 edges | `/search`, `/results/` disallowed — category navigation only |
| Home improvement | shadesoflight.com | Bounded crawl `published`: 233 nodes / 263 edges | Path navigation (site robots checked at crawl time by the gate) |
| Skincare | paulaschoice.com | Bounded crawl `published`: 75 nodes / 76 edges | `*/Search-Show`, cart/account/checkout disallowed — category navigation only |

Backups that also published in the same session: builddirect.com (home, 87/96), discounttire.com (auto, 55/77).

## Consequences

- Site configs, classifier fixtures, and bench corpora are authored for the new primaries; the ADR-0001 corpora stay in repo as the record of the original pick.
- Category coverage is narrower than the original trio (lighting-led home improvement, brand-led skincare). That is the honest price of accessible sites; flagship breadth returns in Phase 1 per ADR-0001.
- If any new primary later bot-walls, its published backup is promoted the same way, noted in `docs/site-status.md`.
