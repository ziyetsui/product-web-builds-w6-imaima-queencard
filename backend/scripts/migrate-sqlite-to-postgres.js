#!/usr/bin/env node

const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const { createPostgresPool } = require("../src/db/pool");
const { migrateDatabase, withTransaction } = require("../src/db/migrate");

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
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

function normalizedTime(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizedRows(rows, mapper) {
  return rows.map(mapper).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function legacyContent(snapshot) {
  return {
    users: normalizedRows(snapshot.users, (row) => ({
      id: String(row.id), provider: row.provider || "wechat", appid: row.appid || "", openid: row.openid || "",
      unionid: row.unionid || null, name: row.name || "微信用户", balance: Number(row.balance || 0), createdAt: normalizedTime(row.created_at),
    })),
    transactions: normalizedRows(snapshot.transactions, (row) => ({
      id: String(row.id), userId: String(row.user_id), credits: Number(row.amount), balanceAfter: Number(row.balance_after || 0),
      reason: row.reason || "legacy_migration", createdAt: normalizedTime(row.created_at),
    })),
    tasks: normalizedRows(snapshot.tasks, (row) => ({
      id: String(row.id), ownerId: String(row.owner_id), status: row.status || "completed", images: parseJson(row.images_json, []),
      templateId: row.template_id || null, provider: row.provider || null, providerTaskId: row.provider_task_id || null,
      mode: row.mode || null, prompt: row.prompt || "", topic: row.topic || "", referenceImages: parseJson(row.reference_images_json, []),
      model: row.model || "", outputCount: Number(row.output_count || 1), aspectRatio: row.aspect_ratio || "", resolution: row.resolution || "",
      rawProviderResult: parseJson(row.raw_provider_result_json, null), createdAt: normalizedTime(row.created_at),
      updatedAt: normalizedTime(row.updated_at || row.created_at),
    })),
    templates: normalizedRows(snapshot.templates, (row) => ({
      id: String(row.id), title: row.title || "", subtitle: row.subtitle || "", category: row.category || "",
      scenarioCategory: row.scenario_category || "", source: row.source || "", sourceId: row.source_id || "", sourceUrl: row.source_url || "",
      thumbnailUrl: row.thumbnail_url || "", previewUrl: row.preview_url || "", referenceImages: parseJson(row.reference_images_json, []),
      prompt: row.prompt || "", useCase: row.use_case || "", author: row.author || "", metrics: parseJson(row.metrics_json, null),
      seed: parseJson(row.seed_json, null), updatedAt: normalizedTime(row.updated_at),
    })),
    orders: normalizedRows(snapshot.orders, (row) => ({
      id: String(row.id), userId: String(row.user_id), productId: row.product_id || "legacy", channel: row.channel || "wechat",
      status: ["pending", "paid", "canceled", "refunded"].includes(row.status) ? row.status : "pending",
      paymentStatus: row.payment_status || "unverified", paymentMode: row.payment_mode || "manual", paymentVerified: false,
      paymentVerification: "not-verified", amountCents: Number(row.amount_cents || 0), currency: row.currency || "CNY",
      credits: Number(row.credits || 0), productSnapshot: parseJson(row.product_json, {}) || {}, paymentParams: parseJson(row.payment_params_json, null),
      externalPaymentId: row.external_payment_id || null, creditsGranted: Number(row.credits_granted || 0), creditsRevoked: Number(row.credits_revoked || 0),
      createdAt: normalizedTime(row.created_at), updatedAt: normalizedTime(row.updated_at || row.created_at), paidAt: normalizedTime(row.paid_at),
      fulfilledAt: normalizedTime(row.fulfilled_at), refundedAt: normalizedTime(row.refunded_at), canceledAt: normalizedTime(row.canceled_at),
      adminNote: row.admin_note || "",
    })),
    paymentAudit: normalizedRows(snapshot.paymentAudit, (row) => ({
      id: String(row.id), orderId: row.order_id || null, userId: row.user_id || null, type: row.type || "legacy",
      actorId: row.actor_id || null, message: row.message || "", metadata: parseJson(row.metadata_json, null), createdAt: normalizedTime(row.created_at),
    })),
  };
}

function importedContent(snapshot) {
  return {
    users: normalizedRows(snapshot.users, (row) => ({
      id: String(row.id), provider: row.provider, appid: row.appid, openid: row.openid, unionid: row.unionid || null,
      name: row.name, balance: Number(row.balance || 0), createdAt: normalizedTime(row.created_at),
    })),
    transactions: normalizedRows(snapshot.transactions, (row) => ({
      id: String(row.id), userId: String(row.user_id), credits: Number(row.credits), balanceAfter: Number(row.balance_after || 0),
      reason: row.reason || "legacy_migration", createdAt: normalizedTime(row.created_at),
    })),
    tasks: normalizedRows(snapshot.tasks, (row) => ({
      id: String(row.id), ownerId: String(row.owner_id), status: row.status, images: parseJson(row.images, []), templateId: row.template_id || null,
      provider: row.provider || null, providerTaskId: row.provider_task_id || null, mode: row.mode || null, prompt: row.prompt || "", topic: row.topic || "",
      referenceImages: parseJson(row.reference_images, []), model: row.model || "", outputCount: Number(row.output_count || 1),
      aspectRatio: row.aspect_ratio || "", resolution: row.resolution || "", rawProviderResult: parseJson(row.raw_provider_result, null),
      createdAt: normalizedTime(row.created_at), updatedAt: normalizedTime(row.updated_at),
    })),
    templates: normalizedRows(snapshot.templates, (row) => ({
      id: String(row.id), title: row.title || "", subtitle: row.subtitle || "", category: row.category || "", scenarioCategory: row.scenario_category || "",
      source: row.source || "", sourceId: row.source_id || "", sourceUrl: row.source_url || "", thumbnailUrl: row.thumbnail_url || "",
      previewUrl: row.preview_url || "", referenceImages: parseJson(row.reference_images, []), prompt: row.prompt || "", useCase: row.use_case || "",
      author: row.author || "", metrics: parseJson(row.metrics, null), seed: parseJson(row.seed, null), updatedAt: normalizedTime(row.updated_at),
    })),
    orders: normalizedRows(snapshot.orders, (row) => {
      const metadata = parseJson(row.metadata, {});
      return {
        id: String(row.id), userId: String(row.user_id), productId: row.product_id, channel: row.channel, status: row.status,
        paymentStatus: row.payment_status, paymentMode: row.payment_mode, paymentVerified: Boolean(row.payment_verified),
        paymentVerification: metadata.paymentVerification || null, amountCents: Number(row.amount_cents || 0), currency: row.currency,
        credits: Number(row.credits || 0), productSnapshot: parseJson(row.product_snapshot, {}), paymentParams: parseJson(row.payment_params, null),
        externalPaymentId: row.external_payment_id || null, creditsGranted: Number(row.credits_granted || 0), creditsRevoked: Number(row.credits_revoked || 0),
        createdAt: normalizedTime(row.created_at), updatedAt: normalizedTime(row.updated_at), paidAt: normalizedTime(row.paid_at),
        fulfilledAt: normalizedTime(row.fulfilled_at), refundedAt: normalizedTime(row.refunded_at), canceledAt: normalizedTime(row.canceled_at),
        adminNote: row.admin_note || "",
      };
    }),
    paymentAudit: normalizedRows(snapshot.paymentAudit, (row) => {
      const metadata = parseJson(row.metadata, {});
      return {
        id: String(row.id), orderId: row.order_id || null, userId: row.user_id || null, type: row.type,
        actorId: row.actor_id || null, message: row.message || "", metadata: metadata.legacyMetadata ?? null, createdAt: normalizedTime(row.created_at),
      };
    }),
  };
}

function reconciliationSummary(content) {
  const totalBalance = content.users.reduce((sum, row) => sum + row.balance, 0);
  return {
    users: content.users.length,
    transactions: content.transactions.length,
    tasks: content.tasks.length,
    templates: content.templates.length,
    orders: content.orders.length,
    paymentAudit: content.paymentAudit.length,
    totalBalance,
    checksum: checksum({ ...content, totalBalance }),
  };
}

function legacyReconciliation(snapshot) {
  return reconciliationSummary(legacyContent(snapshot));
}

function buildLegacyMigrationPlan({ dbPath }) {
  const snapshot = readLegacySnapshot({ dbPath });
  const expected = legacyReconciliation(snapshot);
  return { snapshot, expected };
}

function reconcileMigration(expected, actual) {
  const checks = [
    ["users", expected.users, actual.users],
    ["transactions", expected.transactions, actual.transactions],
    ["tasks", expected.tasks, actual.tasks],
    ["templates", expected.templates, actual.templates],
    ["orders", expected.orders, actual.orders],
    ["payment audit", expected.paymentAudit, actual.paymentAudit],
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
    client.query("SELECT id, provider, appid, openid, unionid, name, balance, created_at FROM miniapp_users ORDER BY id"),
    client.query("SELECT id, user_id, credits, balance_after, reason, created_at FROM credit_transactions ORDER BY id"),
    client.query("SELECT id, owner_id, status, images, template_id, provider, provider_task_id, mode, prompt, topic, reference_images, model, output_count, aspect_ratio, resolution, raw_provider_result, created_at, updated_at FROM generation_tasks ORDER BY id"),
    client.query("SELECT id, title, subtitle, category, scenario_category, source, source_id, source_url, thumbnail_url, preview_url, reference_images, prompt, use_case, author, metrics, seed, updated_at FROM templates ORDER BY id"),
    client.query("SELECT id, user_id, product_id, channel, status, payment_status, payment_mode, payment_verified, amount_cents, currency, credits, product_snapshot, payment_params, external_payment_id, credits_granted, credits_revoked, created_at, updated_at, paid_at, fulfilled_at, refunded_at, canceled_at, admin_note, metadata FROM miniapp_orders ORDER BY id"),
    client.query("SELECT id, order_id, user_id, type, actor_id, message, metadata, created_at FROM payment_audit_events ORDER BY id"),
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

async function readImportedReconciliation(queryable) {
  return reconciliationSummary(await readImportedContent(queryable));
}

async function readImportedContent(queryable) {
  return importedContent(await importedSnapshot(queryable));
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
    `, [row.id, row.user_id, row.product_id || "legacy", row.channel || "wechat", status, row.payment_status || "unverified", row.payment_mode || "manual", Number(row.amount_cents || 0), row.currency || "CNY", Number(row.credits || 0), JSON.stringify(parseJson(row.product_json, {}) || {}), row.payment_params_json || null, row.external_payment_id || null, Number(row.credits_granted || 0), Number(row.credits_revoked || 0), row.created_at || now, row.updated_at || row.created_at || now, row.paid_at || null, row.fulfilled_at || null, row.refunded_at || null, row.canceled_at || null, row.admin_note || "", JSON.stringify(metadata)]);
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
    const actual = await readImportedReconciliation(client);
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
  legacyContent,
  legacyReconciliation,
  migrateSqliteToPostgres,
  readImportedContent,
  readImportedReconciliation,
  reconcileMigration,
  readLegacySnapshot,
};
