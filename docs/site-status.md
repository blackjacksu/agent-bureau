# Site status

Living record per plan §21.5. Updated when a domain is indexed, re-indexed, or replaced.

| Domain | Category | Source | map_version | Last indexed | Stale % (7d) | Known quirks |
| --- | --- | --- | --- | --- | --- | --- |
| rockauto.com | Auto parts | ADR-0001 primary | — (superseded by ADR-0003) | — | — | Bounded live crawl 2026-11-02: `blocked: bot_protection`. No evasion attempted (§7.7). Superseded by carparts.com per ADR-0003 |
| fergusonhome.com | Home improvement | ADR-0001 primary | — (superseded by ADR-0003) | — | — | Bounded live crawl 2026-11-02: `blocked: bot_protection`. Superseded by shadesoflight.com per ADR-0003 |
| dermstore.com | Skincare | ADR-0001 primary | — (superseded by ADR-0003) | — | — | Bounded live crawl 2026-11-02: `blocked: bot_protection`. Superseded by paulaschoice.com per ADR-0003 |
| carparts.com | Auto parts | ADR-0003 primary | 2 | 2026-11-02 | — | Indexed live (7,475 nodes); Arm B 20/20 found, 18/20 pattern hit |
| shadesoflight.com | Home improvement | ADR-0003 primary | 1 | 2026-11-02 | — | Indexed live (233 nodes); Arm B 20/20 found, 15/20 pattern hit |
| paulaschoice.com | Skincare | ADR-0003 primary | 1 | 2026-11-02 | — | Indexed live; Arm B 19/20 found, 13/20 pattern hit |
| mini-auto.example | Fixture | plan §17.6 | 1 (fixture) | fixture | — | Test-only fixture site |
| shop.example | Fixture | mcp-server tests | 1 (fixture) | fixture | — | In-memory fixture graph |

Rule: a row moves to a real `map_version`/`last_indexed_at` only from an actual Indexer publish (§7.5) — never hand-filled.
