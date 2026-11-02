import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AgentMapError } from "@agentmap/contracts";
export function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const p = ip.split(".").map(Number); if (p.length !== 4 || p.some(Number.isNaN)) return ip.includes(":");
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
}
export async function assertPublicUrl(raw: string, dnsLookup: (h: string) => Promise<{ address: string }[]> = async (h) => lookup(h, { all: true })) {
  let u: URL; try { u = new URL(raw); } catch { throw new AgentMapError("invalid_input", "url: invalid url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new AgentMapError("invalid_input", "url: http/https only");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new AgentMapError("invalid_input", "url: private host blocked");
  if (isIP(host)) { if (isPrivateIp(host)) throw new AgentMapError("invalid_input", "url: private address blocked"); return u; }
  const addrs = await dnsLookup(host).catch(() => { throw new AgentMapError("upstream_error", "dns lookup failed"); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new AgentMapError("invalid_input", "url: private address blocked");
  return u;
}
type FetchFn = (url: string, init?: any) => Promise<any>;
export class HttpVerifier {
  constructor(private opts: { fetchFn?: FetchFn; timeoutMs?: number; dnsLookup?: (h: string) => Promise<{ address: string }[]> } = {}) {}
  async check(rawUrl: string, _fields?: string[]) {
    let url = await assertPublicUrl(rawUrl, this.opts.dnsLookup);
    const fetchFn: FetchFn = this.opts.fetchFn ?? ((u, i) => fetch(u, i));
    let current = url.toString();
    for (let hop = 0; hop <= 3; hop++) {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
      try {
        const res = await fetchFn(current, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "AgentMapVerifier/0.1" } });
        if ([301, 302, 303, 307, 308].includes(res.status)) { const loc = res.headers.get?.("location"); if (!loc || hop === 3) return base(current, "error"); current = new URL(loc, current).toString(); await assertPublicUrl(current, this.opts.dnsLookup); continue; }
        if (res.status === 404 || res.status === 410) return base(current, "not_found");
        if (res.status === 401 || res.status === 403) return base(current, "blocked");
        if (!res.ok) return base(current, "error");
        const html = await res.text();
        return { ...base(current, "ok"), ...extract(html) };
      } catch (e) { if (e instanceof AgentMapError) throw e; return base(current, "error"); } finally { clearTimeout(timer); }
    }
    return base(current, "error");
  }
}
function base(url: string, status: string) { return { url, status, price: null as null | { amount_minor: number; currency: string }, stock: "unknown" as const, checked_at: new Date().toISOString(), source: "live" as const }; }
export function extract(html: string) {
  let price: { amount_minor: number; currency: string } | null = null; let stock: string = "unknown";
  const ld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ld) { try { const j = JSON.parse(ld[1]!); const offer = Array.isArray(j) ? j[0]?.offers : j?.offers; const o = Array.isArray(offer) ? offer[0] : offer; if (o?.price != null) price = { amount_minor: Math.round(Number(o.price) * 100), currency: String(o.priceCurrency ?? "USD") }; if (o?.availability) stock = /InStock/i.test(String(o.availability)) ? "in_stock" : /OutOfStock/i.test(String(o.availability)) ? "out_of_stock" : stock; } catch {} }
  if (!price) { const m = html.match(/(?:\$|USD\s?)([\d,]+\.\d{2})/); if (m) price = { amount_minor: Math.round(Number(m[1]!.replace(/,/g, "")) * 100), currency: "USD" }; }
  if (/out of stock|sold out/i.test(html)) stock = "out_of_stock"; else if (/only \d+ left/i.test(html)) stock = "low_stock"; else if (stock === "unknown" && /in stock/i.test(html)) stock = "in_stock";
  return { price, stock };
}
export class StubVerifier { constructor(private handler: (url: string) => any) {} async check(url: string) { await assertPublicUrl(url, async () => [{ address: "93.184.216.34" }]).catch((e) => { if (new URL(url).hostname.endsWith("example")) return; throw e; }); return this.handler(url); } }
