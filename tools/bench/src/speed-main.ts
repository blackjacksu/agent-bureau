import { writeFileSync } from "node:fs";
import { loadCorpus, validateCorpus } from "./corpus.js";
import { httpMcpFinder } from "./arms/mcp-arm.js";
import { renderSpeedReport, runSpeedBench } from "./speed-runner.js";

/**
 * Live speed benchmark CLI (plan: crawl vs MCP).
 * Usage: MCP_BASE_URL=http://127.0.0.1:18711 AGENTMAP_API_KEY=am_live_... \
 *   pnpm --filter @agentmap/bench bench:speed corpus/carparts.json corpus/shadesoflight.json corpus/paulaschoice.json
 * Crawl arms fetch live sites directly (robots-polite UA); MCP arm calls the running server.
 * indexing cost is NOT included in per-query times (reported separately in the live write-up).
 */
const base = process.env.MCP_BASE_URL;
const key = process.env.AGENTMAP_API_KEY;
if (!base || !key) { console.error("MCP_BASE_URL and AGENTMAP_API_KEY required"); process.exit(2); }
const files = process.argv.slice(2);
if (!files.length) { console.error("at least one corpus file required"); process.exit(2); }
const tasks = files.flatMap((f) => loadCorpus(f).tasks);
const corpus = validateCorpus({ version: 1, site_kind: "real", tasks });
const results = await runSpeedBench(corpus, { finder: httpMcpFinder(base, key) }, 5);
const md = renderSpeedReport(results);
const out = `docs/bench/${new Date().toISOString().slice(0, 10)}-speed.md`;
writeFileSync(out, md);
console.log(md);
console.log(`wrote ${out} (${results.length} arm-runs)`);
