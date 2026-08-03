const fs = require("node:fs");

const { newDb } = require("pg-mem");

const migrationPath = require.resolve("../../migrations/001_initial.sql");
const identityMigrationPath = require.resolve("../../migrations/002_payment_and_retry_identity.sql");
const orderIdentityMigrationPath = require.resolve("../../migrations/003_order_request_identity.sql");
const versionedTemplatesMigrationPath = require.resolve("../../migrations/004_versioned_template_rows.sql");

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const queries = [];
  const record = (sql, params) => queries.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params: params || [] });
  const query = pool.query.bind(pool);
  pool.query = (sql, params) => {
    if (Array.isArray(params) && params.length > 0) record(sql, params);
    return query(sql, params);
  };
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const clientQuery = client.query.bind(client);
    client.query = (sql, params) => {
      if (/\$\d+/.test(String(sql)) || /^(BEGIN|COMMIT|ROLLBACK)\b/.test(String(sql).trim())) record(sql, params);
      return clientQuery(sql, params);
    };
    return client;
  };
  pool.__queries = queries;
  return { db, pool };
}

async function applyPgMemSchema(pool) {
  const raw = fs.readFileSync(migrationPath, "utf8");
  const unsupported = raw.indexOf("CREATE OR REPLACE FUNCTION reject_credit_transaction_mutation");
  if (unsupported < 0) throw new Error("Expected PostgreSQL trigger boundary was not found");
  const supportedSchema = raw.slice(0, unsupported)
    .replace(
      "CHECK (remaining_credits + frozen_credits <= initial_credits)",
      "CHECK (TRUE)",
    )
    // pg-mem retains a stale id index after DROP CONSTRAINT.
    .replace(
      "CREATE TABLE IF NOT EXISTS templates (\n  id TEXT PRIMARY KEY,",
      "CREATE TABLE IF NOT EXISTS templates (\n  id TEXT NOT NULL,",
    );
  await pool.query(supportedSchema);
  await pool.query(fs.readFileSync(identityMigrationPath, "utf8"));
  await pool.query(fs.readFileSync(orderIdentityMigrationPath, "utf8"));
  // pg-mem also misroutes equality lookups through partial indexes. Its harness
  // uses the equivalent versioned composite index without partial predicates.
  const versionedTemplatesMigration = fs.readFileSync(versionedTemplatesMigrationPath, "utf8")
    .replace(/\n\s+WHERE catalog_version_id IS NOT NULL;/, ";")
    .replace(/\nCREATE UNIQUE INDEX IF NOT EXISTS templates_legacy_template_id_unique[\s\S]+?;/, "");
  await pool.query(versionedTemplatesMigration);
}

module.exports = {
  applyPgMemSchema,
  createPgMemPool,
};
