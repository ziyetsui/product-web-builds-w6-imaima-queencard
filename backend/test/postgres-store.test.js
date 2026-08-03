const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { createPostgresStore } = require("../src/repositories/postgres-store");
const { migrateDatabase } = require("../src/db/migrate");
const { assertStoreContract } = require("../src/repositories/store-contract");
const { recordsChecksum } = require("../src/services/catalog-service");
const { applyPgMemSchema, createPgMemPool } = require("./support/pg-mem");

const SESSION_TOKEN_HASH = "a".repeat(64);

async function setup(options = {}) {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const store = createPostgresStore({
    pool,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
    initialCredits: 10,
    environment: options.environment || "test",
  });
  assertStoreContract(store);
  return { pool, store };
}

async function creditState(pool, userId) {
  const user = (await pool.query("SELECT balance FROM miniapp_users WHERE id = $1", [userId])).rows[0];
  const packages = (await pool.query(`
    SELECT id, initial_credits, remaining_credits, frozen_credits, order_no
    FROM credit_packages WHERE user_id = $1 ORDER BY created_at ASC, id ASC
  `, [userId])).rows;
  return {
    balance: Number(user.balance),
    available: packages.reduce((sum, row) => sum + Number(row.remaining_credits), 0),
    frozen: packages.reduce((sum, row) => sum + Number(row.frozen_credits), 0),
    packages,
  };
}

