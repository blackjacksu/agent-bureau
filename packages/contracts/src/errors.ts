import { z } from "zod";
export const ErrorCodeSchema = z.enum(["invalid_input","unauthorized","rate_limited","domain_blocked","not_found","upstream_error","internal"]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ERROR_DEFS: Record<ErrorCode,{retryable:boolean;jsonRpcCode:number}> = {
  invalid_input:{retryable:false,jsonRpcCode:-32602},
  unauthorized:{retryable:false,jsonRpcCode:-32001},
  rate_limited:{retryable:true,jsonRpcCode:-32002},
  domain_blocked:{retryable:false,jsonRpcCode:-32003},
  not_found:{retryable:false,jsonRpcCode:-32004},
  upstream_error:{retryable:true,jsonRpcCode:-32005},
  internal:{retryable:false,jsonRpcCode:-32603},
};
export const McpErrorDataSchema = z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean(), retry_after_ms: z.number().int().nonnegative().optional() });
export type McpErrorData = z.infer<typeof McpErrorDataSchema>;
export const JsonRpcErrorSchema = z.object({ code: z.number().int(), message: z.string(), data: McpErrorDataSchema });
export function makeError(code: ErrorCode, message: string, retry_after_ms?: number) {
  const def = ERROR_DEFS[code];
  const data: McpErrorData = { code, message, retryable: def.retryable, ...(retry_after_ms!==undefined?{retry_after_ms}:{}) };
  return { code: def.jsonRpcCode, message, data };
}
export class AgentMapError extends Error { code: ErrorCode; retry_after_ms?: number; constructor(code: ErrorCode, message: string, retry_after_ms?: number){ super(message); this.code=code; this.retry_after_ms=retry_after_ms; } toJsonRpc(){ return makeError(this.code,this.message,this.retry_after_ms); } }
