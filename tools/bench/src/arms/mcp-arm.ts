/** Arm B adapter: MCP `find` measured identically (tokens = response bytes/4, wall time, 1 call). Finder is injected. */
export interface McpResult { final_url: string | null; tokens: number; wall_ms: number; found: boolean; raw: string }

export async function mcpArm(
  domain: string,
  question: string,
  finder: (domain: string, question: string) => Promise<{ found: boolean; steps?: unknown[]; result_url_template?: string | null; rawText?: string }>,
): Promise<McpResult> {
  const t0 = Date.now();
  const r = await finder(domain, question);
  const raw = r.rawText ?? JSON.stringify(r);
  const stepUrls = (r.steps ?? []).map((s: any) => s?.url ?? "").filter(Boolean);
  return {
    final_url: r.result_url_template ?? stepUrls.at(-1) ?? null,
    tokens: Math.ceil(raw.length / 4),
    wall_ms: Math.max(0, Date.now() - t0),
    found: !!r.found,
    raw,
  };
}

/** HTTP finder against a running MCP server (composition root passes base + key). */
export function httpMcpFinder(base: string, apiKey: string) {
  return async (domain: string, question: string) => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find", arguments: { domain, question } } }),
    });
    const text = await r.text();
    const out = JSON.parse(text).result?.structuredContent ?? {};
    return { ...out, rawText: text };
  };
}