test("initial schema declares the production invariants", () => {
  const migrationDirectory = require("node:path").resolve(__dirname, "../migrations");
  const sql = fs.readdirSync(migrationDirectory).sort().map((file) => fs.readFileSync(require("node:path").join(migrationDirectory, file), "utf8")).join("\n");
  for (const table of [
    "miniapp_users", "miniapp_sessions", "credit_packages", "credit_holds", "credit_transactions",
    "generation_tasks", "generated_assets", "reference_assets", "template_catalog_versions", "templates",
    "miniapp_orders", "payment_fulfillments", "payment_audit_events", "admin_audit_logs",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /UNIQUE \(appid, openid\)/);
  assert.match(sql, /UNIQUE \(owner_id, idempotency_key\)/);
  assert.match(sql, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(sql, /CHECK \(remaining_credits \+ frozen_credits <= initial_credits\)/);
  assert.match(sql, /credit_transactions_immutable/);
  assert.match(sql, /generation_tasks_lease_idx/);
  assert.match(sql, /request_fingerprint/);
  assert.match(sql, /UNIQUE INDEX[^;]+payment_fulfillments[^;]+provider_transaction_id/is);
  assert.match(sql, /UNIQUE INDEX[^;]+payment_fulfillments[^;]+event_id/is);
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
    tokenHash: SESSION_TOKEN_HASH,
    expiresAt: "2026-08-04T00:00:00.000Z",
    ipAddress: "127.0.0.1",
    userAgent: "test",
  });
  assert.equal((await store.getSessionByTokenHash(SESSION_TOKEN_HASH)).id, session.id);
  await store.touchSession(session.id);
  await store.revokeSession(session.id);
  assert.equal((await store.getSessionByTokenHash(SESSION_TOKEN_HASH)).revokedAt !== null, true);

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

  const templateRecord = {
    id: "template-1",
    title: "Test template",
    subtitle: "",
    author: "",
    category: "image",
    scenarioCategory: "",
    tags: ["test"],
    prompt: "Use this prompt",
    referenceImages: [],
    previewImages: [],
    source: "test",
    sourceId: "",
    sourceUrl: "",
    thumbnailUrl: "",
    previewUrl: "",
    useCase: "",
    metrics: { likes: 1 },
    seed: null,
    metadata: {},
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  const version = await store.createCatalogVersion({
    id: "catalog-1",
    checksum: recordsChecksum([templateRecord]),
    source: "test",
    recordCount: 1,
  });
  await store.syncTemplates([templateRecord], { catalogVersionId: version.id });
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
    paymentMode: "wechat",
    productSnapshot: { id: "credits-5", credits: 5 },
  });
  assert.equal((await store.createOrder({
    userId: user.id,
    productId: "credits-5",
    idempotencyKey: "order-key-1",
    amountCents: 500,
    credits: 5,
    paymentMode: "wechat",
    productSnapshot: { id: "credits-5", credits: 5 },
  })).id, order.id);
  const verifiedFulfillment = await store.fulfillPayment({
    fulfillmentKey: "verified-fulfillment-key-1",
    orderId: order.id,
    provider: "wechat",
    eventId: "verified-event-1",
    providerTransactionId: "verified-transaction-1",
    status: "FULFILLED",
    paymentVerified: true,
    paidAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal((await store.fulfillPayment({
    fulfillmentKey: "verified-fulfillment-key-1",
    orderId: order.id,
    provider: "wechat",
    eventId: "verified-event-1",
    providerTransactionId: "verified-transaction-1",
    status: "FULFILLED",
    paymentVerified: true,
  })).id, verifiedFulfillment.id);
  assert.equal((await store.getOrder(order.id)).creditsGranted, 5);

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

test("postgres rejects raw tokens at the createSession boundary", async () => {
  const { pool, store } = await setup();
  await store.ensureUser({
    sub: "wechat:wx-test:raw-session",
    appid: "wx-test",
    openid: "raw-session",
  });

  await assert.rejects(
    store.createSession({
      id: "raw-session",
      userId: "wechat:wx-test:raw-session",
      tokenHash: "raw-opaque-token",
      expiresAt: "2026-08-04T00:00:00.000Z",
    }),
    /64-character SHA-256 hash/,
  );
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM miniapp_sessions")).rows[0].count, 0);
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

test("pg-mem repository tests use driver parameter binding instead of SQL substitution", async () => {
  const { pool } = createPgMemPool();
  await assert.rejects(pool.query("SELECT $1::text AS value", []), /parameter|bind|expected/i);
  const result = await pool.query("SELECT $1::text AS value", ["quote-'-$2"]);
  assert.equal(result.rows[0].value, "quote-'-$2");
  await pool.end();
});

test("migration runner submits every raw production migration unchanged", async () => {
  const path = require("node:path");
  const migrationDirectory = path.resolve(__dirname, "../migrations");
  const rawMigrations = fs.readdirSync(migrationDirectory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => fs.readFileSync(path.join(migrationDirectory, file), "utf8"));
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/SELECT version FROM miniapp_schema_migrations/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  await migrateDatabase({ pool });

  for (const raw of rawMigrations) assert.equal(queries.includes(raw), true);
});

test("package grants are retry-safe and charges and revokes consume package remainder", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "credit-user-1", appid: "wx-credit", openid: "credit-openid-1" });

  const first = await store.createCreditPackage({ id: "retry-package-1", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" });
  const replay = await store.createCreditPackage({ id: "retry-package-1", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" });
  assert.equal(first.id, replay.id);
  assert.deepEqual(await store.charge(user.id, 12, "large-generation"), 3);
  assert.equal((await store.addCredits(user.id, -2, "admin-revoke")).balance, 1);

  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 1);
  assert.equal(state.available, 1);
  assert.equal(state.frozen, 0);
  assert.equal(state.packages.filter((row) => row.id === "retry-package-1").length, 1);
  await pool.end();
});

test("credit packages cannot create spendable remainder without matching user balance", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "credit-user-detached", appid: "wx-credit", openid: "credit-openid-detached" });
  await store.createCreditPackage({
    id: "detached-package",
    userId: user.id,
    initialCredits: 1,
    remainingCredits: 1,
    transType: "SYSTEM_ADJUST",
    addToBalance: false,
  });
  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 11);
  assert.equal(state.available, 11);
  await pool.end();
});

test("independent package grants without caller ids are not coalesced", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "credit-user-independent", appid: "wx-credit", openid: "credit-openid-independent" });
  const packages = await Promise.all([
    store.createCreditPackage({ userId: user.id, initialCredits: 1, transType: "SYSTEM_ADJUST" }),
    store.createCreditPackage({ userId: user.id, initialCredits: 1, transType: "SYSTEM_ADJUST" }),
  ]);

  assert.notEqual(packages[0].id, packages[1].id);
  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 12);
  assert.equal(state.available, 12);
  await pool.end();
});

