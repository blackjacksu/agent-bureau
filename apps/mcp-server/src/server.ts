import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { AgentMapError, TOOL_DESCRIPTIONS, TOOL_NAMES, ToolInputSchemas, FindOffersInputSchema } from "@agentmap/contracts";
import { computeTrustScore } from "./trust.js";
import type { Store } from "./store.js";
import { Services, CollectingEventSink, type EventSink } from "./services.js";
import { authenticate, TokenBucketRateLimiter, errorToHttp, zodToAgentError, type AuthContext } from "./middleware.js";
import { logLine } from "./config.js";

import { MetricsRegistry, structuredLog } from "./observability.js";
export interface AppDeps { store: Store; pepper: string; allowedOrigins: string[]; events?: EventSink; verifier: any; matching?: any; offers?: any; offersEnabled?: boolean; rateLimiter?: TokenBucketRateLimiter; logger?: (line: string) => void; corroborator?: any; metrics?: MetricsRegistry; registryDb?: any; adminToken?: string }
export function createApp(deps: AppDeps) {
  const events = deps.events ?? new CollectingEventSink();
  const metricsReg = deps.metrics ?? new MetricsRegistry();
  const services = new Services(deps.store, events, { verifier: deps.verifier, matching: deps.matching, offers: deps.offers, offersEnabled: deps.offersEnabled, corroborator: deps.corroborator, metrics: metricsReg });
  const limiter = deps.rateLimiter ?? new TokenBucketRateLimiter();
  const logger = deps.logger ?? ((l: string) => console.log(l));
  async function callTool(name: string, args: any, auth: AuthContext) {
    const t0 = Date.now();
    try {
    const schema = (ToolInputSchemas as any)[name] ?? (name === "find_offers" && deps.offersEnabled ? FindOffersInputSchema : undefined); if (!schema) throw new AgentMapError("not_found", `unknown tool: ${name}`);
    let input: any; try { input = schema.parse(args ?? {}); } catch (e) { throw zodToAgentError(e); }
    const rl = limiter.check(auth.agentId, auth.tier, name); if (!rl.allowed) throw new AgentMapError("rate_limited", "rate limit exceeded", rl.retry_after_ms);
    const out = await (async () => { switch (name) {
      case "is_mapped": return services.isMapped(auth.agentId, input);
      case "find": return services.find(auth, input);
      case "get_path": return services.getPath(auth, input);
      case "live_check": return services.liveCheck(auth, input);
      case "report_outcome": return services.reportOutcome(auth, input);
      case "request_mapping": return services.requestMapping(auth, input);
      case "my_sites": return services.mySites(auth, input);
      case "find_offers": return services.findOffers(auth, input);
      default: throw new AgentMapError("not_found", `unknown tool: ${name}`);
    } })();
    metricsReg.observe("tool_latency_ms", Date.now() - t0, { tool: name }); metricsReg.inc("tool_calls_total", { tool: name });
    logger(structuredLog({ level: "info", service: "mcp-server", request_id: randomUUID(), agent_id: auth.agentId, tool: name, latency_ms: Date.now() - t0 }));
    return out;
    } catch (e) { metricsReg.inc("tool_errors_total", { tool: name, code: (e as any)?.code ?? "internal" }); metricsReg.observe("tool_latency_ms", Date.now() - t0, { tool: name }); throw e; }
  }
  async function handleMcp(req: IncomingMessage, res: ServerResponse, body: any) {
    if (req.method === "GET") { sendJson(res, 405, { code: -32000, message: "GET not supported in stateless mode", data: { code: "invalid_input", message: "GET not supported in stateless mode", retryable: false } }); return; }
    const msgs = Array.isArray(body) ? body : [body];
    const responses: any[] = [];
    for (const msg of msgs) {
      if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") { if (msg?.id != null) responses.push({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request", data: { code: "invalid_input", message: "invalid request", retryable: false } } }); continue; }
      const id = msg.id; const isNotification = id == null;
      try {
        if (msg.method === "initialize") { if (!isNotification) responses.push({ jsonrpc: "2.0", id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "agentmap", version: "0.1.0" } } }); continue; }
        if (msg.method === "ping") { if (!isNotification) responses.push({ jsonrpc: "2.0", id, result: {} }); continue; }
        if (msg.method.startsWith("notifications/")) continue;
        // auth for everything else
        let auth: AuthContext;
        try { auth = await authenticate(deps.store, deps.pepper, req.headers.authorization); }
        catch (e) { events.write({ agent_id: null, domain: null, type: "auth_rejected", metadata: { error_code: "unauthorized" } }); throw e; }
        if (msg.method === "tools/list") { const names: string[] = deps.offersEnabled ? [...TOOL_NAMES, "find_offers"] : [...TOOL_NAMES]; responses.push({ jsonrpc: "2.0", id, result: { tools: names.map((n) => ({ name: n, description: (TOOL_DESCRIPTIONS as any)[n] ?? "Find currently available offers (coupons) for a domain/product. Only public or merchant-provided offers; commercial relationships are disclosed.", inputSchema: zodToJsonSchema((ToolInputSchemas as any)[n] ?? FindOffersInputSchema) })) } }); continue; }
        if (msg.method === "tools/call") {
          const name = msg.params?.name; const args = msg.params?.arguments ?? {};
          const result = await callTool(name, args, auth);
          logger(logLine({ level: "info", service: "mcp-server", request_id: randomUUID(), agent_id: auth.agentId, tool: name }));
          responses.push({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } }); continue;
        }
        throw new AgentMapError("not_found", `unknown method: ${msg.method}`);
      } catch (e) {
        if (isNotification) continue;
        const rpc = e instanceof AgentMapError ? e.toJsonRpc() : (e as any)?.code === "invalid_input" ? { code: -32602, message: (e as Error).message, data: { code: "invalid_input", message: (e as Error).message, retryable: false } } : { code: -32603, message: "internal error", data: { code: "internal", message: "internal error", retryable: false } };
        responses.push({ jsonrpc: "2.0", id, error: rpc });
      }
    }
    if (!responses.length) { res.writeHead(202).end(); return; }
    sendJson(res, 200, Array.isArray(body) ? responses : responses[0]);
  }
  const restRoutes: Record<string, { method: string; tool: string }> = {
    "/api/v1/find": { method: "POST", tool: "find" }, "/api/v1/get-path": { method: "POST", tool: "get_path" },
    "/api/v1/live-check": { method: "POST", tool: "live_check" }, "/api/v1/report-outcome": { method: "POST", tool: "report_outcome" },
    "/api/v1/request-mapping": { method: "POST", tool: "request_mapping" }, "/api/v1/my-sites": { method: "POST", tool: "my_sites" }, "/api/v1/find-offers": { method: "POST", tool: "find_offers" },
    "/api/v1/is-mapped": { method: "POST", tool: "is_mapped" },
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/dashboard") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(DASHBOARD_HTML); return; }
      if (url.pathname === "/") { sendJson(res, 200, { name: "agentmap", version: "0.1.0", mcp: "/mcp", rest: "/api/v1", data_policy: "/.well-known/data-policy", dashboard: "/dashboard" }); return; }
      if (url.pathname === "/.well-known/data-policy") { const body = "AgentMap data policy: we crawl public site structure only, honour robots.txt and merchant opt-out, never store shopper personal data, never cache price/stock as truth, and record per-agent behaviour (questions hashed). Full text: docs/data-policy.md in the agent-bureau repo.\n"; res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end(body); return; }
      if (url.pathname === "/healthz") { sendJson(res, 200, { ok: true }); return; }
      if (url.pathname === "/metrics") { const body = metricsReg.renderPrometheus(); res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }); res.end(body); return; }
      if (url.pathname === "/readyz") { const ok = await deps.store.ping(); sendJson(res, ok ? 200 : 503, { ok }); return; }
      if (url.pathname === "/mcp") {
        if (req.headers.origin && !deps.allowedOrigins.includes(req.headers.origin)) { sendJson(res, 403, { code: -32000, message: "origin not allowed", data: { code: "unauthorized", message: "origin not allowed", retryable: false } }); return; }
        if (req.method === "POST") {
          const accept = req.headers.accept ?? "";
          if (accept && !accept.includes("application/json") && !accept.includes("text/event-stream") && !accept.includes("*/*")) { sendJson(res, 406, { error: "not acceptable" }); return; }
          const body = await readJson(req); await handleMcp(req, res, body); return;
        }
        if (req.method === "GET") { await handleMcp(req, res, null); return; }
        sendJson(res, 405, { error: "method not allowed" }); return;
      }
      // Registry (plan 12.3, Phase 1): active only with a DB + ADMIN_TOKEN; x-admin-token guarded.
      if (url.pathname.startsWith("/api/v1/operators") || url.pathname.startsWith("/api/v1/agents")) {
        if (!deps.registryDb || !deps.adminToken || req.headers["x-admin-token"] !== deps.adminToken) { sendJson(res, 404, { code: -32004, message: "not found", data: { code: "not_found", message: "not found", retryable: false } }); return; }
        const { createOperator, createAgent, issueApiKey, revokeApiKey } = await import("@agentmap/db");
        const body: any = await readJson(req).catch(() => ({}));
        if (url.pathname === "/api/v1/operators" && req.method === "POST") { sendJson(res, 201, await createOperator(deps.registryDb, body.type ?? "person")); return; }
        if (url.pathname === "/api/v1/agents" && req.method === "POST") {
          if (!body.operator_id) throw new AgentMapError("invalid_input", "operator_id: required");
          sendJson(res, 201, await createAgent(deps.registryDb, body.operator_id, { declared_model: body.declared_model, declared_model_version: body.declared_model_version, tier: body.tier })); return;
        }
        const verMatch = /^\/api\/v1\/operators\/([^/]+)\/verification$/.exec(url.pathname);
        if (verMatch && req.method === "PATCH") {
          const { setOperatorVerification } = await import("@agentmap/db");
          const status = String(body.status ?? "");
          if (!["unverified", "pending", "verified", "rejected", "revoked"].includes(status)) throw new AgentMapError("invalid_input", "status: invalid verification status");
          const row = await setOperatorVerification(deps.registryDb, verMatch[1]!, status);
          sendJson(res, row ? 200 : 404, row ?? { error: "not found" }); return;
        }
        const keyMatch = /^\/api\/v1\/agents\/([^/]+)\/keys$/.exec(url.pathname);
        if (keyMatch && req.method === "POST") { const issued = await issueApiKey(deps.registryDb, keyMatch[1]!, deps.pepper); sendJson(res, 201, { id: issued.id, api_key: issued.fullKey, note: "shown once" }); return; }
        const revokeMatch = /^\/api\/v1\/agents\/([^/]+)\/keys\/([^/]+)$/.exec(url.pathname);
        if (revokeMatch && req.method === "DELETE") { const row = await revokeApiKey(deps.registryDb, revokeMatch[2]!); sendJson(res, row ? 200 : 404, row ?? { error: "not found" }); return; }
        sendJson(res, 404, { code: -32004, message: "not found", data: { code: "not_found", message: "not found", retryable: false } }); return;
      }
      // Usage (self, plan 12.5/13): authenticated agent reads its own monthly usage.
      if (url.pathname === "/api/v1/usage" && req.method === "GET") {
        if (!deps.registryDb) { sendJson(res, 404, { error: "not found" }); return; }
        const auth = await authenticate(deps.store, deps.pepper, req.headers.authorization);
        const { agentUsage } = await import("@agentmap/db");
        const since = url.searchParams.get("since") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        sendJson(res, 200, await agentUsage(deps.registryDb, auth.agentId, since)); return;
      }
      // Merchant read models (plan 13.4) + Bureau lookup (Phase 4): admin-only until Q4 sharing terms are decided.
      if (url.pathname.startsWith("/api/v1/merchant/") || url.pathname.startsWith("/api/v1/bureau/")) {
        if (!deps.registryDb || !deps.adminToken || req.headers["x-admin-token"] !== deps.adminToken) { sendJson(res, 404, { error: "not found" }); return; }
        const analytics = await import("@agentmap/db");
        const demandMatch = /^\/api\/v1\/merchant\/([^/]+)\/demand$/.exec(url.pathname);
        if (demandMatch && req.method === "GET") { sendJson(res, 200, await analytics.domainDemand(deps.registryDb, decodeURIComponent(demandMatch[1]!))); return; }
        const journeyMatch = /^\/api\/v1\/merchant\/([^/]+)\/journeys$/.exec(url.pathname);
        if (journeyMatch && req.method === "GET") { sendJson(res, 200, await analytics.domainJourneys(deps.registryDb, decodeURIComponent(journeyMatch[1]!))); return; }
        const bureauMatch = /^\/api\/v1\/bureau\/agents\/([^/]+)$/.exec(url.pathname);
        if (bureauMatch && req.method === "GET") { const inputs = await analytics.agentTrustInputs(deps.registryDb, bureauMatch[1]!); sendJson(res, 200, { agent_id: bureauMatch[1], ...computeTrustScore(inputs) }); return; }
        sendJson(res, 404, { error: "not found" }); return;
      }
      if (url.pathname === "/api/v1/is-mapped" && req.method === "GET") {
        const auth = await authenticate(deps.store, deps.pepper, req.headers.authorization).catch((e) => { events.write({ agent_id: null, domain: null, type: "auth_rejected", metadata: { error_code: "unauthorized" } }); throw e; });
        const result = await callTool("is_mapped", { domain: url.searchParams.get("domain") ?? "" }, auth); sendJson(res, 200, result); return;
      }
      const route = restRoutes[url.pathname];
      if (route && req.method === route.method) {
        let auth: AuthContext;
        try { auth = await authenticate(deps.store, deps.pepper, req.headers.authorization); } catch (e) { events.write({ agent_id: null, domain: null, type: "auth_rejected", metadata: { error_code: "unauthorized" } }); throw e; }
        const body = await readJson(req); const result = await callTool(route.tool, body, auth); sendJson(res, 200, result); return;
      }
      sendJson(res, 404, { code: -32004, message: "not found", data: { code: "not_found", message: "not found", retryable: false } });
    } catch (e) { const { status, body } = errorToHttp(e); sendJson(res, status, body); }
  });
  return { server, services, events, limiter, metrics: metricsReg };
}
export function zodToJsonSchema(schema: any): any {
  // Minimal JSON-Schema shape for tools/list; contracts remain Zod source of truth.
  try { const shape = schema?.shape ?? {}; const properties: Record<string, unknown> = {}; const required: string[] = []; for (const [k, v] of Object.entries<any>(shape)) { properties[k] = { type: "string" }; if (!v.isOptional?.()) required.push(k); } return { type: "object", properties, ...(required.length ? { required } : {}) }; } catch { return { type: "object", properties: {} }; }
}
function sendJson(res: ServerResponse, status: number, body: unknown) { const s = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) }); res.end(s); }
async function readJson(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); const t = Buffer.concat(chunks).toString("utf8"); if (!t) return {}; try { return JSON.parse(t); } catch { throw new AgentMapError("invalid_input", "body: invalid JSON"); } }

