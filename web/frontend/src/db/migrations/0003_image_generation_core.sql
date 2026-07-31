CREATE TABLE IF NOT EXISTS "generation_tasks" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "source_case_id" text,
  "source_case_category" text,
  "source_note_url" text,
  "source_author_url" text,
  "prompt" text NOT NULL,
  "original_prompt" text,
  "reference_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "model" text NOT NULL,
  "provider_model" text NOT NULL,
  "capability" text NOT NULL,
  "aspect_ratio" text DEFAULT '3:4' NOT NULL,
  "size" text,
  "resolution" text DEFAULT 'auto' NOT NULL,
  "output_count" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "requested_credits" integer DEFAULT 0 NOT NULL,
  "settled_credits" integer DEFAULT 0 NOT NULL,
  "credit_hold_key" text,
  "provider" text DEFAULT 'gptproto' NOT NULL,
  "provider_task_id" text,
  "provider_raw" jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "generation_tasks_user_id_idx"
  ON "generation_tasks" ("user_id");

CREATE INDEX IF NOT EXISTS "generation_tasks_status_idx"
  ON "generation_tasks" ("status");

CREATE INDEX IF NOT EXISTS "generation_tasks_source_case_id_idx"
  ON "generation_tasks" ("source_case_id");

CREATE INDEX IF NOT EXISTS "generation_tasks_created_at_idx"
  ON "generation_tasks" ("created_at");

CREATE TABLE IF NOT EXISTS "generated_assets" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" text NOT NULL,
  "user_id" text NOT NULL,
  "output_index" integer NOT NULL,
  "storage_url" text NOT NULL,
  "provider_url" text,
  "b64_json" text,
  "mime_type" text DEFAULT 'image/png' NOT NULL,
  "width" integer,
  "height" integer,
  "credits_charged" integer DEFAULT 0 NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "generated_assets_task_id_idx"
  ON "generated_assets" ("task_id");

CREATE INDEX IF NOT EXISTS "generated_assets_user_id_idx"
  ON "generated_assets" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "generated_assets_task_output_idx"
  ON "generated_assets" ("task_id", "output_index");
