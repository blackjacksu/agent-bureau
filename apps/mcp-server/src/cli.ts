#!/usr/bin/env node
import { PgClient, createOperator, createAgent, issueApiKey, revokeApiKey } from "@agentmap/db";
// Admin CLI (plan 12.1/12.3): manual key issuance for Phase 0.
// Usage: issue-key [--agent-id <uuid>] [--operator-id <uuid>] [--tier free] [--model m --model-version v]
const args = process.argv.slice(2); const cmd = args[0];
function flag(name: string) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; }
async function main() {
  const url = process.env.DATABASE_URL; const pepper = process.env.API_KEY_PEPPER;
  if (!url || !pepper) { console.error("DATABASE_URL and API_KEY_PEPPER are required"); process.exit(1); }
  const db = PgClient.fromUrl(url);
  try {
    if (cmd === "issue-key") {
      let agentId = flag("agent-id");
      if (!agentId) { const op = flag("operator-id") ? { id: flag("operator-id") } : await createOperator(db, flag("operator-type") ?? "person"); const ag = await createAgent(db, op.id, { tier: flag("tier") ?? "free", declared_model: flag("model"), declared_model_version: flag("model-version") }); agentId = ag.id; console.log(`agent_id=${agentId} operator_id=${op.id}`); }
      const issued = await issueApiKey(db, agentId!, pepper);
      console.log(`api_key=${issued.fullKey}`); console.log("Store this key now — it is shown once.");
    } else if (cmd === "revoke-key") { const id = flag("key-id"); if (!id) throw new Error("--key-id required"); await revokeApiKey(db, id); console.log(`revoked=${id}`); }
    else { console.error("commands: issue-key | revoke-key"); process.exit(1); }
  } finally { await db.end?.(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "error"); process.exit(1); });
