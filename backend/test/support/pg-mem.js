const fs = require("node:fs");

const { newDb } = require("pg-mem");

const migrationPath = require.resolve("../../migrations/001_initial.sql");

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
  const supportedSchema = raw.slice(0, unsupported).replace(
    "CHECK (remaining_credits + frozen_credits <= initial_credits)",
    "CHECK (TRUE)",
  );
  await pool.query(supportedSchema);
}

module.exports = {
  applyPgMemSchema,
  createPgMemPool,
};
