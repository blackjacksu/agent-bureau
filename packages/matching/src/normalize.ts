export function normalizeDomain(input: string): string {
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (!s || s.includes(" ") || s.includes("_") || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s) && !s.includes("xn--")) {
    // Allow IDNA/punycode via URL parse below; reject obvious garbage.
    if (!s || /\s/.test(s) || s.includes("_")) throw Object.assign(new Error(`invalid domain: ${input}`), { code: "invalid_input" });
  }
  try { const host = new URL(`http://${s}`).hostname; if (!host || !host.includes(".")) throw new Error("bad"); return host.replace(/^www\./, ""); }
  catch { throw Object.assign(new Error(`invalid domain: ${input}`), { code: "invalid_input" }); }
}
const FILLER: [RegExp, string][] = [
  [/^(please\s+)?(find|show|get|search for|look for|i need|i want|i am looking for|i'm looking for|looking for)\s+(me\s+)?/i, ""],
  [/\bplease\b/gi, " "],
];
export function normalizeQuestion(raw: string): { original: string; text: string; lower: string; tokens: string[] } {
  let text = String(raw).trim().replace(/\s+/g, " ");
  for (const [re, rep] of FILLER) text = text.replace(re, rep).trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  return { original: String(raw), text, lower, tokens: tokenize(lower) };
}
export function tokenize(s: string): string[] { return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
export function normalizeToken(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
