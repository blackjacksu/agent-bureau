import type { BrowserFetcherPort } from "./http-fetch.js";
import { assertPublicUrl, type DnsLookup } from "./ssrf.js";

/** Ladder rung (b): Playwright render, dynamically loaded. Throws clear error if unavailable. */
export class PlaywrightBrowserFetcher implements BrowserFetcherPort {
  private browser: any = null;
  constructor(private opts: { timeoutMs?: number; dnsLookup?: DnsLookup } = {}) {}
  async fetchRendered(url: string): Promise<{ status: number; html: string }> {
    await assertPublicUrl(url, this.opts.dnsLookup);
    let pw: any;
    try { pw = await import("playwright"); } catch { throw new Error("playwright_not_installed: install playwright + `npx playwright install chromium`"); }
    if (!this.browser) this.browser = await pw.chromium.launch({ headless: true });
    const page = await this.browser.newPage();
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.opts.timeoutMs ?? 8000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      return { status: res?.status() ?? 200, html: await page.content() };
    } finally { await page.close().catch(() => {}); }
  }
  async close() { await this.browser?.close().catch(() => {}); this.browser = null; }
}
export async function playwrightAvailable(): Promise<boolean> {
  try { await import("playwright"); return true; } catch { return false; }
}