test("holds cannot outspend balance and multi-package settlement releases the residual once", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "credit-user-2", appid: "wx-credit", openid: "credit-openid-2" });
  await store.createCreditPackage({ id: "settle-package-a", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" });
  await store.createCreditPackage({ id: "settle-package-b", userId: user.id, initialCredits: 5, transType: "SYSTEM_ADJUST" });

  const hold = await store.createCreditHold({
    id: "settle-hold-1",
    userId: user.id,
    taskId: "settle-task-1",
    idempotencyKey: "settle-key-1",
    credits: 10,
    packageAllocation: [
      { packageId: "settle-package-a", credits: 5 },
      { packageId: "settle-package-b", credits: 5 },
    ],
  });
  await store.settleCreditHold(hold.id, 7, { reason: "settle-task-1" });

  const state = await creditState(pool, user.id);
  const settledPackages = state.packages.filter((row) => row.id.startsWith("settle-package-"));
  assert.equal(settledPackages.reduce((sum, row) => sum + Number(row.remaining_credits), 0), 3);
  assert.equal(settledPackages.reduce((sum, row) => sum + Number(row.frozen_credits), 0), 0);
  assert.equal(state.balance, state.available);

  await store.charge(user.id, state.balance, "drain-all");
  await assert.rejects(
    store.createCreditHold({ userId: user.id, idempotencyKey: "free-hold-key", credits: 1 }),
    /insufficient credits/i,
  );
  await pool.end();
});

test("concurrent hold, task, and order retries return one resource", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "concurrent-user-1", appid: "wx-concurrent", openid: "concurrent-openid-1" });

  const holds = await Promise.all([
    store.createCreditHold({ id: "concurrent-hold-a", userId: user.id, idempotencyKey: "concurrent-hold-key", credits: 2 }),
    store.createCreditHold({ id: "concurrent-hold-b", userId: user.id, idempotencyKey: "concurrent-hold-key", credits: 2 }),
  ]);
  assert.equal(holds[0].id, holds[1].id);

  const tasks = await Promise.all([
    store.createTask({ id: "concurrent-task-a", ownerId: user.id, idempotencyKey: "concurrent-task-key", status: "pending" }),
    store.createTask({ id: "concurrent-task-b", ownerId: user.id, idempotencyKey: "concurrent-task-key", status: "pending" }),
  ]);
  assert.equal(tasks[0].id, tasks[1].id);

  const orders = await Promise.all([
    store.createOrder({ id: "concurrent-order-a", userId: user.id, idempotencyKey: "concurrent-order-key", productId: "credits-5", amountCents: 500, credits: 5 }),
    store.createOrder({ id: "concurrent-order-b", userId: user.id, idempotencyKey: "concurrent-order-key", productId: "credits-5", amountCents: 500, credits: 5 }),
  ]);
  assert.equal(orders[0].id, orders[1].id);

  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM credit_holds WHERE idempotency_key = $1", ["concurrent-hold-key"])).rows[0].count, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM generation_tasks WHERE owner_id = $1 AND idempotency_key = $2", [user.id, "concurrent-task-key"])).rows[0].count, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM miniapp_orders WHERE user_id = $1 AND idempotency_key = $2", [user.id, "concurrent-order-key"])).rows[0].count, 1);
  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 8);
  assert.equal(state.available, 8);
  assert.equal(state.frozen, 2);
  await pool.end();
});

test("explicit order id collisions never disclose an order owned by another user", async () => {
  const { pool, store } = await setup();
  const firstUser = await store.ensureUser({ sub: "order-owner-a", appid: "wx-order-owner", openid: "order-owner-a" });
  const secondUser = await store.ensureUser({ sub: "order-owner-b", appid: "wx-order-owner", openid: "order-owner-b" });
  const sharedId = "legacy-shared-order-id";

  const first = await store.createOrder({
    id: sharedId,
    userId: firstUser.id,
    productId: "credits-5",
    amountCents: 500,
    credits: 5,
  });
  await assert.rejects(
    store.createOrder({
      id: sharedId,
      userId: secondUser.id,
      productId: "credits-10",
      amountCents: 900,
      credits: 10,
    }),
    (error) => error.status === 409 && error.message === "Order idempotency conflict",
  );

  assert.equal(first.userId, firstUser.id);
  assert.equal((await store.listOrders(secondUser.id)).pagination.total, 0);
  assert.equal((await store.getOrder(sharedId)).userId, firstUser.id);
  await pool.end();
});

