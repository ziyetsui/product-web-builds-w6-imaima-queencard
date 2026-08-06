ALTER TABLE miniapp_orders
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_provider_id TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS refund_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reconcile_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS reconcile_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS miniapp_orders_reconcile_lease_idx
  ON miniapp_orders (payment_mode, status, updated_at, reconcile_lease_expires_at);

CREATE INDEX IF NOT EXISTS miniapp_orders_refund_status_idx
  ON miniapp_orders (payment_mode, refund_status, updated_at);
