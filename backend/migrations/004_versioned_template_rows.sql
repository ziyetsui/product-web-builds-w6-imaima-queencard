ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS templates_catalog_version_template_id_unique
  ON templates (catalog_version_id, id)
  WHERE catalog_version_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS templates_legacy_template_id_unique
  ON templates (id)
  WHERE catalog_version_id IS NULL;