test("same-owner order replay requires a complete immutable payload match", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "order-replay-owner", appid: "wx-order-replay", openid: "order-replay-owner" });
  const request = {
    userId: user.id,
    idempotencyKey: "owner-order-retry-key",
    productId: "credits-5",
    channel: "wechat",
    status: "pending",
    paymentStatus: "created",
    paymentMode: "manual",
    amountCents: 500,
    currency: "CNY",
    credits: 5,
    productSnapshot: { id: "credits-5", amountCents: 500, credits: 5 },
    metadata: { source: "order-replay-test" },
  };

  const first = await store.createOrder({ id: "owner-order-first", ...request });
  const replay = await store.createOrder({ id: "owner-order-retry", ...request });
  await assert.rejects(
    store.createOrder({ id: "owner-order-collision", ...request, amountCents: 600 }),
    (error) => error.status === 409 && error.message === "Order idempotency conflict",
  );

  assert.equal(replay.id, first.id);
  assert.equal((await store.listOrders(user.id)).pagination.total, 1);
  assert.equal((await store.getUser(user.id)).balance, 10);
  await pool.end();
});

test("concurrent charges cannot overspend package or user balance", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "concurrent-user-2", appid: "wx-concurrent", openid: "concurrent-openid-2" });

  const results = await Promise.allSettled([
    store.charge(user.id, 8, "concurrent-charge-a"),
    store.charge(user.id, 8, "concurrent-charge-b"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /insufficient credits/i);

  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 2);
  assert.equal(state.available, 2);
  assert.equal(state.frozen, 0);
  await pool.end();
});

test("manual, mock, and direct fulfillment paths cannot grant unverified credits", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "payment-user-1", appid: "wx-payment", openid: "payment-openid-1" });
  const manual = await store.createOrder({
    id: "manual-order-1",
    userId: user.id,
    productId: "credits-5",
    status: "paid",
    paymentStatus: "fulfilled",
    paymentMode: "manual",
    amountCents: 500,
    credits: 5,
    metadata: { paymentVerification: "not-verified" },
  });
  const mock = await store.createOrder({
    id: "mock-order-1",
    userId: user.id,
    productId: "credits-5",
    status: "paid",
    paymentStatus: "fulfilled",
    paymentMode: "mock",
    amountCents: 500,
    credits: 5,
  });

  await store.recordPaymentFulfillment({
    fulfillmentKey: "manual-record-1",
    orderId: manual.id,
    provider: "manual",
    eventId: "manual-record-event-1",
    providerTransactionId: "manual-record-transaction-1",
    status: "FULFILLED",
  });
  await store.recordPaymentEvent({
    orderId: manual.id,
    userId: user.id,
    type: "admin_fulfill",
    actorId: user.id,
    message: "manual admin replay",
  });

  await assert.rejects(store.fulfillOrder(manual.id, { paymentVerified: true, paymentMode: "wechat" }), /verified payment event required/i);
  await assert.rejects(store.fulfillOrder(mock.id, { paymentVerified: true, paymentMode: "mock" }), /verified payment event required/i);
  await assert.rejects(store.fulfillPayment({
    fulfillmentKey: "manual-replay-1",
    orderId: manual.id,
    provider: "manual",
    eventId: "manual-event-1",
    providerTransactionId: "manual-transaction-1",
    status: "FULFILLED",
    paymentVerified: true,
  }), /verified wechat payment required/i);
  await assert.rejects(store.fulfillPayment({
    fulfillmentKey: "manual-wechat-replay-1",
    orderId: manual.id,
    provider: "wechat",
    eventId: "manual-wechat-event-1",
    providerTransactionId: "manual-wechat-transaction-1",
    status: "FULFILLED",
    paymentVerified: true,
  }), /verified wechat payment required/i);

  const state = await creditState(pool, user.id);
  assert.equal(state.balance, 10);
  assert.equal(state.available, 10);
  assert.equal((await store.getOrder(manual.id)).creditsGranted, 0);
  assert.equal((await store.getOrder(mock.id)).creditsGranted, 0);
  await pool.end();
});

