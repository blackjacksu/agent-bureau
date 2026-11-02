CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE TYPE site_status AS ENUM ('mapped','queued','indexing','blocked','opted_out','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE node_kind AS ENUM ('home','search','category','filter','product','cart','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE edge_action AS ENUM ('navigate','click','fill','select','set_vehicle','filter','submit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS site (
  domain text PRIMARY KEY, status site_status NOT NULL DEFAULT 'queued',
  map_version int NOT NULL DEFAULT 0, last_indexed_at timestamptz,
  robots_policy jsonb, demand_score double precision NOT NULL DEFAULT 0,
  opt_out_at timestamptz, opt_out_reason text,
  offers_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_status_idx ON site(status);
CREATE INDEX IF NOT EXISTS site_demand_idx ON site(demand_score DESC);
CREATE TABLE IF NOT EXISTS node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL REFERENCES site(domain),
  map_version int NOT NULL, url_pattern text NOT NULL, kind node_kind NOT NULL,
  description text NOT NULL, embedding vector(1536), embedding_model text,
  last_verified_at timestamptz, stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(domain, map_version, url_pattern, kind)
);
CREATE INDEX IF NOT EXISTS node_domain_version_idx ON node(domain, map_version, stale);
CREATE INDEX IF NOT EXISTS node_embedding_hnsw ON node USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE TABLE IF NOT EXISTS edge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL, map_version int NOT NULL,
  from_node_id uuid NOT NULL REFERENCES node(id), to_node_id uuid NOT NULL REFERENCES node(id),
  action edge_action NOT NULL, selector text, selector_fallbacks text[],
  url_template text, params_schema jsonb, attempts int NOT NULL DEFAULT 0, successes int NOT NULL DEFAULT 0,
  stale boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edge_mechanism CHECK (selector IS NOT NULL OR url_template IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS path_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL REFERENCES site(domain),
  question_embedding vector(1536), question_canonical text NOT NULL,
  ordered_edge_ids uuid[] NOT NULL, param_bindings jsonb, hits int NOT NULL DEFAULT 0, successes int NOT NULL DEFAULT 0,
  last_success_at timestamptz, stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS path_cache_embedding_hnsw ON path_cache USING hnsw (question_embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
