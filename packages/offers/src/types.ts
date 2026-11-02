import type { Offer } from "@agentmap/contracts";
export interface AppliesTo { scope: "sitewide" | "category" | "product"; url_patterns?: string[]; category_keys?: string[]; min_spend_minor?: number | null }
export type OfferStatus = "active" | "unverified" | "expired" | "revoked" | "merchant_disabled";
/** Internal record: contracts Offer plus Phase-5 fields not yet on the wire. */
export interface OfferRecord extends Offer { status?: OfferStatus; starts_at?: string | null; applies_to?: AppliesTo; success_rate?: number }
export interface OfferTarget { url_pattern?: string; category_keys?: string[]; spend_minor?: number }
export interface GetOffersArgs { domain: string; targetNode?: { url_pattern?: string; category_keys?: string[] }; question?: string; params?: Record<string, unknown>; agentTier?: string; target?: OfferTarget }
export interface OfferProvider { getOffers(args: GetOffersArgs): Promise<Offer[]> }
export interface EligibilityContext { optedOut: boolean; offersEnabled: boolean; domainEnabled: boolean; tierAllowed: boolean; now: Date }
