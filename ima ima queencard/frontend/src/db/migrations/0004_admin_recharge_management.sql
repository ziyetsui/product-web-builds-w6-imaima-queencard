DO $$ BEGIN
  CREATE TYPE "AdminRechargeStatus" AS ENUM (
    'PENDING',
    'FULFILLED',
    'PARTIALLY_REVOKED',
    'REVOKED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminAuditAction" AS ENUM (
    'ADMIN_RECHARGE_CREATE',
    'ADMIN_RECHARGE_REVOKE',
    'ADMIN_NOTE_UPDATE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "admin_recharge_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_no" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "user_id" text NOT NULL,
  "admin_user_id" text NOT NULL,
  "credits" integer NOT NULL,
  "currency" text DEFAULT 'CNY' NOT NULL,
  "amount_cents" integer,
  "payment_channel" text,
  "external_payment_no" text,
  "credit_package_id" integer,
  "status" "AdminRechargeStatus" DEFAULT 'PENDING' NOT NULL,
  "refunded_credits" integer DEFAULT 0 NOT NULL,
  "manual_review_required" boolean DEFAULT false NOT NULL,
  "remark" text,
  "metadata" jsonb,
  "fulfilled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_recharge_orders_order_no_idx"
  ON "admin_recharge_orders" ("order_no");

CREATE UNIQUE INDEX IF NOT EXISTS "admin_recharge_orders_idempotency_key_idx"
  ON "admin_recharge_orders" ("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "admin_recharge_orders_external_payment_no_idx"
  ON "admin_recharge_orders" ("external_payment_no");

CREATE INDEX IF NOT EXISTS "admin_recharge_orders_user_id_idx"
  ON "admin_recharge_orders" ("user_id");

CREATE INDEX IF NOT EXISTS "admin_recharge_orders_admin_user_id_idx"
  ON "admin_recharge_orders" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "admin_recharge_orders_status_idx"
  ON "admin_recharge_orders" ("status");

CREATE INDEX IF NOT EXISTS "admin_recharge_orders_created_at_idx"
  ON "admin_recharge_orders" ("created_at");

CREATE TABLE IF NOT EXISTS "admin_user_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "admin_user_id" text NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_user_notes_user_id_idx"
  ON "admin_user_notes" ("user_id");

CREATE INDEX IF NOT EXISTS "admin_user_notes_created_at_idx"
  ON "admin_user_notes" ("created_at");

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_user_id" text NOT NULL,
  "target_user_id" text,
  "action" "AdminAuditAction" NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "before" jsonb,
  "after" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_actor_user_id_idx"
  ON "admin_audit_logs" ("actor_user_id");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_user_id_idx"
  ON "admin_audit_logs" ("target_user_id");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_idx"
  ON "admin_audit_logs" ("action");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx"
  ON "admin_audit_logs" ("created_at");
