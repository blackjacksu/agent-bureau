/**
 * Sitemap discovery (Angle 3). Merchants publish sitemaps for crawlers; seeding the frontier from them
 * finds category/product shapes that link-walking from a few pages never reaches.
 * Bounded and polite: robots-listed sitemaps only (or /sitemap.xml), a few files, no gzip, never fatal.
 */
export interface SitemapFetch { (url: string): Promise<{ status: number; text: string }> }
export interface SitemapOptions { maxUrls?: number; maxFiles?: number; sleep?: (ms: number) => Promise<void>; delayMs?: number }

const LOC = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;

export function parseSitemapXml(xml: string): { urls: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  for (const m of xml.matchAll(LOC)) locs.push(m[1]!.replace(/&amp;/g, "&").trim());
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Path "shape": numbers/long slugs collapse so 5,000 product URLs count as one group. */
export function pathShape(url: string): string {
  let p: string; try { p = new URL(url).pathname; } catch { return ""; }
  const segs = p.split("/").filter(Boolean);
  if (segs.length <= 1) return `/${segs[0] ?? ""}`;
  return "/" + segs.map((s, i) => (i === 0 ? s : /\d/.test(s) || s.length > 24 ? "{x}" : s)).join("/");
}

/** Round-robin across path shapes (shorter paths first, one URL per shape per round) so one huge product list can't crowd out category pages. */
export function selectDiverseUrls(urls: string[], max: number): string[] {
  const groups = new Map<string, string[]>();
  for (const u of [...new Set(urls)]) { const g = pathShape(u); (groups.get(g) ?? groups.set(g, []).get(g)!).push(u); }
  const ordered = [...groups.entries()].sort((a, b) => a[0].split("/").length - b[0].split("/").length || a[0].localeCompare(b[0]));
  const out: string[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const [, us] of ordered) { if (out.length >= max) break; if (us[round]) { out.push(us[round]!); added = true; } }
    if (!added) break;
  }
  return out;
}

const bare = (h: string) => h.replace(/^www\./i, "").toLowerCase();

export async function discoverSitemapUrls(fetchText: SitemapFetch, origin: string, robotsSitemaps: string[], opts: SitemapOptions = {}): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? 300, maxFiles = opts.maxFiles ?? 8, sleep = opts.sleep ?? (async () => {});
  const host = bare(new URL(origin).host);
  const sameSite = (u: string) => { try { return bare(new URL(u).host) === host; } catch { return false; } };
  const queue = (robotsSitemaps.length ? robotsSitemaps : [`${origin}/sitemap.xml`])
    .map((s) => { try { return new URL(s, origin).toString(); } catch { return ""; } }).filter((s) => s && sameSite(s));
  const seenFiles = new Set<string>(); const urls: string[] = []; let files = 0;
  while (queue.length && files < maxFiles && urls.length < maxUrls * 20) {
    const sm = queue.shift()!;
    if (seenFiles.has(sm) || /\.gz($|\?)/i.test(sm)) continue;
    seenFiles.add(sm);
    if (files > 0 && opts.delayMs) await sleep(opts.delayMs);
    files++;
    let res; try { res = await fetchText(sm); } catch { continue; }
    if (res.status >= 400) continue;
    const parsed = parseSitemapXml(res.text);
    urls.push(...parsed.urls.filter(sameSite));
    // Child sitemaps: skip obvious non-shop content; the rest is fetched breadth-first within the file budget.
    for (const c of parsed.sitemaps) if (sameSite(c) && !/blog|news|article|post/i.test(c)) queue.push(c);
  }
  return selectDiverseUrls(urls, maxUrls).map((u) => { const x = new URL(u); return `${origin}${x.pathname}${x.search}`; });
}
