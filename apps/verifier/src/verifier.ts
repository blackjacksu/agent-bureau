import { LiveCheckInputSchema, LiveCheckOutputSchema } from "@agentmap/contracts";
import type { LiveCheckOutput } from "./verifier-types.js";
import { extractJsonLd, extractMetaPrice, extractHeuristicPrice, extractSelectorPrice, type PriceValue } from "./extract/price.js";
import { extractStock, stockFromAvailability, type Stock } from "./extract/stock.js";
import { statusFromHttp } from "./extract/status.js";
import { HttpFetcher, type BrowserFetcherPort } from "./fetch/http-fetch.js";
import { InMemoryVerifyCache, type VerifyCachePort } from "./fetch/cache.js";
import type { DnsLookup } from "./fetch/ssrf.js";

export interface ExtractResult { price: PriceValue | null; stock: Stock; source: "json_ld" | "selector" | "heuristic" | "none"; extractorConflict: boolean }

/** JSON-LD first, then meta/selector, then heuristic. Heuristic-only low confidence -> caller may null price. */
export function extractFromHtml(html: string, opts: { priceSelectors?: string[]; stockPhrases?: { phrase: string; stock: Stock }[] } = {}): ExtractResult {
  const ld = extractJsonLd(html);
  const ldStock = stockFromAvailability(ld.availability);
  const selectorPrice = extractSelectorPrice(html, opts.priceSelectors) ?? extractMetaPrice(html) ?? extractHeuristicPrice(html);
  let price: PriceValue | null = null; let source: ExtractResult["source"] = "none"; let conflict = false;
  if (ld.price) {
    price = ld.price; source = "json_ld";
    if (selectorPrice && Math.abs(selectorPrice.amount_minor - ld.price.amount_minor) > 1 && selectorPrice.currency === ld.price.currency) conflict = true;
  } else if (selectorPrice) { price = selectorPrice; source = "selector"; }
  else {
    const h = extractHeuristicPrice(html);
    if (h) { price = h; source = "heuristic"; }
  }
  const stock = ldStock !== "unknown" ? ldStock : extractStock(html, opts.stockPhrases);
  return { price, stock, source, extractorConflict: conflict };
}

export interface VerifierMetrics { extractorConflicts: number; conflictsByDomain: Record<string, number>; lastRung?: string }

export interface LiveVerifierOptions {
  fetchFn?: (url: string, init?: any) => Promise<any>;
  browserFetcher?: BrowserFetcherPort;
  cache?: VerifyCachePort;
  cacheTtlSec?: number;
  timeoutMs?: number;
  dnsLookup?: DnsLookup;
  now?: () => number;
  priceSelectors?: string[];
  onExtractorConflict?: (domain: string) => void;
}

/**
 * Plan 10 Live Verifier. Fetch ladder HTTP -> Playwright, 30s cache,
 * SSRF guard, JSON-LD-first normalization to minor units.
 * Satisfies the mcp-server VerifierPort shape: check(url, fields) -> LiveCheckOutput.
 * The MCP server calls this shape across its boundary (it never imports this app, plan 3.3).
 */
export class LiveVerifier {
  readonly metrics: VerifierMetrics = { extractorConflicts: 0, conflictsByDomain: {} };
  private cache: VerifyCachePort;
  private http: HttpFetcher;
  constructor(private opts: LiveVerifierOptions = {}) {
    const ttlSec = opts.cacheTtlSec ?? Number(process.env.VERIFIER_CACHE_TTL_S ?? 30);
    this.cache = opts.cache ?? new InMemoryVerifyCache(ttlSec * 1000, opts.now);
    this.http = new HttpFetcher({ fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs, dnsLookup: opts.dnsLookup });
  }

  async check(rawUrl: string, _fields?: string[]): Promise<LiveCheckOutput> {
    const input = LiveCheckInputSchema.parse({ url: rawUrl, fields: _fields });
    const cached = await this.cache.get(input.url);
    if (cached) return LiveCheckOutputSchema.parse(cached);
    let result: LiveCheckOutput;
    try {
      const page = await this.http.fetch(input.url);
      const status = statusFromHttp(page.status, page.html);
      let extracted = extractFromHtml(page.html, { priceSelectors: this.opts.priceSelectors });
      let finalStatus = status;
      // Ladder: if HTTP rung found no price/stock markers and page may need JS, try browser
      const needsBrowser = status === "ok" && !extracted.price && extracted.stock === "unknown" && this.opts.browserFetcher;
      if (needsBrowser) {
        try {
          const rendered = await this.opts.browserFetcher!.fetchRendered(page.url);
          this.metrics.lastRung = "browser";
          const ex2 = extractFromHtml(rendered.html, { priceSelectors: this.opts.priceSelectors });
          if (ex2.price || ex2.stock !== "unknown") extracted = ex2;
          finalStatus = statusFromHttp(rendered.status, rendered.html);
        } catch { /* give up ladder -> keep http result (status error only if http also failed) */ }
      } else this.metrics.lastRung = "http";
      if (extracted.extractorConflict) {
        this.metrics.extractorConflicts++;
        let domain = "unknown"; try { domain = new URL(input.url).hostname; } catch {}
        this.metrics.conflictsByDomain[domain] = (this.metrics.conflictsByDomain[domain] ?? 0) + 1;
        this.opts.onExtractorConflict?.(domain);
      }
      // Heuristic-only: keep price only when unambiguous parse succeeded (ranges already nulled in parser)
      result = {
        url: page.url, status: finalStatus,
        price: finalStatus === "ok" ? extracted.price : null,
        stock: finalStatus === "ok" ? extracted.stock : "unknown",
        checked_at: new Date(this.opts.now ? this.opts.now() : Date.now()).toISOString(),
        source: "live",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("invalid_input")) throw e;
      result = { url: input.url, status: "error", price: null, stock: "unknown", checked_at: new Date().toISOString(), source: "live" };
    }
    const parsed = LiveCheckOutputSchema.parse(result);
    if (parsed.status === "ok") await this.cache.set(input.url, parsed);
    return parsed;
  }

  /** live_check tool handler (contracts-validated in/out). */
  async handleLiveCheck(input: unknown): Promise<LiveCheckOutput> {
    const parsed = LiveCheckInputSchema.parse(input);
    return this.check(parsed.url, parsed.fields);
  }
}
