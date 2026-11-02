import type { GraphNode } from "@agentmap/contracts";

export type NodeKind = GraphNode["kind"];
export interface KindRule { pattern: string; kind: NodeKind }
export interface PageSignals {
  hasSearchForm?: boolean; hasFacets?: boolean; hasProductSchema?: boolean;
  hasCartForm?: boolean; headings?: string[]; facetNames?: string[];
}

const GENERIC_RULES: { re: RegExp; kind: NodeKind }[] = [
  { re: /(^|\/)(cart|basket|checkout)(\/|$)/i, kind: "cart" },
  { re: /(^|\/)(search|results)(\/|$)/i, kind: "search" },
  { re: /[?&](q|query|keyword|search)=/i, kind: "search" },
  { re: /(^|\/)(product|products|item|p|dp)\/[^/]/i, kind: "product" },
  { re: /(^|\/)(category|categories|catalog|shop|department|browse)(\/|$)/i, kind: "category" },
];

/** Plan 7.4 ordered classifier: site rules -> generic URL -> form/facet -> headings -> other. Pure. */
export function classifyKind(url: string, signals: PageSignals = {}, siteRules: KindRule[] = []): NodeKind {
  let path = url;
  try { const u = new URL(url); path = `${u.pathname}${u.search}`; } catch { /* keep raw */ }
  if (path === "/" || path === "") return "home";
  for (const r of siteRules) { if (new RegExp(r.pattern, "i").test(path)) return r.kind; }
  for (const r of GENERIC_RULES) { if (r.re.test(path)) return r.kind; }
  if (signals.hasProductSchema) return "product";
  if (signals.hasSearchForm && /(^|\/)(search|results)/i.test(path)) return "search";
  if (signals.hasFacets) return "category";
  if (signals.hasCartForm) return "cart";
  if (signals.hasSearchForm) return "search";
  const h = (signals.headings ?? []).join(" ").toLowerCase();
  if (/\bsearch results\b/.test(h)) return "search";
  if (/\bshopping cart\b/.test(h)) return "cart";
  return "other";
}

export interface SelectorCandidate { selector: string; kind?: "testid" | "data" | "aria" | "id" | "css" | "class" }

export function isGeneratedSelector(selector: string): boolean {
  // Hash/generated classes & ids: css-1a2b3c, sc-xxxx, xxx__hash, long hex suffixes
  if (/(^|[.#\s])(css|sc|emotion)-[a-z0-9]{5,}\b/i.test(selector)) return true;
  if (/__[a-z0-9]{5,}$/i.test(selector)) return true;
  if (/\.[a-zA-Z_-]+-[a-f0-9]{6,}\b/.test(selector)) return true;
  if (/#[a-z]+-[a-f0-9]{8,}\b/i.test(selector)) return true;
  if (/\.[a-z]{1,3}[A-Z][a-zA-Z]{4,}\d/.test(selector)) return false; // camelCase alone is not proof
  return false;
}

function inferKind(s: string): NonNullable<SelectorCandidate["kind"]> {
  if (/data-testid|data-test-id|data-cy/.test(s)) return "testid";
  if (/\[data-/.test(s)) return "data";
  if (/\[role=|\[aria-label/.test(s)) return "aria";
  if (/^#[\w-]+$/.test(s)) return "id";
  return "css";
}
const SCORE: Record<string, number> = { testid: 100, data: 90, aria: 80, id: 70, css: 40, class: 30 };

/** Plan 7.4 ranking: data-testid -> ARIA -> stable id -> scoped CSS; generated selectors rejected. */
export function rankSelectors(candidates: (string | SelectorCandidate)[]): { primary: string | null; fallbacks: string[]; ranked: string[] } {
  const norm = candidates.map((c) => (typeof c === "string" ? { selector: c, kind: inferKind(c) } : { selector: c.selector, kind: c.kind ?? inferKind(c.selector) }));
  const usable = norm.filter((c) => c.selector.trim() && !isGeneratedSelector(c.selector));
  usable.sort((a, b) => (SCORE[b.kind] ?? 0) - (SCORE[a.kind] ?? 0));
  const ranked = [...new Set(usable.map((c) => c.selector))];
  return { primary: ranked[0] ?? null, fallbacks: ranked.slice(1, 4), ranked };
}
