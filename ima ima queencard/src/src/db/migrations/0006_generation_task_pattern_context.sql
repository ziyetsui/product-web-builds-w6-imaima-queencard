ALTER TABLE "generation_tasks"
  ADD COLUMN IF NOT EXISTS "pattern_context" jsonb;
