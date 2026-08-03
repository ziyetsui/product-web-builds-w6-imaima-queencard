const { newDb } = require("pg-mem");

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const queries = [];
  const record = (sql, params) => queries.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params: params || [] });
  const pgMemSql = (sql, params = []) => {
    let text = String(sql).replace(/\$(\d+)/g, (_, index) => {
      const value = params[Number(index) - 1];
      if (value === null || value === undefined) return "NULL";
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
      return `'${String(value).replace(/'/g, "''")}'`;
    });
    const triggerStart = text.indexOf("CREATE OR REPLACE FUNCTION reject_credit_transaction_mutation");
    return triggerStart === -1 ? text : text.slice(0, triggerStart);
  };
  const query = pool.query.bind(pool);
  pool.query = (sql, params) => {
    if (Array.isArray(params) && params.length > 0) record(sql, params);
    return query(pgMemSql(sql, params), undefined);
  };
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const clientQuery = client.query.bind(client);
    client.query = (sql, params) => {
      if (/\$\d+/.test(String(sql)) || /^(BEGIN|COMMIT|ROLLBACK)\b/.test(String(sql).trim())) record(sql, params);
      return clientQuery(pgMemSql(sql, params), undefined);
    };
    return client;
  };
  pool.__queries = queries;
  return { db, pool };
}

module.exports = {
  createPgMemPool,
};
