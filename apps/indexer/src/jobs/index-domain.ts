import { IndexDomainPayloadSchema, ReindexBranchPayloadSchema, SweepSitePayloadSchema } from "@agentmap/contracts";
import { crawlSite, type CrawlResult, type CrawlDeps } from "../crawl/frontier.js";
import { configForDomain } from "../sites/index.js";

export async function runIndexDomain(payload: unknown, baseUrlFor: (domain: string) => string, deps: CrawlDeps): Promise<CrawlResult> {
  const p = IndexDomainPayloadSchema.parse(payload);
  const base = baseUrlFor(p.domain);
  return crawlSite(configForDomain(p.domain, base), base, deps);
}
export async function runReindexBranch(payload: unknown, baseUrlFor: (domain: string) => string, deps: CrawlDeps): Promise<CrawlResult> {
  const p = ReindexBranchPayloadSchema.parse(payload);
  // Phase-0: branch reindex is a bounded full re-crawl of the domain; graph-builder keeps versioning identical.
  // (Subtree-only patch merging is the escalation optimisation in plan 7.5.5, same publish contract.)
  void p.node_id;
  const base = baseUrlFor(p.domain);
  return crawlSite(configForDomain(p.domain, base), base, deps);
}
export async function runSweepSite(payload: unknown, baseUrlFor: (domain: string) => string, deps: CrawlDeps): Promise<CrawlResult> {
  const p = SweepSitePayloadSchema.parse(payload);
  const base = baseUrlFor(p.domain);
  return crawlSite(configForDomain(p.domain, base), base, deps);
}
