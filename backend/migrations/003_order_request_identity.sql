ALTER TABLE miniapp_orders
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
