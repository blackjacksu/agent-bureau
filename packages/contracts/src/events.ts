import { z } from "zod";
export const EventTypeSchema = z.enum(["query","path_used","step_failed","live_check","outcome","auth_rejected","offers_served"]);
export type EventType = z.infer<typeof EventTypeSchema>;
const base = { confidence_bucket: z.string().optional(), stale: z.boolean().optional(), error_code: z.string().optional() };
export const EventMetadataSchemas: Record<z.infer<typeof EventTypeSchema>, z.ZodTypeAny> = {
  query: z.object({...base}).strict(), path_used: z.object({...base}).strict(), step_failed: z.object({...base, failed_step_index: z.number().int().nonnegative().optional()}).strict(),
  live_check: z.object({...base, source: z.enum(["cache","live"]).optional()}).strict(), outcome: z.object({...base, success: z.boolean().optional()}).strict(),
  auth_rejected: z.object({...base}).strict(), offers_served: z.object({ offer_ids: z.array(z.string()), domain: z.string(), via: z.enum(["find","find_offers"]) }).strict(),
};
export const EventSchema = z.object({ id: z.number().int().optional(), agent_id: z.string().uuid().nullable(), domain: z.string().nullable(), type: EventTypeSchema, path_id: z.string().uuid().nullable().optional(), question_hash: z.string().nullable().optional(), latency_ms: z.number().int().nullable().optional(), tokens_saved_estimate: z.number().int().nullable().optional(), metadata: z.record(z.unknown()).default({}), created_at: z.string().datetime().optional() });
export type AgentEvent = z.infer<typeof EventSchema>;
export function validateEventMetadata(type: EventType, metadata: unknown){ return EventMetadataSchemas[type].parse(metadata ?? {}); }
