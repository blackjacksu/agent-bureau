export * from "./verifier.js";
export * from "./extract/price.js";
export * from "./extract/stock.js";
export * from "./extract/status.js";
export * from "./fetch/ssrf.js";
export * from "./fetch/cache.js";
export * from "./fetch/http-fetch.js";
export * from "./fetch/browser-fetch.js";

import { pathToFileURL } from "node:url";
import { LiveVerifier } from "./verifier.js";
import { PlaywrightBrowserFetcher } from "./fetch/browser-fetch.js";

/** Queue/sync worker entry: verifier serves live_check via the VerifierPort shape; as main it self-checks config. */
export async function main(): Promise<void> {
  const verifier = new LiveVerifier({ browserFetcher: new PlaywrightBrowserFetcher({ timeoutMs: Number(process.env.VERIFIER_FETCH_TIMEOUT_MS ?? 8000) }) });
  const url = process.argv[2];
  if (!url) { console.log(JSON.stringify({ service: "verifier", ready: true, cache_ttl_s: Number(process.env.VERIFIER_CACHE_TTL_S ?? 30) })); return; }
  console.log(JSON.stringify(await verifier.handleLiveCheck({ url })));
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
