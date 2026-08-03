#!/usr/bin/env node

const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const { createPostgresPool } = require("../src/db/pool");
const { migrateDatabase, withTransaction } = require("../src/db/migrate");

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]);
    return result;
  }, {});
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function tableRows(db, table) {
  try {
    return db.prepare(`SELECT * FROM ${table}`).all();
  } catch (error) {
    if (String(error.message).includes("no such table")) return [];
    throw error;
  }
}

function readLegacySnapshot({ dbPath }) {
  if (!dbPath) throw new Error("A legacy SQLite path is required");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      users: tableRows(db, "users").sort((a, b) => String(a.id).localeCompare(String(b.id))),
      transactions: tableRows(db, "credit_transactions").sort((a, b) => String(a.id).localeCompare(String(b.id))),
      tasks: tableRows(db, "generation_tasks").sort((a, b) => String(a.id).localeCompare(String(b.id))),
      templates: tableRows(db, "templates").sort((a, b) => String(a.id).localeCompare(String(b.id))),
      orders: tableRows(db, "orders").sort((a, b) => String(a.id).localeCompare(String(b.id))),
      paymentAudit: tableRows(db, "payment_audit").sort((a, b) => String(a.id).localeCompare(String(b.id))),
    };
  } finally {
    db.close();
  }
}

function reconciliationIds(snapshot) {
  return {
    users: snapshot.users.map((row) => String(row.id)),
    transactions: snapshot.transactions.map((row) => String(row.id)),
    tasks: snapshot.tasks.map((row) => String(row.id)),
    templates: snapshot.templates.map((row) => String(row.id)),
    orders: snapshot.orders.map((row) => String(row.id)),
    paymentAudit: snapshot.paymentAudit.map((row) => String(row.id)),
    totalBalance: snapshot.users.reduce((sum, row) => sum + Number(row.balance || 0), 0),
  };
}

function reconciliationPayload(snapshot) {
  const ids = reconciliationIds(snapshot);
  return {
    users: ids.users.length,
    transactions: ids.transactions.length,
    tasks: ids.tasks.length,
    templates: ids.templates.length,
    orders: ids.orders.length,
    paymentAudit: ids.paymentAudit.length,
    totalBalance: ids.totalBalance,
    checksum: checksum(ids),
  };
}

function buildLegacyMigrationPlan({ dbPath }) {
  const snapshot = readLegacySnapshot({ dbPath });
  const expected = reconciliationPayload(snapshot);
  return { snapshot, expected };
}

function reconcileMigration(expected, actual) {
  const checks = [
    ["users", expected.users, actual.users],
    ["tasks", expected.tasks, actual.tasks],
    ["orders", expected.orders, actual.orders],
    ["total balance", expected.totalBalance, actual.totalBalance],
    ["checksum", expected.checksum, actual.checksum],
  ];
  const mismatches = checks.filter(([, left, right]) => left !== right).map(([name, left, right]) => `${name}: expected ${left}, got ${right}`);
  if (mismatches.length) {
    const error = new Error(`Legacy migration reconciliation mismatch: ${mismatches.join("; ")}`);
    error.code = "LEGACY_RECONCILIATION_MISMATCH";
    error.mismatches = mismatches;
    throw error;
  }
  return true;
}

async function importedSnapshot(client) {
  const [users, transactions, tasks, templates, orders, paymentAudit] = await Promise.all([
    client.query("SELECT id, balance FROM miniapp_users ORDER BY id"),
    client.query("SELECT id FROM credit_transactions ORDER BY id"),
    client.query("SELECT id FROM generation_tasks ORDER BY id"),
    client.query("SELECT id FROM templates ORDER BY id"),
    client.query("SELECT id FROM miniapp_orders ORDER BY id"),
    client.query("SELECT id FROM payment_audit_events ORDER BY id"),
  ]);
  return {
    users: users.rows,
    transactions: transactions.rows,
    tasks: tasks.rows,
    templates: templates.rows,
    orders: orders.rows,
    paymentAudit: paymentAudit.rows,
  };
}

