ALTER TABLE credit_packages
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

ALTER TABLE credit_holds
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_fulfillments_provider_transaction_unique
  ON payment_fulfillments (provider, provider_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_fulfillments_provider_event_unique
  ON payment_fulfillments (provider, event_id);
