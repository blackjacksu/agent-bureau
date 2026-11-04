#!/usr/bin/env node
import { PgClient } from "@agentmap/db";
import { createEmbeddingProviderFromEnv } from "@agentmap/matching";
import { PlaywrightPageFetcher, HttpPageFetcher } from "./crawl/browser-pool.js";
import { crawlSite } from "./crawl/frontier.js";
import { PgGraphStore } from "./emit/publish.js";
import { configForDomain } from "./sites/index.js";
import { limitsFromEnv } from "./sites/site-config.js";
import { parseLegalReviewList } from "./crawl/robots.js";

// One-shot index: node dist/cli.js index <domain> [--http] [--no-sitemap] [--max-pages N]
// Honors robots/opt-out gates exactly like the worker; embeds with the configured provider (EMBEDDING_* env).
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
async function main() {
  const [cmd, domain] = args;
  if (cmd !== "index" || !domain) { console.error("usage: index <domain> [--http] [--no-sitemap] [--max-pages N]"); process.exit(1); }
  const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_URL required");
  const db = PgClient.fromUrl(url); const base = `https://${domain}/`;
  const cfg = configForDomain(domain, base);
  const config = { ...cfg, useSitemap: args.includes("--no-sitemap") ? false : cfg.useSitemap, limitOverrides: { ...cfg.limitOverrides, ...limitsFromEnv(process.env, cfg), ...(flag("max-pages") ? { maxPages: Number(flag("max-pages")) } : {}) } };
  const provider = createEmbeddingProviderFromEnv(process.env);
  console.log(JSON.stringify({ domain, embedding_model: provider.model, sitemap: config.useSitemap !== false }));
  const fetcher = args.includes("--http") ? new HttpPageFetcher() : new PlaywrightPageFetcher();
  try {
    const r = await crawlSite(config, base, { fetcher, store: new PgGraphStore(db), embed: provider, legalReviewRequired: parseLegalReviewList(process.env.LEGAL_REVIEW_REQUIRED) });
    console.log(JSON.stringify({ status: r.status, pages: r.pagesFetched, nodes: r.status === "published" ? r.graph.nodes.length : undefined, edges: r.status === "published" ? r.graph.edges.length : undefined, reason: (r as any).reason }));
  } finally { await (fetcher as any).close?.(); await db.end?.(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
