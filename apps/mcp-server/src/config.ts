import { z } from "zod";
const Env = z.object({
  MCP_PORT: z.coerce.number().int().positive().default(8080),
  MCP_PUBLIC_URL: z.string().default("http://localhost:8080"),
  MCP_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  API_KEY_PEPPER: z.string().min(1).default("dev-only-pepper-change-me"),
  DATABASE_URL: z.string().optional(),
  OFFERS_ENABLED: z.string().default("false").transform((v) => v === "true"),
  LOG_LEVEL: z.string().default("info"),
});
export type AppConfig = z.infer<typeof Env> & { allowedOrigins: string[] };
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.parse(env);
  return { ...parsed, allowedOrigins: parsed.MCP_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) };
}
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (!s || s.includes(" ") || s.includes("_") || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) {
    throw Object.assign(new Error(`invalid domain: ${input}`), { code: "invalid_input" });
  }
  try { return new URL(`http://${s}`).hostname; } catch { throw Object.assign(new Error(`invalid domain: ${input}`), { code: "invalid_input" }); }
}
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.replace(/am_live_[A-Za-z0-9_]+/g, "am_live_[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /api[-_]?key|authorization|pepper|secret|note|question/i.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}
export function logLine(obj: Record<string, unknown>): string { return JSON.stringify(scrub({ ts: new Date().toISOString(), ...obj })); }
