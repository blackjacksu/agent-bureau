import { z } from "zod";
export const JobKindSchema = z.enum(["index_domain","reindex_branch","sweep_site","verify_url"]);
export const JobStatusSchema = z.enum(["queued","running","succeeded","failed","dead"]);
export const IndexDomainPayloadSchema = z.object({ domain: z.string().min(1), reason: z.string().optional() });
export const ReindexBranchPayloadSchema = z.object({ domain: z.string().min(1), node_id: z.string().uuid() });
export const SweepSitePayloadSchema = z.object({ domain: z.string().min(1) });
export const VerifyUrlPayloadSchema = z.object({ url: z.string().url(), domain: z.string().optional(), path_id: z.string().uuid().optional() });
export const JobPayloadSchemas = { index_domain: IndexDomainPayloadSchema, reindex_branch: ReindexBranchPayloadSchema, sweep_site: SweepSitePayloadSchema, verify_url: VerifyUrlPayloadSchema } as const;
export const JobSchema = z.discriminatedUnion("kind",[
  z.object({ kind: z.literal("index_domain"), payload: IndexDomainPayloadSchema }),
  z.object({ kind: z.literal("reindex_branch"), payload: ReindexBranchPayloadSchema }),
  z.object({ kind: z.literal("sweep_site"), payload: SweepSitePayloadSchema }),
  z.object({ kind: z.literal("verify_url"), payload: VerifyUrlPayloadSchema }),
]).and(z.object({ id: z.string().uuid().optional(), status: JobStatusSchema.optional(), attempts: z.number().int().optional(), max_attempts: z.number().int().optional() }));
export type Job = z.infer<typeof JobSchema>;
export function parseJobPayload(kind: z.infer<typeof JobKindSchema>, payload: unknown){ return JobPayloadSchemas[kind].parse(payload); }
