const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSqliteStore } = require("../src/store");
const {
  buildLegacyMigrationPlan,
  migrateSqliteToPostgres,
  reconcileMigration,
} = require("../scripts/migrate-sqlite-to-postgres");
const { migrateDatabase } = require("../src/db/migrate");
const { createPgMemPool } = require("./support/pg-mem");

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-legacy-")), "miniapp.sqlite");
}

test("legacy migration is dry-run by default and preserves ids and unverified payment metadata", async () => {
  const dbPath = tempDbPath();
  const sqlite = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = sqlite.ensureUser({ sub: "wechat:wx-legacy:openid-1", appid: "wx-legacy", openid: "openid-1" });
  sqlite.charge(user.id, 2, "legacy-charge");
  sqlite.createTask({ id: "legacy-task-1", ownerId: user.id, status: "completed", images: [], prompt: "legacy" });
  sqlite.createOrder({ id: "legacy-order-1", userId: user.id, productId: "legacy-pack", amountCents: 100, credits: 1, status: "paid", paymentStatus: "fulfilled", paymentMode: "mock" });
  sqlite.recordPaymentEvent({ id: "legacy-audit-1", orderId: "legacy-order-1", userId: user.id, type: "pay", message: "mock" });
  sqlite.close();

  const plan = buildLegacyMigrationPlan({ dbPath });
  assert.equal(plan.expected.users, 1);
  assert.equal(plan.expected.tasks, 1);
  assert.equal(plan.expected.orders, 1);
  assert.equal(plan.expected.totalBalance, 8);

  const { pool } = createPgMemPool();
  await migrateDatabase({ pool });
  const dryRun = await migrateSqliteToPostgres({ dbPath, pool });
  assert.equal(dryRun.applied, false);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM miniapp_users")).rows[0].count, 0);

  const applied = await migrateSqliteToPostgres({ dbPath, pool, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.reconciled, true);
  const importedUser = (await pool.query("SELECT id, balance FROM miniapp_users WHERE id = $1", [user.id])).rows[0];
  assert.deepEqual(importedUser, { id: user.id, balance: 8 });
  const importedOrder = (await pool.query("SELECT id, payment_verified, metadata FROM miniapp_orders WHERE id = $1", ["legacy-order-1"])).rows[0];
  assert.equal(importedOrder.payment_verified, false);
  assert.equal(importedOrder.metadata.legacyId, "legacy-order-1");
  await pool.end();
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
