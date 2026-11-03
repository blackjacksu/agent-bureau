import { crawlArm, type CrawlFlags, type CrawlResult, type FetchText, type HttpCache } from "./crawl-arm.js";

export interface BrowserArmOpts {
  fetchText?: FetchText;
  renderedFetch?: FetchText;
  flags?: CrawlFlags;
  cache?: HttpCache;
}

/**
 * C2: C1 with a browser-rendered fetch fallback. The rendered fetcher is injected
 * (composition root supplies the indexer's Playwright fetcher) so this package
 * never imports the indexer or any graph/DB code.
 */
export async function browserArm(
  startUrl: string,
  question: string,
  opts: BrowserArmOpts = {},
): Promise<CrawlResult & { escalated: boolean }> {
  const http = await crawlArm(startUrl, question, opts);
  const useless = http.stop_reason === "fetch_failed" || (http.pages <= 1 && http.stop_reason === "no_more_links");
  if (!useless || !opts.renderedFetch) return { ...http, escalated: false };
  const rendered = await crawlArm(startUrl, question, { ...opts, fetchText: opts.renderedFetch });
  return { ...rendered, escalated: true };
}
