import { z } from "zod";
import { SiteStatusSchema } from "./graph.js";
import { OfferSchema } from "./offers.js";
export const DomainSchema = z.string().min(1).max(253);
export const StepActionSchema = z.enum(["navigate","click","fill","select","set_vehicle","filter","submit"]);
export const StepSchema = z.object({
  action: StepActionSchema,
  url: z.string().optional(),
  selector: z.string().optional(),
  selector_fallbacks: z.array(z.string()).optional(),
  params: z.record(z.union([z.string(),z.number(),z.boolean()])).optional(),
  purpose: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;
export const LiveCheckFieldSchema = z.enum(["price","stock","availability"]);
// is_mapped
export const IsMappedInputSchema = z.object({ domain: DomainSchema });
export const IsMappedOutputSchema = z.object({ mapped: z.boolean(), map_version: z.number().int().nullable(), last_indexed_at: z.string().datetime().nullable(), status: SiteStatusSchema });
// find
export const FindInputSchema = z.object({ domain: DomainSchema, question: z.string().min(1).max(500) });
export const FindFoundOutputSchema = z.object({ mapped: z.literal(true), found: z.literal(true), steps: z.array(StepSchema), result_url_template: z.string().nullable(), needs_live_check: z.array(LiveCheckFieldSchema), path_id: z.string(), confidence: z.number().min(0).max(1), missing_params: z.array(z.string()), offers: z.array(OfferSchema) });
export const FindNotFoundOutputSchema = z.object({ mapped: z.literal(true), found: z.literal(false), reason: z.enum(["no_path","low_confidence"]) });
export const FindUnmappedOutputSchema = z.object({ mapped: z.literal(false), status: SiteStatusSchema, queue_position: z.number().int().nullable() });
export const FindOutputSchema = z.union([FindFoundOutputSchema,FindNotFoundOutputSchema,FindUnmappedOutputSchema]);
export const FindOutputUnionSchema = FindOutputSchema;
export type FindOutput = z.infer<typeof FindOutputUnionSchema>;
// get_path
export const GetPathInputSchema = z.object({ domain: DomainSchema, goal: z.string().min(1) });
export const GetPathOutputSchema = z.object({ steps: z.array(StepSchema), from_node: z.string(), to_node: z.string(), result_url_template: z.string().nullable() });
// live_check
export const LiveCheckInputSchema = z.object({ url: z.string().url().refine(u=>/^https?:\/\//.test(u),{message:"http/https only"}), fields: z.array(LiveCheckFieldSchema).optional() });
export const LiveCheckOutputSchema = z.object({ url: z.string().url(), status: z.enum(["ok","not_found","blocked","error"]), price: z.object({ amount_minor: z.number().int(), currency: z.string().length(3) }).nullable(), stock: z.enum(["in_stock","low_stock","out_of_stock","unknown"]), checked_at: z.string().datetime(), source: z.enum(["cache","live"]) });
// report_outcome
export const ReportOutcomeInputSchema = z.object({ domain: DomainSchema, path_id: z.string().min(1), success: z.boolean(), failed_step_index: z.number().int().nonnegative().optional(), note: z.string().max(500).optional() });
export const ReportOutcomeOutputSchema = z.object({ acknowledged: z.literal(true), branch_status: z.enum(["ok","marked_stale","reindex_queued"]) });
// request_mapping
export const RequestMappingInputSchema = z.object({ domain: DomainSchema });
export const RequestMappingOutputSchema = z.object({ queued: z.boolean(), queue_position: z.number().int().nullable(), already_mapped: z.boolean() });
// my_sites
export const MySitesInputSchema = z.object({ action: z.enum(["add","remove","list"]), domains: z.array(DomainSchema).max(100).optional() });
export const MySitesOutputSchema = z.object({ sites: z.array(z.object({ domain: z.string(), status: SiteStatusSchema, map_version: z.number().int().nullable() })) });
export const TOOL_NAMES = ["is_mapped","find","get_path","live_check","report_outcome","request_mapping","my_sites"] as const;
export type ToolName = typeof TOOL_NAMES[number];
export const TOOL_DESCRIPTIONS: Record<ToolName,string> = {
  is_mapped: "Check whether a domain is mapped. Use before find to know if a map exists.",
  find: "Answer a shopper question on a mapped domain with executable steps. Price/stock from find are never current — call live_check.",
  get_path: "Return navigation steps between known graph nodes without param binding. Use when you already know the target node, unlike find which binds shopper params.",
  live_check: "Fetch the live price, stock and status for one public URL. Use after find for current values.",
  report_outcome: "Report whether a path succeeded or failed. Failures mark the branch stale.",
  request_mapping: "Request that an unmapped domain be mapped. Returns queue position.",
  my_sites: "Add, remove or list domains you want kept freshest. Capped at 100 per agent.",
};
export const ToolInputSchemas = { is_mapped: IsMappedInputSchema, find: FindInputSchema, get_path: GetPathInputSchema, live_check: LiveCheckInputSchema, report_outcome: ReportOutcomeInputSchema, request_mapping: RequestMappingInputSchema, my_sites: MySitesInputSchema } as const;
export const ToolOutputSchemas = { is_mapped: IsMappedOutputSchema, find: FindOutputUnionSchema, get_path: GetPathOutputSchema, live_check: LiveCheckOutputSchema, report_outcome: ReportOutcomeOutputSchema, request_mapping: RequestMappingOutputSchema, my_sites: MySitesOutputSchema } as const;
