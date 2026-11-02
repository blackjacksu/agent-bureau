import type { Offer } from "@agentmap/contracts";
import type { EligibilityContext, GetOffersArgs, OfferProvider, OfferRecord, OfferTarget } from "./types.js";
export class EmptyOfferProvider implements OfferProvider { async getOffers(_args: GetOffersArgs): Promise<Offer[]> { return []; } }
export function patternMatches(pattern: string, value: string): boolean {
  const esc = pattern.split(/(\{[^}]+\})/g).map((part) => part.startsWith("{") ? "[^/]+" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).join("");
  return new RegExp(`^${esc}$`).test(value);
}
export function appliesToMatches(offer: OfferRecord, target?: OfferTarget): boolean {
  const a = offer.applies_to; if (!a) return true;
  if (a.min_spend_minor != null && (target?.spend_minor == null || target.spend_minor < a.min_spend_minor)) return false;
  if (a.scope === "sitewide") return true;
  if (a.scope === "category") return !!(target?.category_keys?.length && a.category_keys?.some((k) => target.category_keys!.includes(k)));
  // product scope: URL pattern match
  if (a.url_patterns?.length) return !!target?.url_pattern && a.url_patterns.some((p) => patternMatches(p, target.url_pattern!));
  return !!target?.url_pattern;
}
export function isEligible(offer: Offer & { status?: string }, ctx: EligibilityContext, target?: OfferTarget): boolean {
  if (ctx.optedOut || !ctx.offersEnabled || !ctx.domainEnabled || !ctx.tierAllowed) return false;
  const o = offer as OfferRecord;
  if (o.status && o.status !== "active") return false;
  const now = ctx.now.getTime();
  if (o.starts_at && new Date(o.starts_at).getTime() > now) return false;
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= now) return false;
  return appliesToMatches(o, target);
}
export function estimatedSaving(offer: OfferRecord): number {
  const v = offer.discount.value ?? 0;
  return offer.discount.type === "percent" || offer.discount.type === "fixed_amount" ? v : 0;
}
/** Plan 16.4.3: verified saving desc, last_verified desc, success-rate desc. Cap 3. */
export function rankOffers(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => {
    const ra = a as OfferRecord, rb = b as OfferRecord;
    const sv = (rb.verified ? estimatedSaving(rb) : 0) - (ra.verified ? estimatedSaving(ra) : 0); if (sv) return sv;
    const dv = estimatedSaving(rb) - estimatedSaving(ra); if (dv) return dv;
    const lv = String(b.last_verified_at ?? "").localeCompare(String(a.last_verified_at ?? "")); if (lv) return lv;
    return (rb.success_rate ?? 0) - (ra.success_rate ?? 0);
  }).slice(0, 3);
}
export async function getOffers(provider: OfferProvider, args: GetOffersArgs, ctx: EligibilityContext): Promise<Offer[]> {
  // C4: opt-out first, before any provider call.
  if (ctx.optedOut || !ctx.offersEnabled || !ctx.domainEnabled || !ctx.tierAllowed) return [];
  const target: OfferTarget | undefined = args.target ?? (args.targetNode ? { url_pattern: args.targetNode.url_pattern, category_keys: args.targetNode.category_keys } : undefined);
  const all = await provider.getOffers(args);
  return rankOffers(all.filter((o) => isEligible(o, ctx, target)));
}
