export interface RobotsRule { allow: boolean; path: string }
export interface RobotsGroup { agents: string[]; rules: RobotsRule[]; crawlDelaySec: number | null }
export interface ParsedRobots { groups: RobotsGroup[]; sitemaps: string[]; raw: string; fetchedAt: string }

export function parseRobots(text: string, fetchedAt = new Date().toISOString()): ParsedRobots {
  const groups: RobotsGroup[] = []; const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null; let seenRule = false;
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim(); if (!line) continue;
    const idx = line.indexOf(":"); if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase(); const val = line.slice(idx + 1).trim();
    if (key === "sitemap") { sitemaps.push(val); continue; }
    if (key === "user-agent") {
      if (!cur || seenRule) { cur = { agents: [], rules: [], crawlDelaySec: null }; groups.push(cur); seenRule = false; }
      cur.agents.push(val.toLowerCase()); continue;
    }
    if (!cur) { cur = { agents: ["*"], rules: [], crawlDelaySec: null }; groups.push(cur); }
    seenRule = true;
    if (key === "disallow") cur.rules.push({ allow: false, path: val });
    else if (key === "allow") cur.rules.push({ allow: true, path: val });
    else if (key === "crawl-delay") { const n = Number(val); cur.crawlDelaySec = Number.isFinite(n) && n >= 0 ? n : null; }
  }
  return { groups, sitemaps, raw: text ?? "", fetchedAt };
}

function groupFor(parsed: ParsedRobots, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  const token = ua.split("/")[0]!.trim();
  let wildcard: RobotsGroup | null = null;
  for (const g of parsed.groups) {
    if (g.agents.some((a) => a === ua || a === token)) return g;
    if (g.agents.includes("*")) wildcard = wildcard ?? g;
  }
  return wildcard;
}

/** Longest-prefix match wins; Allow wins ties (RFC 9309). Empty Disallow means allow. */
export function isRobotsAllowed(parsed: ParsedRobots, path: string, userAgent = "AgentMapBot"): boolean {
  const g = groupFor(parsed, userAgent); if (!g) return true;
  let best: RobotsRule | null = null;
  for (const r of g.rules) {
    if (r.path === "") continue;
    if (!path.startsWith(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
export function robotsCrawlDelaySec(parsed: ParsedRobots, userAgent = "AgentMapBot"): number | null {
  return groupFor(parsed, userAgent)?.crawlDelaySec ?? null;
}
export function isRootDisallowed(parsed: ParsedRobots, userAgent = "AgentMapBot"): boolean {
  return !isRobotsAllowed(parsed, "/", userAgent);
}

export function parseLegalReviewList(envValue: string | undefined): Set<string> {
  return new Set((envValue ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean));
}

export type GateDecision =
  | { action: "proceed"; crawlDelaySec: number }
  | { action: "blocked"; reason: "robots_root_disallowed" | "bot_protection"; status: "blocked" }
  | { action: "opted_out"; status: "opted_out" }
  | { action: "legal_hold"; status: "queued"; reason: "legal_review_required" };

export interface GateInput {
  domain: string;
  siteStatus?: string | null;
  robots: ParsedRobots | null; // null = fetch failed/malformed-absent -> groups empty behaviour
  legalReviewRequired?: ReadonlySet<string> | string[];
  legalCleared?: boolean;
  userAgent?: string;
}

/** Plan 7.2 gate, run before any page fetch. Opt-out beats robots; legal flag blocks leaving queued. */
export function evaluateGate(input: GateInput): GateDecision {
  const domain = input.domain.toLowerCase().replace(/^www\./, "");
  if (input.siteStatus === "opted_out") return { action: "opted_out", status: "opted_out" };
  const legal = input.legalReviewRequired instanceof Set ? input.legalReviewRequired : new Set(input.legalReviewRequired ?? []);
  if (legal.has(domain) && !input.legalCleared) return { action: "legal_hold", status: "queued", reason: "legal_review_required" };
  if (input.robots && isRootDisallowed(input.robots, input.userAgent)) return { action: "blocked", reason: "robots_root_disallowed", status: "blocked" };
  const delay = input.robots ? robotsCrawlDelaySec(input.robots, input.userAgent) : null;
  return { action: "proceed", crawlDelaySec: Math.max(1, delay ?? 1) };
}

export function detectBotWall(input: { status: number; html?: string; title?: string }): boolean {
  if (input.status === 401 || input.status === 403) return true;
  const text = `${input.title ?? ""} ${input.html?.slice(0, 20000) ?? ""}`;
  return /captcha|are you a robot|verify you are human|access denied|bot detection|challenge-platform/i.test(text);
}
