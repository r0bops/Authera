CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS humans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  trusted_surface_key_id TEXT UNIQUE,
  trusted_surface_public_key TEXT,
  trusted_surface_key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE humans ADD COLUMN IF NOT EXISTS trusted_surface_key_id TEXT;
ALTER TABLE humans ADD COLUMN IF NOT EXISTS trusted_surface_public_key TEXT;
ALTER TABLE humans ADD COLUMN IF NOT EXISTS trusted_surface_key_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id UUID NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_key TEXT,
  key_id TEXT UNIQUE,
  public_key TEXT,
  algorithm TEXT NOT NULL DEFAULT 'ES256',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS key_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS algorithm TEXT NOT NULL DEFAULT 'ES256';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key TEXT,
  key_id TEXT UNIQUE,
  public_key TEXT,
  algorithm TEXT NOT NULL DEFAULT 'ES256',
  profile_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS key_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS algorithm TEXT NOT NULL DEFAULT 'ES256';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS profile_url TEXT;

CREATE TABLE IF NOT EXISTS payment_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id UUID NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  token_type TEXT NOT NULL DEFAULT 'vaulted',
  vaulted_token TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'CARD',
  brand TEXT,
  last4 TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_instruments ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'vaulted';

CREATE TABLE IF NOT EXISTS mandates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id UUID NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  max_amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_condition JSONB,
  frequency_limit JSONB,
  allowed_merchant_ids UUID[],
  payment_instrument_id UUID REFERENCES payment_instruments(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'yuno-vaulted-token',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  revoked_at TIMESTAMPTZ,
  ap2_open_mandate_jwt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE mandates ADD COLUMN IF NOT EXISTS allowed_merchant_ids UUID[];
ALTER TABLE mandates ADD COLUMN IF NOT EXISTS payment_instrument_id UUID REFERENCES payment_instruments(id) ON DELETE SET NULL;
ALTER TABLE mandates ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mandates ADD COLUMN IF NOT EXISTS ap2_open_mandate_jwt TEXT;

CREATE TABLE IF NOT EXISTS mandate_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id UUID NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mandate_id, version)
);

CREATE TABLE IF NOT EXISTS ucp_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  mandate_id UUID REFERENCES mandates(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ready_for_complete',
  line_items JSONB NOT NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL,
  buyer JSONB NOT NULL DEFAULT '{}'::jsonb,
  checkout_jwt TEXT,
  checkout_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ucp_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id UUID NOT NULL REFERENCES ucp_checkout_sessions(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  purchase_id UUID,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id UUID REFERENCES mandates(id) ON DELETE SET NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  checkout_id UUID REFERENCES ucp_checkout_sessions(id) ON DELETE SET NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  yuno_payment_id TEXT,
  ap2_checkout_mandate_jwt TEXT,
  ap2_payment_mandate_jwt TEXT,
  request_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS checkout_id UUID REFERENCES ucp_checkout_sessions(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS policy_checks JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS yuno_payment_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ap2_checkout_mandate_jwt TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ap2_payment_mandate_jwt TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_request_id ON purchases(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  sequence_number BIGSERIAL PRIMARY KEY,
  id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  mandate_id UUID REFERENCES mandates(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  request_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS previous_event_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event_hash TEXT;

CREATE TABLE IF NOT EXISTS replay_nonces (
  request_id TEXT PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  mandate_id UUID REFERENCES mandates(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  checkout_id UUID REFERENCES ucp_checkout_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  checks JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  human_id UUID NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mandates_agent ON mandates(agent_id);
CREATE INDEX IF NOT EXISTS idx_mandates_human ON mandates(human_id);
CREATE INDEX IF NOT EXISTS idx_purchases_mandate ON purchases(mandate_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replay_expires ON replay_nonces(expires_at);
