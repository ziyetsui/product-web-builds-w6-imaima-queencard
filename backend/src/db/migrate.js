const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIGRATION_DIR = path.resolve(__dirname, "../../migrations");

async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

function migrationFiles(migrationDir = DEFAULT_MIGRATION_DIR) {
  return fs.readdirSync(migrationDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      version: Number.parseInt(file, 10),
      name: file,
      sql: fs.readFileSync(path.join(migrationDir, file), "utf8"),
    }));
}

async function migrateDatabase({ pool, migrationDir = DEFAULT_MIGRATION_DIR } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL pool is required");
  const files = migrationFiles(migrationDir);
  return withTransaction(pool, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS miniapp_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = await client.query("SELECT version FROM miniapp_schema_migrations ORDER BY version ASC");
    const versions = new Set(applied.rows.map((row) => Number(row.version)));
    const result = [];
    for (const file of files) {
      if (versions.has(file.version)) {
        result.push({ version: file.version, name: file.name, applied: false });
        continue;
      }
      await client.query(file.sql);
      await client.query(
        "INSERT INTO miniapp_schema_migrations (version, name) VALUES ($1, $2)",
        [file.version, file.name],
      );
      result.push({ version: file.version, name: file.name, applied: true });
    }
    return result;
  });
}

module.exports = {
  DEFAULT_MIGRATION_DIR,
  migrateDatabase,
  migrationFiles,
  withTransaction,
};
