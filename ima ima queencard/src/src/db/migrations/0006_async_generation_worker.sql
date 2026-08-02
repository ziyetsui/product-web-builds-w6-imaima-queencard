ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "priority" smallint DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "lease_owner" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "failure_category" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;

CREATE TABLE IF NOT EXISTS "generation_concurrency_leases" (
  "scope_key" text NOT NULL,
  "slot_number" integer NOT NULL,
  "task_id" text NOT NULL,
  "task_version" integer NOT NULL,
  "lease_owner" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "heartbeat_at" timestamp NOT NULL,
  "acquired_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "generation_concurrency_leases_pk" PRIMARY KEY ("scope_key", "slot_number"),
  CONSTRAINT "generation_concurrency_leases_slot_positive" CHECK ("slot_number" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "generation_tasks_user_id_idempotency_key_idx"
  ON "generation_tasks" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "generation_tasks_runnable_idx"
  ON "generation_tasks" ("status", "next_attempt_at", "priority" DESC, "created_at");

CREATE INDEX IF NOT EXISTS "generation_tasks_expired_lease_idx"
  ON "generation_tasks" ("status", "lease_expires_at")
  WHERE "status" = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS "generation_concurrency_leases_task_scope_idx"
  ON "generation_concurrency_leases" ("task_id", "scope_key");

CREATE INDEX IF NOT EXISTS "generation_concurrency_leases_task_id_idx"
  ON "generation_concurrency_leases" ("task_id");

CREATE INDEX IF NOT EXISTS "generation_concurrency_leases_expires_at_idx"
  ON "generation_concurrency_leases" ("expires_at");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generation_tasks_attempt_count_range'
  ) THEN
    ALTER TABLE "generation_tasks"
      ADD CONSTRAINT "generation_tasks_attempt_count_range"
      CHECK ("attempt_count" >= 0 AND "attempt_count" <= "max_attempts");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generation_tasks_max_attempts_range'
  ) THEN
    ALTER TABLE "generation_tasks"
      ADD CONSTRAINT "generation_tasks_max_attempts_range"
      CHECK ("max_attempts" >= 1 AND "max_attempts" <= 5);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generation_tasks_state_lease_consistency'
  ) THEN
    ALTER TABLE "generation_tasks"
      ADD CONSTRAINT "generation_tasks_state_lease_consistency"
      CHECK (
        ("status" = 'running' AND "lease_owner" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
        OR ("status" <> 'running' AND "lease_owner" IS NULL)
      ) NOT VALID;
  END IF;
END $$;
