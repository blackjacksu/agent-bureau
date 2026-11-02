/**
 * Arm A raw-browsing proxy (plan §18.2): a deterministic greedy browser with no map.
 * It reads full raw HTML pages (what a browsing agent ingests into context), follows the
 * link whose text/URL best matches the question tokens, and stops when it reaches a URL
 * containing the expected pattern or after maxSteps pages. This is a *proxy* for an LLM
 * browsing agent (same pages, same token load, no language-model judgement) — labelled
 * as such in reports, never presented as an LLM run.
 */
export interface RawBrowseResult { success: boolean; tokens: number; pages: number; wall_ms: number; final_url: string }

const STOP = new Set(["a", "an", "the", "for", "me", "find", "please", "i", "need", "want", "to", "of", "on", "in", "with", "my"]);
const stem = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).map(stem);

export function extractLinks(html: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1]!, base).toString();
      out.push({ url, text: m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    } catch { /* skip bad href */ }
  }
  return out;
}

export async function rawBrowse(
  startUrl: string,
  question: string,
  expectedPattern: string,
  opts: { maxSteps?: number; fetchText?: (url: string) => Promise<{ status: number; text: string }>; delayMs?: number } = {},
): Promise<RawBrowseResult> {
  const fetchText = opts.fetchText ?? (async (url: string) => {
    const r = await fetch(url, { headers: { "user-agent": "AgentMapBot/0.1 (+https://agentmap.example/bot)" } });
    return { status: r.status, text: await r.text() };
  });
  const maxSteps = opts.maxSteps ?? 6;
  const qTokens = new Set(tokens(question));
  const t0 = Date.now();
  let current = startUrl;
  let totalTokens = 0;
  const visited = new Set<string>();
  for (let step = 0; step < maxSteps; step++) {
    if (visited.has(current)) break;
    visited.add(current);
    const { status, text } = await fetchText(current).catch(() => ({ status: 0, text: "" }));
    if (status !== 200 || !text) break;
    totalTokens += Math.ceil(text.length / 4);
    if (current.toLowerCase().includes(expectedPattern.toLowerCase())) {
      return { success: true, tokens: totalTokens, pages: step + 1, wall_ms: Date.now() - t0, final_url: current };
    }
    const links = extractLinks(text, current).filter((l) => l.url.startsWith("http") && !visited.has(l.url));
    let best: { url: string; score: number } | null = null;
    for (const l of links) {
      const lt = tokens(`${l.text} ${new URL(l.url).pathname}`);
      const score = lt.filter((t) => qTokens.has(t)).length;
      if (!best || score > best.score) best = { url: l.url, score };
    }
    if (!best || best.score === 0) break;
    current = best.url;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return { success: current.toLowerCase().includes(expectedPattern.toLowerCase()), tokens: totalTokens, pages: visited.size, wall_ms: Date.now() - t0, final_url: current };
}
