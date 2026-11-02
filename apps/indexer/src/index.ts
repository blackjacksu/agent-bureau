export * from "./crawl/robots.js";
export * from "./crawl/frontier.js";
export * from "./crawl/browser-pool.js";
export * from "./discover/classify.js";
export * from "./discover/page.js";
export * from "./emit/url-template.js";
export * from "./emit/graph-builder.js";
export * from "./emit/publish.js";
export * from "./sites/index.js";
export * from "./jobs/index-domain.js";

import { pathToFileURL } from "node:url";
import { PgClient, claimJob, completeJob, failJob } from "@agentmap/db";
import { parseJobPayload } from "@agentmap/contracts";
import { PlaywrightPageFetcher } from "./crawl/browser-pool.js";
import { PgGraphStore } from "./emit/publish.js";
import { parseLegalReviewList } from "./crawl/robots.js";
import { runIndexDomain, runReindexBranch, runSweepSite } from "./jobs/index-domain.js";

/** Worker entry (plan 7.1): poll Postgres queue, dispatch index jobs. Runs only as main. */
export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for indexer worker");
  const db = PgClient.fromUrl(databaseUrl);
  const store = new PgGraphStore(db);
  const workerId = `indexer-${process.pid}`;
  const baseUrlFor = (domain: string) => `https://${domain}/`;
  for (;;) {
    const job: any = await claimJob(db, workerId);
    if (!job) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    try {
      const payload = parseJobPayload(job.kind, typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload);
      const deps = { fetcher: new PlaywrightPageFetcher(), store, legalReviewRequired: parseLegalReviewList(process.env.LEGAL_REVIEW_REQUIRED) };
      let result;
      if (job.kind === "index_domain") result = await runIndexDomain(payload, baseUrlFor, deps);
      else if (job.kind === "reindex_branch") result = await runReindexBranch(payload, baseUrlFor, deps);
      else if (job.kind === "sweep_site") result = await runSweepSite(payload, baseUrlFor, deps);
      else { await completeJob(db, job.id); continue; }
      if (result.status === "failed") throw new Error(result.reason);
      await completeJob(db, job.id);
    } catch (e) {
      await failJob(db, job.id, job.attempts ?? 1, job.max_attempts ?? 3, e instanceof Error ? e.message : String(e));
    }
  }
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
