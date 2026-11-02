# Runbook: revoke an API key
Trigger: leaked key, operator request, abuse flag.
1. Identify key id by prefix (support lookup): `SELECT id, agent_id FROM api_key WHERE key_prefix='<prefix8>';`
2. Revoke: admin CLI `revoke-key --key-id <id>` or DELETE /api/v1/agents/<agent>/keys/<id> with x-admin-token.
3. Verify: an MCP call with the old key returns -32001 within 30s (auth cache TTL).
4. Issue a replacement key only after the operator confirms control of the agent.