test("verified payment fulfillment is atomic, replay-safe, and refunds its remaining package credits", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "payment-user-2", appid: "wx-payment", openid: "payment-openid-2" });
  const order = await store.createOrder({
    id: "wechat-order-1",
    userId: user.id,
    idempotencyKey: "wechat-order-key-1",
    productId: "credits-5",
    paymentMode: "wechat",
    amountCents: 500,
    credits: 5,
  });
  const event = {
    fulfillmentKey: "wechat-fulfillment-1",
    orderId: order.id,
    provider: "wechat",
    eventId: "wechat-event-1",
    providerTransactionId: "wechat-transaction-1",
    status: "FULFILLED",
    paymentVerified: true,
    paidAt: "2026-08-03T00:00:00.000Z",
  };

  const first = await store.fulfillPayment(event);
  const replay = await store.fulfillPayment(event);
  assert.equal(first.id, replay.id);
  const fulfilledOrder = await store.getOrder(order.id);
  assert.equal(fulfilledOrder.paymentVerified, true);
  assert.equal(fulfilledOrder.creditsGranted, 5);
  let state = await creditState(pool, user.id);
  assert.equal(state.balance, 15);
  assert.equal(state.available, 15);
  assert.equal(state.packages.filter((row) => row.order_no === order.id).length, 1);

  await store.charge(user.id, 3, "spend-order-credit");
  const refunded = await store.refundOrder(order.id, { reason: "verified-refund" });
  assert.equal(refunded.revokedCredits, 2);
  state = await creditState(pool, user.id);
  assert.equal(state.balance, 10);
  assert.equal(state.available, 10);
  assert.equal(state.packages.find((row) => row.order_no === order.id).remaining_credits, 0);
  await pool.end();
});

test("provider transaction replay with another fulfillment key returns the original fulfillment", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "payment-replay-user", appid: "wx-payment-replay", openid: "payment-replay-openid" });
  const order = await store.createOrder({
    id: "payment-replay-order",
    userId: user.id,
    productId: "credits-5",
    paymentMode: "wechat",
    amountCents: 500,
    credits: 5,
  });
  const payment = {
    orderId: order.id,
    provider: "wechat",
    eventId: "payment-replay-event",
    providerTransactionId: "payment-replay-transaction",
    status: "FULFILLED",
    paymentVerified: true,
  };

  const original = await store.fulfillPayment({ ...payment, fulfillmentKey: "payment-replay-key-a" });
  const replay = await store.fulfillPayment({ ...payment, fulfillmentKey: "payment-replay-key-b" });

  assert.equal(replay.id, original.id);
  assert.equal(replay.orderId, order.id);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM payment_fulfillments WHERE provider = $1 AND provider_transaction_id = $2", ["wechat", payment.providerTransactionId])).rows[0].count, 1);
  assert.equal((await store.getUser(user.id)).balance, 15);
  await pool.end();
});

test("provider transaction or event replay cannot fulfill a different order", async () => {
  const { pool, store } = await setup();
  const firstUser = await store.ensureUser({ sub: "payment-owner-a", appid: "wx-payment-owner", openid: "payment-owner-a" });
  const secondUser = await store.ensureUser({ sub: "payment-owner-b", appid: "wx-payment-owner", openid: "payment-owner-b" });
  const firstOrder = await store.createOrder({ id: "payment-order-a", userId: firstUser.id, productId: "credits-5", paymentMode: "wechat", amountCents: 500, credits: 5 });
  const secondOrder = await store.createOrder({ id: "payment-order-b", userId: secondUser.id, productId: "credits-5", paymentMode: "wechat", amountCents: 500, credits: 5 });
  await store.fulfillPayment({ fulfillmentKey: "payment-key-a", orderId: firstOrder.id, provider: "wechat", eventId: "provider-event-a", providerTransactionId: "provider-transaction-a", status: "FULFILLED", paymentVerified: true });

  await assert.rejects(
    store.fulfillPayment({ fulfillmentKey: "payment-key-b", orderId: secondOrder.id, provider: "wechat", eventId: "provider-event-b", providerTransactionId: "provider-transaction-a", status: "FULFILLED", paymentVerified: true }),
    (error) => error.status === 409 && /payment fulfillment identity conflict/i.test(error.message),
  );
  await assert.rejects(
    store.fulfillPayment({ fulfillmentKey: "payment-key-c", orderId: secondOrder.id, provider: "wechat", eventId: "provider-event-a", providerTransactionId: "provider-transaction-c", status: "FULFILLED", paymentVerified: true }),
    (error) => error.status === 409 && /payment fulfillment identity conflict/i.test(error.message),
  );

  assert.equal((await store.getUser(firstUser.id)).balance, 15);
  assert.equal((await store.getUser(secondUser.id)).balance, 10);
  assert.equal((await store.getOrder(secondOrder.id)).creditsGranted, 0);
  await pool.end();
});

