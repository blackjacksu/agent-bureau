# Video script — AgentMap in 3 minutes

**Format:** screen recording + voiceover (or captions). Total runtime **3:00**. Demo site: shadesoflight.com.
**Story:** an agent browses raw and pays full price → onboards the MCP → first question triggers a live crawl and builds the site map → the same questions come back in milliseconds → benchmark proves it, with the caveat stated out loud.

| Time | Segment | Screen | Voiceover (narration) |
| --- | --- | --- | --- |
| 0:00–0:20 | **The problem** | Browser agent opening a lighting store raw: HTML scrolling, token counter climbing | "Every time an AI agent visits a website, it re-reads the whole site from scratch — hundreds of thousands of tokens, every single time. AgentMap pays that cost once, and shares the map." |
| 0:20–0:50 | **Onboarding the MCP** | Terminal: `claude mcp add agentmap …`; agent lists 7 tools | "Onboarding takes one command. The agent now has seven new tools: check if a site is mapped, find a path, verify a live price, report back what worked." |
| 0:50–1:25 | **First time: the crawl** | Agent asks "chandeliers for a dining room" on the unmapped site → `is_mapped: false` → `request_mapping`. Cut to indexer terminal: Playwright crawling, page/node counts climbing. **Time-lapse this segment** (real index: seconds–tens of seconds) | "First visit, there's no map yet — so AgentMap goes and makes one. It crawls the site politely, learns the navigation, the categories, the filters, and builds a graph of how the site works." |
| 1:25–1:50 | **The map exists** | Graph/site row lands: node + edge counts (233 nodes / 263 edges for shadesoflight), `docs/site-status.md` row flips to mapped v1 | "That graph is now shared. Not cached pages — a map: how to get anywhere on this site, with the parameters filled in." |
| 1:50–2:30 | **Second time: fast** | Same agent, new questions: "table lamp for a bedroom", "wall sconce light" → `find` returns steps + result URL instantly; `live_check` confirms a live price | "Now the agent just asks. Milliseconds, a few hundred tokens, straight to the right category — and prices are still checked live, never served stale from the map. Every answer makes the map better: successes and failures feed back automatically." |
| 2:30–3:00 | **The benchmark** | Benchmark chart from `docs/bench/2026-11-02-speed.md`: four arms, then the verdict lines | "We benchmark it the hard way: same 60 real shopping tasks, a naive crawler, an optimized crawler, a browser crawler, and AgentMap — judged identically. The map answers 98% of tasks at about 250 tokens each; raw browsing needs hundreds of thousands. Where crawling honestly wins — brand-new sites — the crawl is how the map gets built in the first place." End card: "AgentMap — crawl once, share the map." |

## Shooting notes

- **Record segments separately.** The crawl (0:50–1:25) is the only unpredictable part; record it first, keep the best take, edit it in as a time-lapse with the real elapsed time shown on screen (do not fake the duration — show a clock overlay).
- **Fallbacks:** if live indexing stalls or the site bot-walls mid-record, cut to paulaschoice.com (pre-indexed, map v1) for segments 4–5 and narrate the crawl from the kept take. Never re-shoot around a bot wall with evasion tooling.
- **Honesty beats to keep in the cut:** "prices still checked live" (1:50) and the benchmark caveat (2:30). Cutting them makes the video a sales clip and contradicts `docs/bench` claims.
- **Numbers on screen must match the reports:** 233/263 nodes (shadesoflight), 98% found / 77% exact-target (60 tasks), ~250 median tokens (Arm B), 312k median tokens (naive crawl). If graphs are re-indexed before recording, re-read `docs/site-status.md` and use the fresh counts.
- **Captions:** burn in tool names (`is_mapped`, `find`, `live_check`) — viewers skim for these.
- **Length discipline:** narration above is ~170 words/minute at normal pace; if a segment overruns, cut segment 1's middle, never the benchmark caveat.
