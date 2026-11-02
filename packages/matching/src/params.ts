import { normalizeToken, tokenize } from "./normalize.js";
export type ParamValue = string | number;
export interface SchemaInfo { required: string[]; enums: Map<string, string[]>; aliases: Record<string, string>; types: Map<string, string> }
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length; const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function enumOf(v: any): string[] | null {
  if (Array.isArray(v)) return v.map(String);
  if (v && Array.isArray(v.enum)) return v.enum.map(String);
  if (v && Array.isArray(v.anyOf)) { const o = v.anyOf.map((x: any) => x?.const).filter((x: any) => x != null); return o.length ? o.map(String) : null; }
  return null;
}
export function schemaInfoFromEdges(edges: { params_schema?: Record<string, unknown> | null }[]): SchemaInfo {
  const required = new Set<string>(); const enums = new Map<string, string[]>(); const types = new Map<string, string>(); let aliases: Record<string, string> = {};
  for (const e of edges) {
    const ps: any = e.params_schema ?? {};
    if (!ps || typeof ps !== "object") continue;
    if (Array.isArray(ps.required)) ps.required.forEach((r: string) => required.add(String(r)));
    if (ps.aliases && typeof ps.aliases === "object") aliases = { ...aliases, ...ps.aliases };
    const props = ps.properties && typeof ps.properties === "object" ? ps.properties : ps;
    for (const [k, v] of Object.entries<any>(props)) {
      if (["required", "aliases", "type", "$schema"].includes(k)) continue;
      const en = enumOf(v);
      if (en) enums.set(k, [...new Set([...(enums.get(k) ?? []), ...en])]);
      if (v && typeof v === "object" && typeof v.type === "string") types.set(k, v.type);
      if (!en && !required.has(k) && (ps.required?.includes(k))) types.set(k, types.get(k) ?? "string");
    }
    // params named in required but no property entry
    if (Array.isArray(ps.required)) for (const r of ps.required) if (!enums.has(r) && !types.has(r)) types.set(String(r), "string");
  }
  return { required: [...required], enums, aliases, types };
}
export function extractDeterministic(question: string): Record<string, ParamValue> {
  const q = question; const out: Record<string, ParamValue> = {};
  const y = q.match(/\b(1950|19[5-9]\d|20[0-2]\d|2030)\b/); if (y) out.year = Number(y[1]);
  const dim2 = q.match(/\b(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(inch|inches|in|ft|feet|cm|mm)?\b/i);
  const dim1 = q.match(/\b(\d+(?:\.\d+)?)\s*(inch|inches|"|in\b|ft|feet|cm|mm|oz|ml|kg|lb|g)\b/i);
  if (dim2) out.size = `${dim2[1]}x${dim2[2]}${dim2[3] ? " " + dim2[3].toLowerCase().replace("inches", "inch") : ""}`.replace(/\s+/g, " ").trim();
  else if (dim1) out.size = `${dim1[1]} ${dim1[2].toLowerCase().replace("inches", "inch").replace('"', "inch")}`;
  const qty = q.match(/\b(?:pack of|pack|qty|quantity)\s*(\d+)\b/i) ?? q.match(/\b(\d+)\s*-\s*pack\b/i);
  if (qty) out.quantity = Number(qty[1]);
  const pos = q.match(/\b(front|rear|left|right)\b/i); if (pos) out.position = pos[1].toLowerCase();
  return out;
}
export interface ExtractResult { params: Record<string, ParamValue>; missing_params: string[]; coverage: number; schema: SchemaInfo }
export function extractParams(question: string, edges: { params_schema?: Record<string, unknown> | null }[], extraAliases: Record<string, string> = {}): ExtractResult {
  const schema = schemaInfoFromEdges(edges);
  const aliases = { ...schema.aliases, ...extraAliases };
  const det = extractDeterministic(question);
  const params: Record<string, ParamValue> = {};
  const lower = ` ${normalizeToken(question)} `;
  const consumed: [number, number][] = [];
  const overlaps = (s: number, e: number) => consumed.some(([a, b]) => s < b && e > a);
  // Enum matching: longest values first across all params
  const candidates: { param: string; value: string; norm: string }[] = [];
  for (const [param, values] of schema.enums) for (const value of values) candidates.push({ param, value, norm: normalizeToken(value) });
  candidates.sort((a, b) => b.norm.length - a.norm.length);
  for (const c of candidates) {
    if (c.param in params) continue;
    const needle = ` ${c.norm} `; const idx = lower.indexOf(needle);
    if (idx >= 0 && !overlaps(idx, idx + needle.length)) { params[c.param] = c.value; consumed.push([idx, idx + needle.length]); continue; }
    // alias exact
    const aliasHit = Object.entries(aliases).find(([, v]) => v === c.value && lower.includes(` ${normalizeToken(argumentsAliasKey(aliases, c.value))} `));
    void aliasHit;
  }
  // alias pass (alias key -> canonical enum value string)
  for (const [alias, canonical] of Object.entries(aliases)) {
    const entry = candidates.find((c) => c.value === canonical || normalizeToken(c.value) === normalizeToken(canonical));
    if (!entry || entry.param in params) continue;
    const needle = ` ${normalizeToken(alias)} `; const idx = lower.indexOf(needle);
    if (idx >= 0 && !overlaps(idx, idx + needle.length)) { params[entry.param] = entry.value; consumed.push([idx, idx + needle.length]); }
  }
  // Fuzzy single-token pass for enum values that are single tokens
  const toks = tokenize(question);
  for (const [param, values] of schema.enums) {
    if (param in params) continue;
    for (const value of values) {
      const vn = normalizeToken(value); if (vn.includes(" ")) continue;
      const hit = toks.find((t) => t.length >= 4 && vn.length >= 4 && !Object.values(params).map(String).map(normalizeToken).includes(t) && editDistance(t, vn) <= 1);
      if (hit) { params[param] = value; break; }
    }
  }
  // Deterministic fill for known param names present in schema (required/types/enums)
  const known = new Set([...schema.required, ...schema.enums.keys(), ...schema.types.keys()]);
  for (const [k, v] of Object.entries(det)) {
    if (k === "position" && schema.enums.has("position")) continue; // already enum-matched if valid
    if (known.has(k) && !(k in params)) params[k] = v;
    // size synonyms
    if (k === "size") for (const syn of ["dimension", "dimensions", "width", "length"]) if (known.has(syn) && !(syn in params)) { params[syn] = v; break; }
  }
  // year-like required params with different names
  if (det.year != null) for (const k of known) if (/year/i.test(k) && !(k in params)) params[k] = det.year;
  if (det.quantity != null) for (const k of known) if (/quant|qty|count/i.test(k) && !(k in params)) params[k] = det.quantity;
  const missing = schema.required.filter((r) => !(r in params));
  const coverage = schema.required.length ? (schema.required.length - missing.length) / schema.required.length : 1;
  return { params, missing_params: missing, coverage, schema };
}
function argumentsAliasKey(aliases: Record<string, string>, value: string): string { return Object.keys(aliases).find((k) => aliases[k] === value) ?? value; }
export function canonicalQuestion(question: string, params: Record<string, ParamValue>): string {
  let c = normalizeToken(question);
  // strip filler words left after normalizeToken (case lowered)
  c = c.replace(/^(please )?(find|show|get|search for|look for|i need|i want|looking for) (me )?/, "");
  const entries = Object.entries(params).sort((a, b) => String(b[1]).length - String(a[1]).length);
  for (const [k, v] of entries) {
    const nv = normalizeToken(String(v));
    if (nv) c = c.split(nv).join(`{${k}}`);
    // also raw numeric form
    c = c.replace(new RegExp(`\\b${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), `{${k}}`);
  }
  // deterministic leftovers not in params (year/size) also placeholder if key present in string handled above
  return c.replace(/\s+/g, " ").trim();
}
