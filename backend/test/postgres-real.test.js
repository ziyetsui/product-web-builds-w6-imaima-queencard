const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { Pool } = require("pg");

const { migrateDatabase } = require("../src/db/migrate");
const { createPostgresStore } = require("../src/repositories/postgres-store");

const databaseUrl = process.env.DATABASE_URL_TEST || "";
const required = process.env.REQUIRE_DATABASE_URL_TEST === "1";

test("real PostgreSQL migration, trigger, binding, accounting, and concurrency", {
  skip: !databaseUrl && !required ? "DATABASE_URL_TEST is not configured" : false,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_TEST is required for the explicit PostgreSQL integration test");
  const schema = `miniapp_test_${process.pid}_${crypto.randomBytes(6).toString("hex")}`;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  let testPool;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    testPool = new Pool({
      connectionString: databaseUrl,
      max: 6,
      options: `-c search_path=${schema}`,
    });
    const migrations = await migrateDatabase({ pool: testPool });
    assert.equal(migrations.some((entry) => entry.version === 1 && entry.applied), true);
    assert.equal(migrations.some((entry) => entry.version === 2 && entry.applied), true);

    const storeA = createPostgresStore({ pool: testPool, initialCredits: 10 });
    const storeB = createPostgresStore({ pool: testPool, initialCredits: 10 });
    const identity = { sub: "real-pg-user", appid: "wx-real-pg", openid: "quoted-'-$2" };
    const user = await storeA.ensureUser(identity);
    assert.equal((await storeB.getUserByIdentity(identity.appid, identity.openid)).id, user.id);

    const packages = await Promise.all([
      storeA.createCreditPackage({ id: "real-retry-package", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" }),
      storeB.createCreditPackage({ id: "real-retry-package", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" }),
    ]);
    assert.equal(packages[0].id, packages[1].id);

    const holds = await Promise.all([
      storeA.createCreditHold({ id: "real-hold-a", userId: user.id, idempotencyKey: "real-hold-key", credits: 2 }),
      storeB.createCreditHold({ id: "real-hold-b", userId: user.id, idempotencyKey: "real-hold-key", credits: 2 }),
    ]);
    assert.equal(holds[0].id, holds[1].id);

    const tasks = await Promise.all([
      storeA.createTask({ id: "real-task-a", ownerId: user.id, idempotencyKey: "real-task-key", status: "pending" }),
      storeB.createTask({ id: "real-task-b", ownerId: user.id, idempotencyKey: "real-task-key", status: "pending" }),
    ]);
    assert.equal(tasks[0].id, tasks[1].id);

    const orders = await Promise.all([
      storeA.createOrder({ id: "real-order-a", userId: user.id, idempotencyKey: "real-order-key", productId: "credits-5", amountCents: 500, credits: 5 }),
      storeB.createOrder({ id: "real-order-b", userId: user.id, idempotencyKey: "real-order-key", productId: "credits-5", amountCents: 500, credits: 5 }),
    ]);
    assert.equal(orders[0].id, orders[1].id);

    const charges = await Promise.allSettled([
      storeA.charge(user.id, 10, "real-concurrent-charge-a"),
      storeB.charge(user.id, 10, "real-concurrent-charge-b"),
    ]);
    assert.equal(charges.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(charges.filter((entry) => entry.status === "rejected").length, 1);

    const rollbackUser = await storeA.ensureUser({ sub: "real-rollback-user", appid: "wx-real-pg", openid: "real-rollback-openid" });
    await assert.rejects(storeA.createCreditHold({
      id: "real-rollback-hold",
      userId: rollbackUser.id,
      taskId: "real-rollback-task",
      idempotencyKey: "real-rollback-key",
      credits: 1,
      packageAllocation: [{ packageId: "missing-real-package", credits: 1 }],
    }), /insufficient credits/i);
    assert.equal((await storeA.getUser(rollbackUser.id)).balance, 10);
    assert.equal((await testPool.query("SELECT COUNT(*)::int AS count FROM credit_holds WHERE idempotency_key = $1", ["real-rollback-key"])).rows[0].count, 0);

    const paymentUserA = await storeA.ensureUser({ sub: "real-payment-user-a", appid: "wx-real-pg", openid: "real-payment-openid-a" });
    const paymentUserB = await storeB.ensureUser({ sub: "real-payment-user-b", appid: "wx-real-pg", openid: "real-payment-openid-b" });
    const paymentOrderA = await storeA.createOrder({ id: "real-payment-order-a", userId: paymentUserA.id, productId: "credits-5", paymentMode: "wechat", amountCents: 500, credits: 5 });
    const paymentOrderB = await storeB.createOrder({ id: "real-payment-order-b", userId: paymentUserB.id, productId: "credits-5", paymentMode: "wechat", amountCents: 500, credits: 5 });
    const paymentIdentity = { provider: "wechat", eventId: "real-payment-event", providerTransactionId: "real-provider-transaction", status: "FULFILLED", paymentVerified: true };
    const originalFulfillment = await storeA.fulfillPayment({ ...paymentIdentity, fulfillmentKey: "real-payment-key-a", orderId: paymentOrderA.id });
    const replayFulfillment = await storeB.fulfillPayment({ ...paymentIdentity, fulfillmentKey: "real-payment-key-b", orderId: paymentOrderA.id });
    assert.equal(replayFulfillment.id, originalFulfillment.id);
    await assert.rejects(
      storeB.fulfillPayment({ ...paymentIdentity, fulfillmentKey: "real-payment-key-c", eventId: "real-payment-event-c", orderId: paymentOrderB.id }),
      (error) => error.status === 409,
    );
    assert.equal((await storeB.getUser(paymentUserB.id)).balance, 10);

    const state = await testPool.query(`
      SELECT u.balance, COALESCE(SUM(p.remaining_credits), 0)::int AS available,
             COALESCE(SUM(p.frozen_credits), 0)::int AS frozen
      FROM miniapp_users u LEFT JOIN credit_packages p ON p.user_id = u.id
      WHERE u.id = $1 GROUP BY u.balance
    `, [user.id]);
    assert.deepEqual(state.rows[0], { balance: 3, available: 3, frozen: 2 });

    await assert.rejects(
      testPool.query("UPDATE credit_transactions SET reason = $1 WHERE user_id = $2", ["tampered", user.id]),
      /append-only|credit_transactions/i,
    );
  } finally {
    if (testPool) await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
});
