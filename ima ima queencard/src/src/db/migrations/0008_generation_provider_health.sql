CREATE TABLE IF NOT EXISTS "generation_provider_health" (
  "provider" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'available' NOT NULL,
  "reason" text,
  "error_code" text,
  "balance_cny" integer,
  "unavailable_until" timestamp,
  "last_error_at" timestamp,
  "last_success_at" timestamp,
  "last_alert_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
