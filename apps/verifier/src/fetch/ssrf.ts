import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:") || /^f[cd]/i.test(ip)) return true;
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return ip.includes(":");
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
}
export type DnsLookup = (h: string) => Promise<{ address: string }[]>;
const defaultLookup: DnsLookup = async (h) => lookup(h, { all: true });

/** Plan 10/15 SSRF guard: http/https only, resolve + block private ranges. Re-call after redirects. */
export async function assertPublicUrl(raw: string, dnsLookup: DnsLookup = defaultLookup): Promise<URL> {
  let u: URL; try { u = new URL(raw); } catch { throw new Error("invalid_input: url: invalid url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid_input: url: http/https only");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("invalid_input: url: private host blocked");
  if (isIP(host)) { if (isPrivateIp(host)) throw new Error("invalid_input: url: private address blocked"); return u; }
  const addrs = await dnsLookup(host).catch(() => { throw new Error("upstream_error: dns lookup failed"); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("invalid_input: url: private address blocked");
  return u;
}
export function isPrivateUrlSync(raw: string): boolean {
  try { const u = new URL(raw); return isIP(u.hostname) ? isPrivateIp(u.hostname) : u.hostname === "localhost" || u.hostname.endsWith(".local"); } catch { return true; }
}
