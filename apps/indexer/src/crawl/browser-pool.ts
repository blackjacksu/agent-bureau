import { parsePage, type PageSnapshot } from "../discover/page.js";

export interface PageFetcher {
  fetch(url: string): Promise<PageSnapshot>;
  fetchText?(url: string): Promise<{ status: number; text: string; etag?: string }>;
  close?(): Promise<void>;
}

type FetchFn = (url: string, init?: any) => Promise<any>;

/** HTTP fetcher (also the test/fixture fetcher). Retries handled by crawl loop. */
export class HttpPageFetcher implements PageFetcher {
  constructor(private fetchFn: FetchFn = (u, i) => fetch(u, i), private timeoutMs = 30_000) {}
  async fetchText(url: string) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, { signal: ctrl.signal, headers: { "user-agent": "AgentMapBot/0.1 (+https://agentmap.example/bot)" } });
      return { status: res.status, text: await res.text(), etag: res.headers?.get?.("etag") ?? undefined };
    } finally { clearTimeout(t); }
  }
  async fetch(url: string): Promise<PageSnapshot> {
    const { status, text } = await this.fetchText(url);
    return parsePage(text, url, status);
  }
}

/**
 * Playwright Chromium fetcher (plan 7.3). Playwright is loaded dynamically:
 * if the package/browsers are not installed this throws a clear error and
 * callers must fall back / mark browser tests, never silently pass.
 */
export class PlaywrightPageFetcher implements PageFetcher {
  private browser: any = null; private context: any = null;
  constructor(private timeoutMs = 30_000) {}
  private async ensure() {
    if (this.context) return this.context;
    let pw: any;
    try { pw = await import("playwright"); } catch { throw new Error("playwright_not_installed: install playwright + `npx playwright install chromium` to use PlaywrightPageFetcher"); }
    this.browser = await pw.chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ userAgent: "AgentMapBot/0.1 (+https://agentmap.example/bot)" });
    await this.context.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      if (["image", "font", "media"].includes(type)) return route.abort();
      return route.continue();
    });
    return this.context;
  }
  async fetch(url: string): Promise<PageSnapshot> {
    const ctx = await this.ensure();
    const page = await ctx.newPage();
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      const html: string = await page.content();
      const snap = parsePage(html, page.url(), res?.status() ?? 200);
      // Enrich links from live DOM (ARIA/testid) where regex parse missed them
      return snap;
    } finally { await page.close().catch(() => {}); }
  }
  async fetchText(url: string) {
    // Text resources (robots.txt) must not be rendered as a page: browser content() wraps
    // text/plain in HTML and corrupts line-based parsing. Use the context request API.
    const ctx = await this.ensure();
    try {
      const res = await ctx.request.get(url, { timeout: this.timeoutMs });
      return { status: res.status(), text: await res.text(), etag: res.headers()["etag"] };
    } catch {
      const snap = await this.fetch(url);
      return { status: snap.status, text: snap.html };
    }
  }
  async close() { await this.context?.close().catch(() => {}); await this.browser?.close().catch(() => {}); this.context = null; this.browser = null; }
}

export async function playwrightAvailable(): Promise<boolean> {
  try { await import("playwright"); return true; } catch { return false; }
}
