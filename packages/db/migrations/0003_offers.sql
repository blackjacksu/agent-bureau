DO $$ BEGIN CREATE TYPE offer_source_kind AS ENUM ('merchant_direct','affiliate_network','merchant_public_page','merchant_dashboard'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE discount_type AS ENUM ('percent','fixed_amount','free_shipping','bogo','info'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE offer_status AS ENUM ('active','unverified','expired','revoked','merchant_disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS offer_source (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind offer_source_kind NOT NULL, name text NOT NULL, terms_url text, feed_config jsonb, commercial_relationship text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS offer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL REFERENCES site(domain),
  source_id uuid NOT NULL REFERENCES offer_source(id), code text, title text NOT NULL, description text,
  discount_type discount_type NOT NULL, discount_value numeric, currency text,
  applies_to jsonb NOT NULL DEFAULT '{}', starts_at timestamptz, expires_at timestamptz,
  last_verified_at timestamptz, verify_attempts int NOT NULL DEFAULT 0, verify_successes int NOT NULL DEFAULT 0,
  status offer_status NOT NULL DEFAULT 'unverified', affiliate_url_template text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offer_domain_status_idx ON offer(domain, status, expires_at);
