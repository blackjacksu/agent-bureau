DO $$ BEGIN CREATE TYPE operator_type AS ENUM ('person','business'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE verification_status AS ENUM ('unverified','pending','verified','rejected','revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE agent_tier AS ENUM ('free','builder','scale','verified_builder','verified_scale'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_type AS ENUM ('query','path_used','step_failed','live_check','outcome','auth_rejected','offers_served'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_kind AS ENUM ('index_domain','reindex_branch','sweep_site','verify_url'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_status AS ENUM ('queued','running','succeeded','failed','dead'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS operator (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type operator_type NOT NULL, verification_status verification_status NOT NULL DEFAULT 'unverified', verification_ref text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid NOT NULL REFERENCES operator(id), declared_model text, declared_model_version text, public_key text, erc8004_id text, verified boolean NOT NULL DEFAULT false, tier agent_tier NOT NULL DEFAULT 'free', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS api_key (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES agent(id), key_hash text NOT NULL, key_prefix text NOT NULL, scopes text[] NOT NULL DEFAULT '{tools}', created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS api_key_prefix_idx ON api_key(key_prefix);
CREATE TABLE IF NOT EXISTS event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, agent_id uuid REFERENCES agent(id),
  domain text, type event_type NOT NULL, path_id uuid, question_hash text,
  latency_ms int, tokens_saved_estimate int, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_agent_created_idx ON event(agent_id, created_at);
CREATE INDEX IF NOT EXISTS event_domain_created_idx ON event(domain, created_at);
-- append-only for app role when role exists (guarded)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agentmap_app') THEN REVOKE UPDATE, DELETE ON event FROM agentmap_app; END IF; END $$;
CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind job_kind NOT NULL, payload jsonb NOT NULL,
  status job_status NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(), locked_by text, locked_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_claim_idx ON job(status, run_after);
CREATE TABLE IF NOT EXISTS my_site (agent_id uuid NOT NULL REFERENCES agent(id), domain text NOT NULL REFERENCES site(domain), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(agent_id, domain));
CREATE TABLE IF NOT EXISTS demand_signal (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL, agent_id uuid, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS feedback_note (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, path_id uuid, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS verify_cache (url_hash text PRIMARY KEY, result jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_flag (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, kind text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
