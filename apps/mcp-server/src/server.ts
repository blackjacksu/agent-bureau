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
  // Ops dashboard feed: last 200 tool calls, in memory only (never persisted).
  const recentCalls: { ts: string; tool: string; agent_id: string; latency_ms: number; ok: boolean; code?: string }[] = [];
  function recordCall(name: string, auth: AuthContext, t0: number, ok: boolean, code?: string) {
    recentCalls.push({ ts: new Date().toISOString(), tool: name, agent_id: auth.agentId, latency_ms: Date.now() - t0, ok, ...(code ? { code } : {}) });
    if (recentCalls.length > 200) recentCalls.splice(0, recentCalls.length - 200);
  }
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
    recordCall(name, auth, t0, true);
    return out;
    } catch (e) { metricsReg.inc("tool_errors_total", { tool: name, code: (e as any)?.code ?? "internal" }); metricsReg.observe("tool_latency_ms", Date.now() - t0, { tool: name }); recordCall(name, auth, t0, false, (e as any)?.code ?? "internal"); throw e; }
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
      // Ops dashboard feed (authenticated): most recent tool calls, newest first.
      if (url.pathname === "/api/v1/recent-calls" && req.method === "GET") {
        await authenticate(deps.store, deps.pepper, req.headers.authorization).catch((e) => { events.write({ agent_id: null, domain: null, type: "auth_rejected", metadata: { error_code: "unauthorized" } }); throw e; });
        const n = Math.max(1, Math.min(200, Number(url.searchParams.get("n") ?? "50") || 50));
        sendJson(res, 200, { calls: recentCalls.slice(-n).reverse() }); return;
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

/** Ops + Merchant dashboard: per-call explorer, index-a-site, performance, and Phase 3 merchant demand/journeys. Secrets stay in this browser tab only. */
const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentMap Dashboard</title>
<style>
:root{--accent:#1a6b4a;--ink:#1c2420;--muted:#5b6660;--line:#dfe5e1;--bg:#f4f6f4;--card:#ffffff;--err:#a4262c;--ok:#1a6b4a}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.45}
header{background:var(--ink);color:#fff;padding:1rem 1.5rem}header h1{margin:0;font-size:1.25rem;font-weight:650}
header p{margin:.25rem 0 0;color:#c4cdc8;font-size:.9rem}
main{max-width:62rem;margin:0 auto;padding:1.25rem 1.5rem 3rem;display:grid;gap:1rem}
section{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.25rem}
h2{margin:.25rem 0 .75rem;font-size:1.05rem}h2 .tag{font-size:.75rem;font-weight:600;color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:.05rem .4rem;margin-left:.5rem;vertical-align:middle}
p.hint{color:var(--muted);font-size:.88rem;margin:.25rem 0 .75rem}
label{font-size:.85rem;font-weight:600;display:block;margin:.6rem 0 .25rem}
input,select,textarea,button{font:inherit;padding:.45rem .6rem;border:1px solid var(--line);border-radius:6px}
input,select,textarea{width:100%;max-width:34rem}textarea{font-family:ui-monospace,Menlo,monospace;font-size:.82rem;min-height:5.5rem}
button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer;font-weight:600}button:hover{filter:brightness(1.08)}
button.ghost{background:#fff;color:var(--ink);border-color:var(--line);font-weight:500}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end}.row>*{flex:1 1 12rem}
pre{background:#141816;color:#e8ede9;padding:.8rem;border-radius:6px;overflow:auto;font-size:.8rem;max-height:22rem}
.badges{display:flex;gap:.5rem;flex-wrap:wrap;margin:.25rem 0}
.badge{border:1px solid var(--line);border-radius:4px;padding:.2rem .6rem;font-size:.85rem;background:var(--bg)}
.badge b{font-weight:700}.ok{color:var(--ok)}.err{color:var(--err)}
table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:.78rem}td.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:.5rem;background:var(--bg);border-radius:3px;overflow:hidden;min-width:6rem}.bar>i{display:block;height:100%;background:var(--accent)}
.status-err{color:var(--err);font-weight:600}.status-ok{color:var(--ok);font-weight:600}
</style></head>
<body><header><h1>AgentMap — Dashboard</h1><p>Calls, indexing, and performance for this MCP server. Keys stay in this tab only.</p></header>
<main>
<section><h2>Credentials</h2>
<p class="hint">One API key unlocks the call explorer, index-a-site, and recent calls. Get one from <code>agentmap-admin issue-key</code>.</p>
<label for="key">API key</label><input id="key" type="password" autocomplete="off" placeholder="am_live_…" style="max-width:34rem">
</section>
<section><h2>Status</h2><div class="badges" id="status"><span class="badge">loading…</span></div>
<div class="row"><div><button class="ghost" id="refresh-status">Refresh status</button></div></div></section>
<section><h2>Index a website</h2>
<p class="hint">Queues a domain for mapping (the Indexer picks it up), then check whether the map is ready.</p>
<div class="row"><div><label for="idx-domain">Domain</label><input id="idx-domain" placeholder="example.com"></div></div>
<div class="row"><div><button id="idx-go">Request mapping</button> <button class="ghost" id="idx-check">Check is_mapped</button></div></div>
<pre id="idx-out">—</pre></section>
<section><h2>Call explorer</h2>
<p class="hint">Call any MCP tool through its REST mirror and inspect the JSON result.</p>
<div class="row"><div><label for="tool">Tool</label><select id="tool"></select></div></div>
<label for="args">Arguments (JSON)</label><textarea id="args" spellcheck="false"></textarea>
<div class="row"><div><button id="send">Send</button></div></div>
<pre id="call-out">—</pre></section>
<section><h2>Recent calls</h2><p class="hint">Last tool calls served by this process. Auto-refreshes every 5 seconds while the tab is visible.</p>
<table><thead><tr><th>Time</th><th>Tool</th><th>Agent</th><th style="text-align:right">ms</th><th>Status</th></tr></thead><tbody id="recent"><tr><td colspan="5">—</td></tr></tbody></table></section>
<section><h2>Performance</h2><p class="hint">Totals, errors, and latency per tool since this process started. Source: <code>/metrics</code>.</p>
<table><thead><tr><th>Tool</th><th style="text-align:right">Calls</th><th style="text-align:right">Errors</th><th style="text-align:right">Avg ms</th><th style="text-align:right">p95 ms</th><th>p95</th></tr></thead><tbody id="perf"><tr><td colspan="6">—</td></tr></tbody></table></section>
<section><h2>Merchant Dashboard <span class="tag">Phase 3</span></h2>
<p class="hint">Agent demand and journeys for a domain. Requires the admin token (kept only in this browser tab).</p>
<div class="row"><div><label for="domain">Domain</label><input id="domain" placeholder="example.com"></div>
<div><label for="token">Admin token</label><input id="token" type="password" placeholder="admin token"></div></div>
<div class="row"><div><button id="go">Load demand + journeys</button></div></div>
<h2>Demand</h2><pre id="demand">—</pre><h2>Journeys</h2><pre id="journeys">—</pre></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const SLUGS = {"is_mapped":"is-mapped","find":"find","get_path":"get-path","live_check":"live-check","report_outcome":"report-outcome","request_mapping":"request-mapping","my_sites":"my-sites"};
const TEMPLATES = {
"is_mapped": {"domain":"example.com"},
"find": {"domain":"example.com","question":"brake pads for a 2019 civic"},
"get_path": {"domain":"example.com","goal":"search results"},
"live_check": {"url":"https://example.com/product/123","fields":["price","stock"]},
"report_outcome": {"domain":"example.com","path_id":"p_00000000-0000-4000-8000-000000000000","success":true},
"request_mapping": {"domain":"example.com"},
"my_sites": {"action":"list"}
};
const toolSel = $("tool");
for (const t of Object.keys(SLUGS)) { const o = document.createElement("option"); o.value = t; o.textContent = t; toolSel.appendChild(o); }
toolSel.value = "find"; $("args").value = JSON.stringify(TEMPLATES[toolSel.value], null, 2);
toolSel.onchange = () => { $("args").value = JSON.stringify(TEMPLATES[toolSel.value], null, 2); };
const key = () => $("key").value.trim();
function authHeaders(extra) { return Object.assign({"content-type":"application/json"}, key() ? {"authorization":"Bearer " + key()} : {}, extra); }
async function status() {
  const el = $("status"); el.innerHTML = "<span class='badge'>loading…</span>";
  try {
    const [h, r] = await Promise.all([fetch("/healthz").then((x) => x.json()), fetch("/readyz").then((x) => x.json().then((b) => ({code:x.status, body:b})))]);
    el.innerHTML = "<span class='badge'>healthz <b class='" + (h.ok ? "ok'>ok" : "err'>FAIL") + "</b></span>" +
      "<span class='badge'>readyz (db) <b class='" + (r.body.ok ? "ok'>ok" : "err'>FAIL " + r.code) + "</b></span>";
  } catch (e) { el.innerHTML = "<span class='badge'>unreachable: " + String(e).replace(/</g,"&lt;") + "</span>"; }
}
$("refresh-status").onclick = status; status();
$("idx-go").onclick = async () => {
  const out = $("idx-out"); out.textContent = "…";
  try { const r = await fetch("/api/v1/request-mapping", {method:"POST", headers:authHeaders(), body:JSON.stringify({domain:$("idx-domain").value.trim()})});
    out.textContent = r.status + "\\n" + JSON.stringify(await r.json(), null, 2); }
  catch (e) { out.textContent = String(e); }
};
$("idx-check").onclick = async () => {
  const out = $("idx-out"); out.textContent = "…";
  try { const r = await fetch("/api/v1/is-mapped?domain=" + encodeURIComponent($("idx-domain").value.trim()), {headers:authHeaders()});
    out.textContent = r.status + "\\n" + JSON.stringify(await r.json(), null, 2); }
  catch (e) { out.textContent = String(e); }
};
$("send").onclick = async () => {
  const out = $("call-out"); out.textContent = "…";
  let body = {}; try { body = JSON.parse($("args").value || "{}"); } catch (e) { out.textContent = "arguments: invalid JSON"; return; }
  try { const r = await fetch("/api/v1/" + SLUGS[toolSel.value], {method:"POST", headers:authHeaders(), body:JSON.stringify(body)});
    out.textContent = r.status + "\\n" + JSON.stringify(await r.json(), null, 2); refreshRecent(); }
  catch (e) { out.textContent = String(e); }
};
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
async function refreshRecent() {
  const tb = $("recent"); if (!key()) { tb.innerHTML = "<tr><td colspan='5'>enter an API key above</td></tr>"; return; }
  try { const r = await fetch("/api/v1/recent-calls?n=20", {headers:authHeaders()});
    if (!r.ok) { tb.innerHTML = "<tr><td colspan='5'>HTTP " + r.status + "</td></tr>"; return; }
    const calls = (await r.json()).calls || [];
    tb.innerHTML = calls.length ? calls.map((c) => "<tr><td>" + esc(c.ts) + "</td><td>" + esc(c.tool) + "</td><td>" + esc(String(c.agent_id).slice(0,8)) + "…</td><td class='num'>" + c.latency_ms + "</td><td class='" + (c.ok ? "status-ok'>ok" : "status-err'>FAIL " + esc(c.code || "")) + "</td></tr>").join("") : "<tr><td colspan='5'>no calls yet — send one above</td></tr>";
  } catch (e) { tb.innerHTML = "<tr><td colspan='5'>" + esc(String(e)) + "</td></tr>"; }
}
async function refreshPerf() {
  const tb = $("perf");
  try {
    const text = await (await fetch("/metrics")).text();
    const rows = {};
    for (const line of text.split("\\n")) {
      const m = /^([a-z_]+)(\\{([^}]*)\\})?\\s+([\\d.eE+-]+)$/.exec(line.trim()); if (!m) continue;
      const labels = {}; for (const kv of (m[3] || "").split(",")) { const p = kv.split("="); if (p.length === 2) labels[p[0]] = p[1].replace(/"/g, ""); }
      const tool = labels.tool || "?"; rows[tool] = rows[tool] || {calls:0, errors:0, count:0, sum:0, p95:0};
      const v = Number(m[4]);
      if (m[1] === "tool_calls_total") rows[tool].calls = v;
      else if (m[1] === "tool_errors_total") rows[tool].errors += v;
      else if (m[1] === "tool_latency_ms_count") rows[tool].count = v;
      else if (m[1] === "tool_latency_ms_sum") rows[tool].sum = v;
      else if (m[1] === "tool_latency_ms_p95") rows[tool].p95 = v;
    }
    const names = Object.keys(rows).sort(); if (!names.length) { tb.innerHTML = "<tr><td colspan='6'>no calls recorded yet</td></tr>"; return; }
    const max = Math.max.apply(null, names.map((t) => rows[t].p95).concat([1]));
    tb.innerHTML = names.map((t) => { const r = rows[t]; const avg = r.count ? Math.round(r.sum / r.count) : 0;
      return "<tr><td>" + esc(t) + "</td><td class='num'>" + r.calls + "</td><td class='num'>" + r.errors + "</td><td class='num'>" + avg + "</td><td class='num'>" + Math.round(r.p95) + "</td><td><div class='bar'><i style='width:" + Math.max(2, Math.round((r.p95 / max) * 100)) + "%'></i></div></td></tr>"; }).join("");
  } catch (e) { tb.innerHTML = "<tr><td colspan='6'>" + esc(String(e)) + "</td></tr>"; }
}
document.getElementById('go').onclick = async () => {
  const d = encodeURIComponent(document.getElementById('domain').value.trim());
  const h = { 'x-admin-token': document.getElementById('token').value };
  for (const [id, kind] of [['demand','demand'],['journeys','journeys']]) {
    const r = await fetch('/api/v1/merchant/' + d + '/' + kind, { headers: h });
    document.getElementById(id).textContent = JSON.stringify(await r.json(), null, 2);
  }
};
setInterval(() => { if (!document.hidden) { refreshRecent(); refreshPerf(); } }, 5000);
refreshRecent(); refreshPerf();
</script></body></html>`;