/** Merchant dashboard (Phase 3 first slice, plan 19): demand + journeys per domain. Admin token stays in browser storage only. */
const DASHBOARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AgentMap Merchant Dashboard</title>
<style>body{font-family:system-ui;margin:2rem;max-width:56rem}input,button{padding:.5rem;margin:.25rem}pre{background:#111;color:#eee;padding:1rem;overflow:auto;border-radius:.5rem}</style></head>
<body><h1>AgentMap — Merchant Dashboard</h1>
<p>Agent demand and journeys for a domain. Requires the admin token (kept only in this browser tab).</p>
<input id="domain" placeholder="example.com" size="30"><input id="token" type="password" placeholder="admin token" size="30">
<button id="go">Load</button><h2>Demand</h2><pre id="demand">—</pre><h2>Journeys</h2><pre id="journeys">—</pre>
<script>
document.getElementById('go').onclick = async () => {
  const d = encodeURIComponent(document.getElementById('domain').value.trim());
  const h = { 'x-admin-token': document.getElementById('token').value };
  for (const [id, kind] of [['demand','demand'],['journeys','journeys']]) {
    const r = await fetch('/api/v1/merchant/' + d + '/' + kind, { headers: h });
    document.getElementById(id).textContent = JSON.stringify(await r.json(), null, 2);
  }
};
</script></body></html>`;
