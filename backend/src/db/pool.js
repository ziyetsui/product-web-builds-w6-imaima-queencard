const { Pool } = require("pg");

const { migrateDatabase } = require("./migrate");

function createPostgresPool(options = {}) {
  const url = options.url || options.connectionString || options.config?.url;
  if (!url) {
    const error = new Error("DATABASE_URL is required for PostgreSQL");
    error.code = "DATABASE_URL_MISSING";
    throw error;
  }
  const pool = new (options.Pool || Pool)({
    connectionString: url,
    max: options.max || options.poolMax || options.config?.poolMax || 10,
    idleTimeoutMillis: options.idleTimeoutMillis || options.config?.idleTimeoutMs || 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || options.config?.connectionTimeoutMs || 5000,
    ssl: options.ssl || options.config?.ssl ? { rejectUnauthorized: false } : false,
  });
  let initialization = null;
  pool.initialize = async () => {
    if (!initialization) {
      initialization = migrateDatabase({ pool }).catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  };
  return pool;
}

module.exports = {
  createPostgresPool,
};