function importedReconciliation(snapshot) {
  const ids = {
    users: snapshot.users.map((row) => String(row.id)),
    transactions: snapshot.transactions.map((row) => String(row.id)),
    tasks: snapshot.tasks.map((row) => String(row.id)),
    templates: snapshot.templates.map((row) => String(row.id)),
    orders: snapshot.orders.map((row) => String(row.id)),
    paymentAudit: snapshot.paymentAudit.map((row) => String(row.id)),
    totalBalance: snapshot.users.reduce((sum, row) => sum + Number(row.balance || 0), 0),
  };
  return { users: ids.users.length, transactions: ids.transactions.length, tasks: ids.tasks.length, templates: ids.templates.length, orders: ids.orders.length, paymentAudit: ids.paymentAudit.length, totalBalance: ids.totalBalance, checksum: checksum(ids) };
}

async function importSnapshot(client, snapshot, expected) {
  const now = new Date().toISOString();
  for (const row of snapshot.users) {
    const metadata = { legacyId: row.id, legacyRow: row };
    await client.query(`
      INSERT INTO miniapp_users (id, provider, appid, openid, unionid, name, balance, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, $10), $10)
      ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `, [row.id, row.provider || "wechat", row.appid || "", row.openid || "", row.unionid || null, row.name || "微信用户", Number(row.balance || 0), JSON.stringify(metadata), row.created_at || null, now]);
    await client.query("INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, metadata, created_at, updated_at) VALUES ($1, $2, $3, $3, 'LEGACY_MIGRATION', $4, $5, $5) ON CONFLICT (id) DO NOTHING", [`legacy_package_${row.id}`, row.id, Number(row.balance || 0), JSON.stringify(metadata), row.created_at || now]);
  }
  for (const row of snapshot.transactions) {
    if (!Number(row.amount || 0)) continue;
    const metadata = { legacyId: row.id, legacyRow: row };
    await client.query(`
      INSERT INTO credit_transactions (id, trans_no, user_id, trans_type, credits, balance_after, reason, metadata, created_at)
      VALUES ($1, $2, $3, 'LEGACY_MIGRATION', $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [row.id, `legacy:${row.id}`, row.user_id, Number(row.amount), Number(row.balance_after || 0), row.reason || "legacy_migration", JSON.stringify(metadata), row.created_at || now]);
  }
  for (const row of snapshot.tasks) {
    await client.query(`
      INSERT INTO generation_tasks (id, owner_id, status, images, template_id, provider, provider_task_id, mode, prompt, topic, reference_images, model, output_count, aspect_ratio, resolution, raw_provider_result, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO NOTHING
    `, [row.id, row.owner_id, row.status || "completed", row.images_json || "[]", row.template_id || null, row.provider || null, row.provider_task_id || null, row.mode || null, row.prompt || "", row.topic || "", row.reference_images_json || "[]", row.model || "", Number(row.output_count || 1), row.aspect_ratio || "", row.resolution || "", row.raw_provider_result_json || null, JSON.stringify({ legacyId: row.id, legacyRow: row }), row.created_at || now, row.updated_at || row.created_at || now]);
  }
  const catalogId = `legacy_catalog_${expected.checksum.slice(0, 24)}`;
  await client.query("INSERT INTO template_catalog_versions (id, checksum, source, record_count, active, metadata) VALUES ($1, $2, 'legacy-sqlite', $3, TRUE, $4) ON CONFLICT (id) DO NOTHING", [catalogId, expected.checksum, snapshot.templates.length, JSON.stringify({ legacy: true })]);
  for (const row of snapshot.templates) {
    await client.query(`
      INSERT INTO templates (id, catalog_version_id, title, subtitle, category, scenario_category, source, source_id, source_url, thumbnail_url, preview_url, reference_images, prompt, use_case, author, metrics, seed, metadata, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO NOTHING
    `, [row.id, catalogId, row.title || "", row.subtitle || "", row.category || "", row.scenario_category || "", row.source || "", row.source_id || "", row.source_url || "", row.thumbnail_url || "", row.preview_url || "", row.reference_images_json || "[]", row.prompt || "", row.use_case || "", row.author || "", row.metrics_json || null, row.seed_json || null, JSON.stringify({ legacyId: row.id, legacyRow: row }), row.updated_at || now]);
  }
  for (const row of snapshot.orders) {
    const metadata = { legacyId: row.id, legacyRow: row, paymentVerified: false, paymentVerification: "not-verified" };
    const status = ["pending", "paid", "canceled", "refunded"].includes(row.status) ? row.status : "pending";
    await client.query(`
      INSERT INTO miniapp_orders (id, user_id, product_id, channel, status, payment_status, payment_mode, payment_verified, amount_cents, currency, credits, product_snapshot, payment_params, external_payment_id, credits_granted, credits_revoked, created_at, updated_at, paid_at, fulfilled_at, refunded_at, canceled_at, admin_note, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT (id) DO NOTHING
    `, [row.id, row.user_id, row.product_id || "legacy", row.channel || "wechat", status, row.payment_status || "unverified", row.payment_mode || "manual", Number(row.amount_cents || 0), row.currency || "CNY", Number(row.credits || 0), row.product_json || "{}", row.payment_params_json || null, row.external_payment_id || null, Number(row.credits_granted || 0), Number(row.credits_revoked || 0), row.created_at || now, row.updated_at || row.created_at || now, row.paid_at || null, row.fulfilled_at || null, row.refunded_at || null, row.canceled_at || null, row.admin_note || "", JSON.stringify(metadata)]);
  }
  for (const row of snapshot.paymentAudit) {
    await client.query("INSERT INTO payment_audit_events (id, order_id, user_id, type, actor_id, message, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING", [row.id, row.order_id || null, row.user_id || null, row.type || "legacy", row.actor_id || null, row.message || "", JSON.stringify({ legacyId: row.id, legacyRow: row, legacyMetadata: parseJson(row.metadata_json, null) }), row.created_at || now]);
  }
}

async function migrateSqliteToPostgres({ dbPath, pool, apply = false, logger = console } = {}) {
  const plan = buildLegacyMigrationPlan({ dbPath });
  if (!apply) {
    logger.log?.(JSON.stringify({ mode: "dry-run", ...plan.expected }));
    return { applied: false, reconciled: false, expected: plan.expected };
  }
  if (!pool) throw new Error("A PostgreSQL pool is required with --apply");
  const result = await withTransaction(pool, async (client) => {
    await importSnapshot(client, plan.snapshot, plan.expected);
    const actual = importedReconciliation(await importedSnapshot(client));
    reconcileMigration(plan.expected, actual);
    return actual;
  });
  return { applied: true, reconciled: true, expected: plan.expected, actual: result };
}

function cliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--sqlite") args.sqlitePath = argv[++index];
    else if (value === "--database-url") args.databaseUrl = argv[++index];
  }
  return args;
}

if (require.main === module) {
  (async () => {
    const args = cliArgs(process.argv.slice(2));
    if (!args.sqlitePath) throw new Error("Usage: node scripts/migrate-sqlite-to-postgres.js --sqlite <path> [--database-url <url>] [--apply]");
    if (!args.apply) {
      await migrateSqliteToPostgres({ dbPath: args.sqlitePath });
      return;
    }
    const pool = createPostgresPool({ url: args.databaseUrl || process.env.DATABASE_URL });
    try {
      await migrateDatabase({ pool });
      await migrateSqliteToPostgres({ dbPath: args.sqlitePath, pool, apply: true });
    } finally {
      await pool.end();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLegacyMigrationPlan,
  migrateSqliteToPostgres,
  reconcileMigration,
  readLegacySnapshot,
};