test("development mock fulfillment is explicit, idempotent, and rejects production or unsafe orders", async () => {
  const { pool, store } = await setup({ environment: "development" });
  const user = await store.ensureUser({ sub: "mock-payment-user", appid: "wx-mock-payment", openid: "mock-payment-openid" });
  const mockOrder = await store.createOrder({ id: "mock-safe-order", userId: user.id, productId: "credits-5", status: "pending", paymentStatus: "mock_pending", paymentMode: "mock", amountCents: 500, credits: 5 });
  const mockIdentity = `mock:${mockOrder.id}`;
  const input = {
    fulfillmentKey: mockIdentity,
    provider: "mock",
    paymentMode: "mock",
    eventId: mockIdentity,
    providerTransactionId: mockIdentity,
    status: "FULFILLED",
    paymentVerified: true,
  };
  const first = await store.fulfillMockOrder(mockOrder.id, input);
  const replay = await store.fulfillMockOrder(mockOrder.id, input);
  assert.equal(first.order.id, mockOrder.id);
  assert.equal(first.fulfilled, true);
  assert.equal(replay.order.id, mockOrder.id);
  assert.equal(replay.fulfilled, false);
  assert.equal((await store.getUser(user.id)).balance, 15);

  const manual = await store.createOrder({ id: "mock-manual-order", userId: user.id, productId: "credits-5", paymentMode: "manual", amountCents: 500, credits: 5 });
  const imported = await store.createOrder({ id: "mock-imported-order", userId: user.id, productId: "credits-5", paymentMode: "mock", amountCents: 500, credits: 5, metadata: { legacyId: "legacy-mock", paymentVerification: "not-verified" } });
  await assert.rejects(store.fulfillMockOrder(manual.id, { ...input, fulfillmentKey: "mock-manual", eventId: "mock-manual-event", providerTransactionId: "mock-manual-transaction" }), /development mock payment required/i);
  await assert.rejects(store.fulfillMockOrder(imported.id, { ...input, fulfillmentKey: "mock-imported", eventId: "mock-imported-event", providerTransactionId: "mock-imported-transaction" }), /development mock payment required/i);

  const productionStore = createPostgresStore({ pool, environment: "production" });
  await assert.rejects(productionStore.fulfillMockOrder(mockOrder.id, input), /development mock payment required/i);
  await assert.rejects(store.fulfillPayment({ orderId: mockOrder.id, ...input }), /verified wechat payment required/i);
  assert.equal((await store.getUser(user.id)).balance, 15);
  await pool.end();
});

