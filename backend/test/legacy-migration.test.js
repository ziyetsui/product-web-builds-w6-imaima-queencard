const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSqliteStore } = require("../src/store");
const {
  buildLegacyMigrationPlan,
  legacyReconciliation,
  migrateSqliteToPostgres,
  readImportedReconciliation,
  reconcileMigration,
} = require("../scripts/migrate-sqlite-to-postgres");
const { createPostgresStore } = require("../src/repositories/postgres-store");
const { applyPgMemSchema, createPgMemPool } = require("./support/pg-mem");

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-legacy-")), "miniapp.sqlite");
}

test("legacy migration is dry-run by default and preserves ids and unverified payment metadata", async () => {
  const dbPath = tempDbPath();
  const sqlite = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = sqlite.ensureUser({ sub: "wechat:wx-legacy:openid-1", appid: "wx-legacy", openid: "openid-1" });
  sqlite.charge(user.id, 2, "legacy-charge");
  sqlite.createTask({
    id: "legacy-task-1",
    ownerId: user.id,
    status: "completed",
    images: ["https://legacy.example/generated.png"],
    prompt: "legacy task prompt",
    referenceImages: ["https://legacy.example/reference.png"],
    rawProviderResult: { requestId: "legacy-request-1" },
  });
  sqlite.syncTemplates([{
    id: "legacy-template-1",
    title: "Legacy template",
    prompt: "legacy template prompt",
    referenceImages: ["https://legacy.example/template-reference.png"],
    previewUrl: "https://legacy.example/template-preview.png",
    source: "legacy",
  }]);
  sqlite.createOrder({ id: "legacy-order-1", userId: user.id, productId: "legacy-pack", amountCents: 100, credits: 1, status: "paid", paymentStatus: "fulfilled", paymentMode: "mock" });
  sqlite.recordPaymentEvent({ id: "legacy-audit-1", orderId: "legacy-order-1", userId: user.id, type: "pay", message: "mock" });
  sqlite.close();

  const plan = buildLegacyMigrationPlan({ dbPath });
  assert.equal(plan.expected.users, 1);
  assert.equal(plan.expected.tasks, 1);
  assert.equal(plan.expected.templates, 1);
  assert.equal(plan.expected.orders, 1);
  assert.equal(plan.expected.totalBalance, 8);

  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const dryRun = await migrateSqliteToPostgres({ dbPath, pool });
  assert.equal(dryRun.applied, false);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM miniapp_users")).rows[0].count, 0);

  const applied = await migrateSqliteToPostgres({ dbPath, pool, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.reconciled, true);
  const importedUser = (await pool.query("SELECT id, balance, updated_at FROM miniapp_users WHERE id = $1", [user.id])).rows[0];
  assert.deepEqual({ id: importedUser.id, balance: importedUser.balance }, { id: user.id, balance: 8 });
  assert.equal(new Date(importedUser.updated_at).toISOString(), new Date(plan.snapshot.users[0].updated_at).toISOString());
  const importedOrder = (await pool.query("SELECT id, payment_verified, metadata FROM miniapp_orders WHERE id = $1", ["legacy-order-1"])).rows[0];
  assert.equal(importedOrder.payment_verified, false);
  assert.equal(importedOrder.metadata.legacyId, "legacy-order-1");
  const postgresStore = createPostgresStore({ pool, clock: () => new Date("2026-08-03T00:00:00.000Z") });
  await assert.rejects(postgresStore.fulfillOrder("legacy-order-1", { paymentVerified: true }), /verified payment event required/i);

  const reconciled = await readImportedReconciliation(pool);
  assert.equal(reconcileMigration(plan.expected, reconciled), true);
  await pool.query("UPDATE miniapp_users SET updated_at = $1 WHERE id = $2", ["2030-01-01T00:00:00.000Z", user.id]);
  await assert.rejects(
    readImportedReconciliation(pool).then((actual) => reconcileMigration(plan.expected, actual)),
    /reconciliation mismatch/i,
  );
  await pool.query("UPDATE miniapp_users SET updated_at = $1 WHERE id = $2", [plan.snapshot.users[0].updated_at, user.id]);
  assert.equal(reconcileMigration(plan.expected, await readImportedReconciliation(pool)), true);
  await pool.query("UPDATE generation_tasks SET prompt = $1 WHERE id = $2", ["corrupted target prompt", "legacy-task-1"]);
  await assert.rejects(
    readImportedReconciliation(pool).then((actual) => reconcileMigration(plan.expected, actual)),
    /reconciliation mismatch/i,
  );
  await pool.end();
});

test("legacy checksum covers transaction, task assets and request, template assets and prompt, order payment fields, and audits", () => {
  const snapshot = {
    users: [{ id: "u1", provider: "wechat", appid: "wx", openid: "o1", unionid: null, name: "User", balance: 8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:30.000Z" }],
    transactions: [{ id: "tx1", user_id: "u1", amount: -2, reason: "generation", balance_after: 8, created_at: "2026-01-01T00:01:00.000Z" }],
    tasks: [{ id: "task1", owner_id: "u1", status: "completed", images_json: '["image-a"]', prompt: "task prompt", reference_images_json: '["reference-a"]', raw_provider_result_json: '{"request":"request-a"}', created_at: "2026-01-01T00:02:00.000Z", updated_at: "2026-01-01T00:03:00.000Z" }],
    templates: [{ id: "template1", title: "Template", prompt: "template prompt", reference_images_json: '["template-reference-a"]', preview_url: "preview-a", updated_at: "2026-01-01T00:04:00.000Z" }],
    orders: [{ id: "order1", user_id: "u1", product_id: "pack", channel: "wechat", status: "paid", payment_status: "fulfilled", payment_mode: "mock", amount_cents: 100, currency: "CNY", credits: 1, product_json: '{"id":"pack"}', credits_granted: 0, credits_revoked: 0, created_at: "2026-01-01T00:05:00.000Z", updated_at: "2026-01-01T00:06:00.000Z" }],
    paymentAudit: [{ id: "audit1", order_id: "order1", user_id: "u1", type: "pay", actor_id: "u1", message: "legacy mock", metadata_json: '{"mode":"mock"}', created_at: "2026-01-01T00:07:00.000Z" }],
  };
  const baseline = legacyReconciliation(snapshot).checksum;
  const corruptions = [
    (copy) => { copy.users[0].updated_at = "2026-01-02T00:00:30.000Z"; },
    (copy) => { copy.transactions[0].amount = -3; },
    (copy) => { copy.tasks[0].images_json = '["image-b"]'; },
    (copy) => { copy.tasks[0].raw_provider_result_json = '{"request":"request-b"}'; },
    (copy) => { copy.templates[0].prompt = "changed template prompt"; },
    (copy) => { copy.templates[0].preview_url = "preview-b"; },
    (copy) => { copy.orders[0].amount_cents = 101; },
    (copy) => { copy.orders[0].payment_mode = "manual"; },
    (copy) => { copy.paymentAudit[0].message = "changed audit"; },
  ];
  for (const corrupt of corruptions) {
    const copy = structuredClone(snapshot);
    corrupt(copy);
    assert.notEqual(legacyReconciliation(copy).checksum, baseline);
  }
});

test("legacy reconciliation rejects count, balance, and checksum mismatches", () => {
  const expected = {
    users: 1,
    tasks: 2,
    orders: 3,
    totalBalance: 8,
    checksum: "expected-checksum",
  };
  for (const mismatch of [
    { users: 2, tasks: 2, orders: 3, totalBalance: 8, checksum: "expected-checksum" },
    { users: 1, tasks: 1, orders: 3, totalBalance: 8, checksum: "expected-checksum" },
    { users: 1, tasks: 2, orders: 3, totalBalance: 7, checksum: "expected-checksum" },
    { users: 1, tasks: 2, orders: 3, totalBalance: 8, checksum: "wrong-checksum" },
  ]) {
    assert.throws(() => reconcileMigration(expected, mismatch), /reconciliation mismatch/i);
  }
  assert.equal(reconcileMigration(expected, expected), true);
});
