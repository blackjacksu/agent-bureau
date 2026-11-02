import { assertPublicUrl, type DnsLookup } from "./ssrf.js";

export interface FetchedPage { url: string; status: number; html: string; rung: "http" | "browser" }
type FetchFn = (url: string, init?: any) => Promise<any>;

export interface BrowserFetcherPort { fetchRendered(url: string): Promise<{ status: number; html: string }> }

/** Ladder rung (a): plain HTTP with browser UA, redirects re-checked for SSRF (max 3). */
export class HttpFetcher {
  constructor(private opts: { fetchFn?: FetchFn; timeoutMs?: number; dnsLookup?: DnsLookup } = {}) {}
  async fetch(rawUrl: string): Promise<FetchedPage> {
    let current = (await assertPublicUrl(rawUrl, this.opts.dnsLookup)).toString();
    const fetchFn: FetchFn = this.opts.fetchFn ?? ((u, i) => fetch(u, i));
    for (let hop = 0; hop <= 3; hop++) {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
      try {
        const res = await fetchFn(current, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 AgentMapVerifier/0.1" } });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get?.("location"); if (!loc || hop === 3) return { url: current, status: 0, html: "", rung: "http" };
          current = new URL(loc, current).toString(); await assertPublicUrl(current, this.opts.dnsLookup); continue;
        }
        const html = res.ok || res.status === 404 || res.status === 403 ? await res.text() : "";
        return { url: current, status: res.status, html, rung: "http" };
      } finally { clearTimeout(timer); }
    }
    return { url: current, status: 0, html: "", rung: "http" };
  }
}