test("PostgreSQL mock fulfillment requires the exact order tuple and persisted pending state", async () => {
  const { pool, store } = await setup({ environment: "development" });
  const user = await store.ensureUser({ sub: "mock-boundary-user", appid: "wx-mock-boundary", openid: "mock-boundary-openid" });
  const pending = await store.createOrder({ id: "mock-boundary-pending", userId: user.id, productId: "credits-5", status: "pending", paymentStatus: "mock_pending", paymentMode: "mock", amountCents: 500, credits: 5 });
  const identity = `mock:${pending.id}`;

  await assert.rejects(
    store.fulfillMockOrder(pending.id, {
      fulfillmentKey: "arbitrary-key",
      provider: "mock",
      paymentMode: "mock",
      eventId: "arbitrary-event",
      providerTransactionId: "arbitrary-transaction",
      status: "FULFILLED",
      paymentVerified: true,
    }),
    (error) => error.status === 409 && /development mock payment required/i.test(error.message),
  );

  const first = await store.fulfillMockOrder(pending.id, {
    fulfillmentKey: identity,
    provider: "mock",
    paymentMode: "mock",
    eventId: identity,
    providerTransactionId: identity,
    status: "FULFILLED",
    paymentVerified: true,
  });
  const replay = await store.fulfillMockOrder(pending.id, {
    fulfillmentKey: identity,
    provider: "mock",
    paymentMode: "mock",
    eventId: identity,
    providerTransactionId: identity,
    status: "FULFILLED",
    paymentVerified: true,
  });
  assert.equal(first.fulfilled, true);
  assert.equal(replay.fulfilled, false);
  assert.equal((await store.getUser(user.id)).balance, 15);

  const completedMismatch = { fulfillmentKey: identity, provider: "mock", paymentMode: "mock", eventId: identity, providerTransactionId: "mock:other", status: "FULFILLED", paymentVerified: true };
  await assert.rejects(store.fulfillMockOrder(pending.id, completedMismatch), (error) => error.status === 409);

  const inconsistent = await store.createOrder({ id: "mock-boundary-inconsistent", userId: user.id, productId: "credits-5", status: "paid", paymentStatus: "fulfilled", paymentMode: "mock", amountCents: 500, credits: 5 });
  const inconsistentIdentity = `mock:${inconsistent.id}`;
  await assert.rejects(
    store.fulfillMockOrder(inconsistent.id, {
      fulfillmentKey: inconsistentIdentity,
      provider: "mock",
      paymentMode: "mock",
      eventId: inconsistentIdentity,
      providerTransactionId: inconsistentIdentity,
      status: "FULFILLED",
      paymentVerified: true,
    }),
    (error) => error.status === 409 && /development mock payment required/i.test(error.message),
  );
  assert.equal((await store.getUser(user.id)).balance, 15);
  await pool.end();
});

