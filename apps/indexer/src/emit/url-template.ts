export const GENERIC_TRACKING_PARAMS = [
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "sid", "session_id", "sessionid",
  "phpsessid", "jsessionid", "_ga", "_gl", "ref", "referrer", "affiliate_id", "click_id",
] as const;

export function isTrackingParam(name: string, extra: readonly string[] = []): boolean {
  const n = name.toLowerCase();
  return n.startsWith("utm_") || (GENERIC_TRACKING_PARAMS as readonly string[]).includes(n) || extra.map((e) => e.toLowerCase()).includes(n);
}

/** Plan 7.4 canonicalization: lowercase host, strip tracking, sort query, drop fragment. */
export function canonicalizeUrl(raw: string, extraTracking: readonly string[] = []): string {
  const u = new URL(raw);
  u.protocol = u.protocol.toLowerCase(); u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !isTrackingParam(k, extraTracking));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  u.pathname = u.pathname.replace(/\/{2,}/g, "/");
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

function looksLikeId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg)) return true; // uuid
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*-\d{3,}$/i.test(seg)) return true; // slug-1234
  if (/^\d+[a-z]+\d+$/i.test(seg)) return true;
  return false;
}
export function collapseIds(pathname: string): string {
  return pathname.split("/").map((s) => (looksLikeId(s) ? "{id}" : s)).join("/");
}

/** Single-URL pattern: {id} collapsing plus query keys rendered as {key} placeholders. */
export function toUrlPattern(raw: string, extraTracking: readonly string[] = []): string {
  const u = new URL(canonicalizeUrl(raw, extraTracking));
  const keys = [...u.searchParams.keys()];
  const q = keys.length ? `?${keys.map((k) => `${k}={${k}}`).join("&")}` : "";
  return `${collapseIds(u.pathname)}${q}`;
}

/** Pattern-frequency analysis: segments/values that vary across same-shape URLs become placeholders. */
export function derivePattern(urls: string[], extraTracking: readonly string[] = []): string {
  if (!urls.length) throw new Error("derivePattern: no urls");
  const parsed = urls.map((u) => new URL(canonicalizeUrl(u, extraTracking)));
  const first = parsed[0]!;
  const segs = first.pathname.split("/");
  const outSegs = segs.map((seg, i) => {
    const all = parsed.map((p) => p.pathname.split("/")[i] ?? "");
    if (all.every((s) => s === seg)) return looksLikeId(seg) && parsed.length > 1 ? "{id}" : seg;
    return "{id}";
  });
  const keys = [...first.searchParams.keys()];
  const q = keys.length ? `?${keys.map((k) => `${k}={${k}}`).join("&")}` : "";
  return `${outSegs.join("/") || "/"}${q}`;
}

export function placeholderNames(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
}

export function renderUrlTemplate(template: string, params: Record<string, string | number | boolean>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    if (!(name in params)) throw new Error(`missing template param: ${name}`);
    return encodeURIComponent(String(params[name]));
  });
}
export function validateTemplate(template: string, paramsSchema: Record<string, unknown>): { ok: boolean; missing: string[] } {
  const missing = placeholderNames(template).filter((p) => !(p in paramsSchema));
  return { ok: missing.length === 0, missing };
}
