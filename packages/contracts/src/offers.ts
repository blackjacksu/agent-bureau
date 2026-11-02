import { z } from "zod";
export const DiscountTypeSchema = z.enum(["percent","fixed_amount","free_shipping","bogo","info"]);
export const OfferSourceKindSchema = z.enum(["merchant_direct","affiliate_network","merchant_public_page","merchant_dashboard"]);
export const OfferSchema = z.object({
  offer_id: z.string().min(1),
  code: z.string().nullable(),
  title: z.string().min(1),
  discount: z.object({ type: DiscountTypeSchema, value: z.number().nullable().optional() }),
  expires_at: z.string().datetime().nullable(),
  verified: z.boolean(),
  last_verified_at: z.string().datetime().nullable(),
  source_kind: OfferSourceKindSchema,
  commercial_relationship: z.string(),
  apply_hint: z.string(),
  url: z.string().url().optional(),
});
export type Offer = z.infer<typeof OfferSchema>;
// find_offers tool: defined but NOT registered until Phase 5 (plan 16.6.1)
export const FindOffersInputSchema = z.object({ domain: z.string().min(1), product_url: z.string().url().optional(), category: z.string().optional(), question: z.string().max(500).optional() });
export type FindOffersInput = z.infer<typeof FindOffersInputSchema>;
export const FindOffersOutputSchema = z.object({ offers: z.array(OfferSchema).max(3) });
export type FindOffersOutput = z.infer<typeof FindOffersOutputSchema>;