test("package and hold retries reject owner or immutable payload collisions without mutation", async () => {
  const { pool, store } = await setup();
  const firstUser = await store.ensureUser({ sub: "retry-owner-a", appid: "wx-retry-owner", openid: "retry-owner-a" });
  const secondUser = await store.ensureUser({ sub: "retry-owner-b", appid: "wx-retry-owner", openid: "retry-owner-b" });

  const packageResults = await Promise.allSettled([
    store.createCreditPackage({ id: "shared-package-id", userId: firstUser.id, initialCredits: 2, transType: "SYSTEM_ADJUST", metadata: { reason: "first" } }),
    store.createCreditPackage({ id: "shared-package-id", userId: secondUser.id, initialCredits: 3, transType: "SYSTEM_ADJUST", metadata: { reason: "second" } }),
  ]);
  assert.equal(packageResults.filter((result) => result.status === "fulfilled").length, 1);
  const packageRejection = packageResults.find((result) => result.status === "rejected").reason;
  assert.equal(packageRejection.status, 409);
  assert.equal(packageRejection.message, "Credit package idempotency conflict");

  const savedPackage = (await pool.query("SELECT user_id, remaining_credits FROM credit_packages WHERE id = $1", ["shared-package-id"])).rows[0];
  const packageOwner = savedPackage.user_id === firstUser.id ? firstUser : secondUser;
  const packageNonOwner = savedPackage.user_id === firstUser.id ? secondUser : firstUser;
  assert.equal((await store.getUser(packageOwner.id)).balance, 10 + Number(savedPackage.remaining_credits));
  assert.equal((await store.getUser(packageNonOwner.id)).balance, 10);

  const holdResults = await Promise.allSettled([
    store.createCreditHold({ id: "shared-hold-a", userId: firstUser.id, taskId: "task-a", idempotencyKey: "shared-hold-key", credits: 1 }),
    store.createCreditHold({ id: "shared-hold-b", userId: secondUser.id, taskId: "task-b", idempotencyKey: "shared-hold-key", credits: 2 }),
  ]);
  assert.equal(holdResults.filter((result) => result.status === "fulfilled").length, 1);
  const holdRejection = holdResults.find((result) => result.status === "rejected").reason;
  assert.equal(holdRejection.status, 409);
  assert.equal(holdRejection.message, "Credit hold idempotency conflict");
  const savedHold = (await pool.query("SELECT user_id, credits FROM credit_holds WHERE idempotency_key = $1", ["shared-hold-key"])).rows[0];
  const holdOwnerBalance = (await store.getUser(savedHold.user_id)).balance;
  const expectedOwnerBalance = savedHold.user_id === packageOwner.id ? 10 + Number(savedPackage.remaining_credits) - Number(savedHold.credits) : 10 - Number(savedHold.credits);
  assert.equal(holdOwnerBalance, expectedOwnerBalance);

  const payloadUser = await store.ensureUser({ sub: "retry-payload-owner", appid: "wx-retry-owner", openid: "retry-payload-owner" });
  const payloadResults = await Promise.allSettled([
    store.createCreditHold({ id: "payload-hold-a", userId: payloadUser.id, taskId: "payload-task", idempotencyKey: "payload-hold-key", credits: 1 }),
    store.createCreditHold({ id: "payload-hold-b", userId: payloadUser.id, taskId: "payload-task", idempotencyKey: "payload-hold-key", credits: 2 }),
  ]);
  assert.equal(payloadResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(payloadResults.find((result) => result.status === "rejected").reason.status, 409);
  const payloadHold = (await pool.query("SELECT credits FROM credit_holds WHERE idempotency_key = $1", ["payload-hold-key"])).rows[0];
  assert.equal((await store.getUser(payloadUser.id)).balance, 10 - Number(payloadHold.credits));
  await pool.end();
});

test("same-owner package and hold retries require identical immutable payloads", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "retry-same-owner", appid: "wx-retry-same-owner", openid: "retry-same-owner" });
  await store.createCreditPackage({ id: "same-owner-package", userId: user.id, initialCredits: 1, transType: "SYSTEM_ADJUST", metadata: { reason: "original" } });
  await assert.rejects(
    store.createCreditPackage({ id: "same-owner-package", userId: user.id, initialCredits: 2, transType: "SYSTEM_ADJUST", metadata: { reason: "changed" } }),
    (error) => error.status === 409 && error.message === "Credit package idempotency conflict",
  );
  assert.equal((await store.getUser(user.id)).balance, 11);

  await store.createCreditPackage({ id: "hold-allocation-a", userId: user.id, initialCredits: 1, transType: "SYSTEM_ADJUST" });
  await store.createCreditPackage({ id: "hold-allocation-b", userId: user.id, initialCredits: 1, transType: "SYSTEM_ADJUST" });
  await store.createCreditHold({
    id: "same-owner-hold",
    userId: user.id,
    taskId: "same-owner-task",
    idempotencyKey: "same-owner-hold-key",
    credits: 1,
    packageAllocation: [{ packageId: "hold-allocation-a", credits: 1 }],
  });
  await assert.rejects(
    store.createCreditHold({
      id: "same-owner-hold-replay",
      userId: user.id,
      taskId: "same-owner-task",
      idempotencyKey: "same-owner-hold-key",
      credits: 1,
      packageAllocation: [{ packageId: "hold-allocation-b", credits: 1 }],
    }),
    (error) => error.status === 409 && error.message === "Credit hold idempotency conflict",
  );
  assert.equal((await store.getUser(user.id)).balance, 12);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM credit_holds WHERE idempotency_key = $1", ["same-owner-hold-key"])).rows[0].count, 1);
  await pool.end();
});

test("package replay validates the original request after its remainder changes", async () => {
  const { pool, store } = await setup();
  const user = await store.ensureUser({ sub: "retry-spent-package", appid: "wx-retry-spent", openid: "retry-spent-package" });
  const request = { id: "retry-spent-package", userId: user.id, initialCredits: 2, transType: "SYSTEM_ADJUST", metadata: { source: "retry-test" } };
  const created = await store.createCreditPackage(request);
  await store.charge(user.id, 1, "spend-before-retry");

  const replay = await store.createCreditPackage(request);

  assert.equal(replay.id, created.id);
  assert.equal(replay.remainingCredits, 1);
  assert.equal((await store.getUser(user.id)).balance, 11);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM credit_packages WHERE id = $1", [request.id])).rows[0].count, 1);
  await pool.end();
});
