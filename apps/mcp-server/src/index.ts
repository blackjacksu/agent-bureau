import { PgClient, BatchedEventWriter, listActiveOffers } from "@agentmap/db";
import { EmptyOfferProvider, getOffers } from "@agentmap/offers";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { InMemoryStore, PgStore } from "./store.js";
import { HttpVerifier } from "./verifier.js";

export * from "./server.js"; export * from "./services.js"; export * from "./store.js"; export * from "./middleware.js"; export * from "./config.js"; export * from "./verifier.js";

export function buildFromEnv() {
  const cfg = loadConfig();
  let store: any; let events: any; let registryDb: any;
  if (cfg.DATABASE_URL) { const db = PgClient.fromUrl(cfg.DATABASE_URL); store = new PgStore(db); events = new BatchedEventWriter(db); registryDb = db; }
  else { store = new InMemoryStore(); }
  // Phase 5 (plan 16.5): with OFFERS_ENABLED + DB, serve stored merchant/public offers; otherwise the dark empty provider.
  const provider: any = cfg.OFFERS_ENABLED && registryDb
    ? { getOffers: async (a: any) => listActiveOffers(registryDb, a.domain) }
    : new EmptyOfferProvider();
  const app = createApp({ store, pepper: cfg.API_KEY_PEPPER, allowedOrigins: cfg.allowedOrigins, events, verifier: new HttpVerifier(), registryDb, adminToken: cfg.ADMIN_TOKEN, offersEnabled: cfg.OFFERS_ENABLED, offers: async (a: any) => getOffers(provider, a, { optedOut: false, offersEnabled: cfg.OFFERS_ENABLED, domainEnabled: true, tierAllowed: true, now: new Date() }) });
  return { cfg, app };
}
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { cfg, app } = buildFromEnv();
  app.server.listen(cfg.MCP_PORT, () => console.log(JSON.stringify({ level: "info", service: "mcp-server", msg: "listening", port: cfg.MCP_PORT })));
  const shutdown = () => app.server.close(() => process.exit(0)); process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown); setTimeout(() => process.exit(0), 10_000).unref();
}
