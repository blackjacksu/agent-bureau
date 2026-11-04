# Recording runbook — operator script

Three terminals + one agent window. Start everything in [README.md](./README.md) first. Times reference [VIDEO-SCRIPT.md](./VIDEO-SCRIPT.md).

## Terminal layout

| Window | Runs | Used in segment |
| --- | --- | --- |
| T1 | MCP server (`pnpm --filter @agentmap/mcp-server start`) | all (background logs) |
| T2 | Admin / SQL checks | 0:50, 1:25 |
| T3 | Indexer worker (`node apps/indexer/dist/index.js`) | 0:50–1:25 (the crawl shot) |
| Agent | Claude Code / Cursor with agentmap MCP | 0:20–2:30 |

## Take order (record in this order, edit into script order)

1. **Crawl take (segment 3) first** — reset the demo domain (README §8), T3 visible, then in the agent ask: *"Find chandeliers for a dining room on shadesoflight.com. If it isn't mapped, request mapping."* Keep the take where node counts climb cleanly. Note the real elapsed seconds for the time-lapse overlay.
2. **Fast takes (segment 5)** — with the map live, ask:
   - *"Find a table lamp for a bedroom on shadesoflight.com"*
   - *"Find a wall sconce light on shadesoflight.com, then live-check the price"*
   - *"What sites do I have mapped?"* (shows `my_sites`/registry breadth if time allows)
3. **Onboarding take (segment 2)** — remove and re-add the MCP server in the agent, list tools.
4. **Benchmark take (segment 6)** — open `docs/bench/2026-11-02-speed.md`, scroll the verdict table. To show *how* the test works, run one arm visibly:

```bash
pnpm --filter @agentmap/bench bench:speed   # needs MCP_BASE_URL + AGENTMAP_API_KEY; full run is minutes — for camera, narrate over the committed report instead
DATABASE_URL=$DATABASE_URL pnpm test         # optional credibility shot: 364 passed
```

5. **Problem take (segment 1)** — record last, any browser agent opening the store raw; overlay a token estimate from the Arm A row (313k median) — label it "benchmark median", not a live count.

## Between takes

- New domain state needed? README §8 reset, then re-run take 1.
- Server/indexer keep running across takes; do not restart T1 (it would drop the in-memory rate limiter state and look like a stall).
- If a take's numbers differ from the script (graph re-indexed), update the narration to the numbers on screen — `docs/site-status.md` is the source of truth, refresh it if you re-index.

## Abort conditions

- Site returns a bot wall on camera → switch demo domain to paulaschoice.com (pre-indexed) and use the kept crawl take; do not retry with different tooling on camera.
- Agent picks the wrong tool (e.g. `get_path` instead of `find`) → keep it if it self-corrects (it's realistic), re-take if it dead-ends.
- Any command shows a real API key → cut and re-issue a fresh demo key before continuing.
