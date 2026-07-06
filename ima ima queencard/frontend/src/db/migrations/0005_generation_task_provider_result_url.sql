ALTER TABLE "generation_tasks"
  ADD COLUMN IF NOT EXISTS "provider_result_url" text;
