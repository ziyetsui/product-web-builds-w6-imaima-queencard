CREATE TABLE IF NOT EXISTS miniapp_users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'wechat',
  appid TEXT NOT NULL,
  openid TEXT NOT NULL,
  unionid TEXT,
  name TEXT NOT NULL DEFAULT '微信用户',
  avatar_url TEXT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appid, openid)
);

CREATE INDEX IF NOT EXISTS miniapp_users_created_at_idx ON miniapp_users (created_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS miniapp_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS miniapp_sessions_user_id_idx ON miniapp_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS credit_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  initial_credits INTEGER NOT NULL CHECK (initial_credits >= 0),
  remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
  frozen_credits INTEGER NOT NULL DEFAULT 0 CHECK (frozen_credits >= 0),
  trans_type TEXT NOT NULL,
  order_no TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED')),
  expired_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (remaining_credits + frozen_credits <= initial_credits)
);

CREATE INDEX IF NOT EXISTS credit_packages_user_status_idx ON credit_packages (user_id, status);
CREATE INDEX IF NOT EXISTS credit_packages_user_expired_idx ON credit_packages (user_id, expired_at);

CREATE TABLE IF NOT EXISTS credit_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  task_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  settled_credits INTEGER NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  status TEXT NOT NULL DEFAULT 'HOLDING' CHECK (status IN ('HOLDING', 'SETTLED', 'RELEASED')),
  package_allocation JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS credit_holds_user_status_idx ON credit_holds (user_id, status);
CREATE INDEX IF NOT EXISTS credit_holds_task_id_idx ON credit_holds (task_id);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  trans_no TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  trans_type TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  package_id TEXT REFERENCES credit_packages(id),
  task_id TEXT,
  order_no TEXT,
  hold_id TEXT REFERENCES credit_holds(id),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx ON credit_transactions (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS credit_transactions_task_id_idx ON credit_transactions (task_id);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES miniapp_users(id),
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'processing', 'completed', 'retryable', 'failed', 'canceled')),
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  template_id TEXT,
  provider TEXT,
  provider_task_id TEXT,
  provider_result_url TEXT,
  mode TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL DEFAULT '',
  output_count INTEGER NOT NULL DEFAULT 1 CHECK (output_count > 0),
  aspect_ratio TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  requested_credits INTEGER NOT NULL DEFAULT 0 CHECK (requested_credits >= 0),
  settled_credits INTEGER NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  credit_hold_id TEXT REFERENCES credit_holds(id),
  raw_provider_result JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS generation_tasks_lease_idx ON generation_tasks (status, lease_expires_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS generation_tasks_owner_created_idx ON generation_tasks (owner_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS generated_assets (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES generation_tasks(id),
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  output_index INTEGER NOT NULL CHECK (output_index >= 0),
  object_key TEXT NOT NULL,
  provider_url TEXT,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  width INTEGER,
  height INTEGER,
  size_bytes BIGINT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, output_index)
);

CREATE INDEX IF NOT EXISTS generated_assets_user_id_idx ON generated_assets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reference_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size_bytes BIGINT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS reference_assets_user_id_idx ON reference_assets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS template_catalog_versions (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'unknown',
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS template_catalog_versions_active_idx ON template_catalog_versions (active) WHERE active;

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  catalog_version_id TEXT REFERENCES template_catalog_versions(id),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  scenario_category TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt TEXT NOT NULL DEFAULT '',
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  use_case TEXT NOT NULL DEFAULT '',
  metrics JSONB,
  seed JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS templates_catalog_category_idx ON templates (catalog_version_id, category, id);

CREATE TABLE IF NOT EXISTS miniapp_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES miniapp_users(id),
  idempotency_key TEXT,
  product_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'wechat',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'refunded')),
  payment_status TEXT NOT NULL DEFAULT 'created',
  payment_mode TEXT NOT NULL DEFAULT 'manual',
  payment_verified BOOLEAN NOT NULL DEFAULT FALSE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_params JSONB,
  external_payment_id TEXT,
  credits_granted INTEGER NOT NULL DEFAULT 0 CHECK (credits_granted >= 0),
  credits_revoked INTEGER NOT NULL DEFAULT 0 CHECK (credits_revoked >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_status TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'accepted', 'processing', 'succeeded', 'failed')),
  refund_provider_id TEXT,
  refund_amount_cents INTEGER,
  refund_accepted_at TIMESTAMPTZ,
  refund_completed_at TIMESTAMPTZ,
  refund_error TEXT NOT NULL DEFAULT '',
  reconcile_lease_owner TEXT,
  reconcile_lease_expires_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  admin_note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS miniapp_orders_user_created_idx ON miniapp_orders (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS payment_fulfillments (
  id TEXT PRIMARY KEY,
  fulfillment_key TEXT NOT NULL UNIQUE,
  order_id TEXT REFERENCES miniapp_orders(id),
  provider TEXT NOT NULL,
  event_id TEXT,
  event_type TEXT,
  provider_order_id TEXT,
  provider_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'SKIPPED', 'FAILED', 'REFUNDED')),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_fulfillments_event_id_idx ON payment_fulfillments (event_id);
CREATE INDEX IF NOT EXISTS payment_fulfillments_order_id_idx ON payment_fulfillments (order_id);

CREATE TABLE IF NOT EXISTS payment_audit_events (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  user_id TEXT,
  type TEXT NOT NULL,
  actor_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_audit_events_order_created_idx ON payment_audit_events (order_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_audit_events_user_created_idx ON payment_audit_events (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  before_state JSONB,
  after_state JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_created_idx ON admin_audit_logs (actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_created_idx ON admin_audit_logs (target_user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_credit_transaction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_transactions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credit_transactions_immutable ON credit_transactions;
CREATE TRIGGER credit_transactions_immutable
  BEFORE UPDATE OR DELETE ON credit_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_credit_transaction_mutation();
