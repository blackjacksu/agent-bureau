export interface PageLink { href: string; text: string; ariaLabel?: string; testId?: string; selectorHints: string[] }
export interface PageForm { action: string; method: string; inputs: string[]; isSearch: boolean; selectorHints: string[] }
export interface PageFacet { name: string; options: string[] }
export interface PageSnapshot {
  url: string; status: number; title: string; html: string;
  headings: string[]; links: PageLink[]; forms: PageForm[]; facets: PageFacet[];
  hasProductSchema: boolean; botWall: boolean;
}

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"|'([^']*)'`, "i")); return m?.[1] ?? m?.[2];
}

/** Lightweight HTML structure extraction (structure only: link/facet names, no product copy). */
export function parsePage(html: string, url: string, status = 200): PageSnapshot {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => stripTags(m[1]!)).filter(Boolean);
  const links: PageLink[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1]!, "href"); if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const hints: string[] = [];
    const testId = attr(m[1]!, "data-testid"); if (testId) hints.push(`[data-testid="${testId}"]`);
    const aria = attr(m[1]!, "aria-label"); if (aria) hints.push(`a[aria-label="${aria}"]`);
    const id = attr(m[1]!, "id"); if (id) hints.push(`#${id}`);
    links.push({ href: new URL(href, url).toString(), text: stripTags(m[2]!), ariaLabel: aria, testId, selectorHints: hints });
  }
  const forms: PageForm[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const actionRaw = attr(m[1]!, "action") ?? url;
    const inputs = [...m[2]!.matchAll(/<(?:input|select)\b[^>]*(?:name|id)\s*=\s*"([^"]+)"[^>]*>/gi)].map((x) => x[1]!);
    const isSearch = /search/i.test(`${actionRaw} ${inputs.join(" ")}`) || /type\s*=\s*"search"/i.test(m[2]!);
    const hints: string[] = []; const tid = attr(m[1]!, "data-testid"); if (tid) hints.push(`[data-testid="${tid}"]`);
    forms.push({ action: new URL(actionRaw, url).toString(), method: (attr(m[1]!, "method") ?? "get").toLowerCase(), inputs, isSearch, selectorHints: hints });
  }
  const facets: PageFacet[] = [];
  for (const m of html.matchAll(/data-facet\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/(?:div|section|fieldset)>/gi)) {
    const options = [...m[2]!.matchAll(/data-facet-option\s*=\s*"([^"]+)"/gi)].map((x) => x[1]!);
    if (options.length) facets.push({ name: m[1]!, options });
  }
  const hasProductSchema = /"@type"\s*:\s*"Product"/i.test(html);
  const botWall = status === 401 || status === 403 || /captcha|are you a robot|verify you are human/i.test(html.slice(0, 20000));
  return { url, status, title, html, headings, links, forms, facets, hasProductSchema, botWall };
}
