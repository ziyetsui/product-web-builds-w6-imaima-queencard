const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { createPostgresStore } = require("../src/repositories/postgres-store");
const { migrateDatabase } = require("../src/db/migrate");
const { assertStoreContract } = require("../src/repositories/store-contract");
const { createPgMemPool } = require("./support/pg-mem");

async function setup() {
  const { pool } = createPgMemPool();
  await migrateDatabase({ pool });
  const store = createPostgresStore({
    pool,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
    initialCredits: 10,
  });
  assertStoreContract(store);
  return { pool, store };
}

test("initial schema declares the production invariants", () => {
  const sql = fs.readFileSync(require.resolve("../migrations/001_initial.sql"), "utf8");
  for (const table of [
    "miniapp_users", "miniapp_sessions", "credit_packages", "credit_holds", "credit_transactions",
    "generation_tasks", "generated_assets", "reference_assets", "template_catalog_versions", "templates",
    "miniapp_orders", "payment_fulfillments", "payment_audit_events", "admin_audit_logs",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /UNIQUE \(appid, openid\)/);
  assert.match(sql, /UNIQUE \(owner_id, idempotency_key\)/);
  assert.match(sql, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(sql, /credit_transactions_immutable/);
  assert.match(sql, /generation_tasks_lease_idx/);
});

test("postgres repository contract persists identity, sessions, credits, tasks, assets, catalog, orders, and audits", async () => {
  const { pool, store } = await setup();
  const identity = {
    sub: "wechat:wx-test:openid-1",
    appid: "wx-test",
    openid: "openid-1",
    unionid: "union-1",
  };

  const user = await store.ensureUser(identity);
  assert.equal(user.id, identity.sub);
  assert.equal(user.balance, 10);
  assert.equal((await store.ensureUser(identity)).id, user.id);
  assert.equal((await store.getUserByIdentity("wx-test", "openid-1")).id, user.id);

  const session = await store.createSession({
    id: "session-1",
    userId: user.id,
    tokenHash: "hash-session-1",
    expiresAt: "2026-08-04T00:00:00.000Z",
    ipAddress: "127.0.0.1",
    userAgent: "test",
  });
  assert.equal((await store.getSessionByTokenHash("hash-session-1")).id, session.id);
  await store.touchSession(session.id);
  await store.revokeSession(session.id);
  assert.equal((await store.getSessionByTokenHash("hash-session-1")).revokedAt !== null, true);

  const pkg = await store.createCreditPackage({
    id: "package-1",
    userId: user.id,
    initialCredits: 5,
    remainingCredits: 5,
    transType: "SYSTEM_ADJUST",
    metadata: { source: "test" },
  });
  assert.equal(pkg.remainingCredits, 5);
  const hold = await store.createCreditHold({
    id: "hold-1",
    userId: user.id,
    taskId: "task-1",
    idempotencyKey: "hold-key-1",
    credits: 2,
    packageAllocation: [{ packageId: pkg.id, credits: 2 }],
  });
  assert.equal((await store.createCreditHold({
    userId: user.id,
    taskId: "task-1",
    idempotencyKey: "hold-key-1",
    credits: 2,
    packageAllocation: [{ packageId: pkg.id, credits: 2 }],
  })).id, hold.id);
  assert.equal((await store.settleCreditHold(hold.id, 1, { reason: "task:task-1" })).settledCredits, 1);
  assert.equal((await store.releaseCreditHold(hold.id)).status, "SETTLED");
  assert.equal((await store.listCreditTransactions(user.id)).pagination.total, 1);

  const task = await store.createTask({
    id: "task-1",
    ownerId: user.id,
    idempotencyKey: "task-key-1",
    status: "pending",
    images: [],
    requestedCredits: 2,
    prompt: "A test card",
    model: "test-model",
  });
  assert.equal(task.id, "task-1");
  assert.equal((await store.claimTask("worker-1", { leaseDurationMs: 60_000 })).id, task.id);
  assert.equal((await store.renewTaskLease(task.id, "worker-1", { leaseDurationMs: 60_000 })).leaseOwner, "worker-1");
  assert.equal((await store.releaseTaskLease(task.id, "worker-1", { status: "completed" })).status, "completed");

  const asset = await store.createAsset({
    id: "asset-1",
    taskId: task.id,
    userId: user.id,
    outputIndex: 0,
    objectKey: "generated/user/asset-1.png",
    mimeType: "image/png",
    width: 100,
    height: 100,
    sizeBytes: 12,
  });
  assert.equal((await store.findOwnedAsset(user.id, asset.id)).objectKey, asset.objectKey);
  const referenceAsset = await store.createReferenceAsset({
    id: "reference-1",
    userId: user.id,
    objectKey: "reference/user/reference-1.png",
    mimeType: "image/png",
    sizeBytes: 8,
  });
  assert.equal((await store.getReferenceAsset(referenceAsset.id)).objectKey, referenceAsset.objectKey);

  const version = await store.createCatalogVersion({
    id: "catalog-1",
    checksum: "checksum-1",
    source: "test",
    recordCount: 1,
  });
  await store.syncTemplates([{
    id: "template-1",
    catalogVersionId: version.id,
    title: "Test template",
    category: "image",
    tags: ["test"],
    prompt: "Use this prompt",
    referenceImages: [],
    previewImages: [],
    source: "test",
    metrics: { likes: 1 },
  }], { catalogVersionId: version.id });
  await store.activateCatalogVersion(version.id);
  assert.equal((await store.getActiveCatalogVersion()).id, version.id);
  assert.equal((await store.getTemplate("template-1")).title, "Test template");

  const order = await store.createOrder({
    id: "order-1",
    userId: user.id,
    productId: "credits-5",
    idempotencyKey: "order-key-1",
    amountCents: 500,
    credits: 5,
    productSnapshot: { id: "credits-5", credits: 5 },
  });
  assert.equal((await store.createOrder({
    userId: user.id,
    productId: "credits-5",
    idempotencyKey: "order-key-1",
    amountCents: 500,
    credits: 5,
  })).id, order.id);
  assert.equal((await store.fulfillOrder(order.id, { paidAt: "2026-08-03T00:00:00.000Z" })).fulfilled, true);
  assert.equal((await store.fulfillOrder(order.id)).fulfilled, false);

  const fulfillment = await store.recordPaymentFulfillment({
    fulfillmentKey: "fulfillment-key-1",
    orderId: order.id,
    provider: "manual",
    eventId: "event-1",
    status: "FULFILLED",
    metadata: { verified: false },
  });
  assert.equal((await store.getPaymentFulfillment(fulfillment.fulfillmentKey)).id, fulfillment.id);
  assert.equal((await store.recordPaymentEvent({
    orderId: order.id,
    userId: user.id,
    type: "fulfill",
    actorId: user.id,
    message: "test",
  })).type, "fulfill");
  assert.equal((await store.listPaymentAudit(new URLSearchParams({ orderId: order.id }))).pagination.total, 1);

  const audit = await store.recordAdminAudit({
    actorUserId: user.id,
    targetUserId: user.id,
    action: "ADMIN_NOTE_UPDATE",
    entityType: "user",
    entityId: user.id,
    before: { name: "微信用户" },
    after: { name: "Test" },
    reason: "test",
  });
  assert.equal((await store.listAdminAudit({ targetUserId: user.id })).records[0].id, audit.id);

  await pool.end();
});

test("postgres repository exposes parameterized SQL and explicit transaction boundaries", async () => {
  const { pool, store } = await setup();
  const identity = { sub: "wechat:wx-test:openid-2", appid: "wx-test", openid: "openid-2" };
  await store.ensureUser(identity);
  const history = pool.__queries || [];
  assert.ok(history.some((entry) => entry.sql === "BEGIN"));
  assert.ok(history.some((entry) => entry.sql === "COMMIT"));
  assert.ok(history.every((entry) => !/openid-2|wx-test/.test(entry.sql)));
  await pool.end();
});
