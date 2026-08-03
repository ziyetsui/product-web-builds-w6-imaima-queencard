const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createMemoryStore, createSqliteStore } = require("../src/store");

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-db-")), "miniapp.sqlite");
}

const identity = {
  sub: "wechat:wx-test:openid-1",
  appid: "wx-test",
  openid: "openid-1",
};

const mockAdapters = [
  {
    name: "memory",
    create(options) {
      return createMemoryStore(options);
    },
  },
  {
    name: "sqlite",
    create(options) {
      return createSqliteStore({ ...options, dbPath: tempDbPath() });
    },
  },
];

function createMockOrder(store, suffix) {
  const user = store.ensureUser({
    sub: `mock-user-${suffix}`,
    appid: "wx-mock-adapter",
    openid: `mock-openid-${suffix}`,
  });
  const order = store.createOrder({
    id: `mock-order-${suffix}`,
    userId: user.id,
    productId: "credits-5",
    status: "pending",
    paymentStatus: "mock_pending",
    paymentMode: "mock",
    amountCents: 500,
    credits: 5,
  });
  return { order, user };
}

function completeMockIdentity(orderId) {
  const identityValue = `mock:${orderId}`;
  return {
    fulfillmentKey: identityValue,
    provider: "mock",
    paymentMode: "mock",
    eventId: identityValue,
    providerTransactionId: identityValue,
    status: "FULFILLED",
    paymentVerified: true,
  };
}

for (const adapter of mockAdapters) {
  test(`${adapter.name} order creation replays by owner and immutable request fingerprint`, () => {
    const store = adapter.create({ environment: "test", initialCredits: 10 });
    try {
      const owner = store.ensureUser({ sub: `${adapter.name}-order-owner`, appid: "wx-order-replay", openid: `${adapter.name}-owner` });
      const otherOwner = store.ensureUser({ sub: `${adapter.name}-order-other`, appid: "wx-order-replay", openid: `${adapter.name}-other` });
      const request = {
        id: `${adapter.name}-order-first`,
        userId: owner.id,
        idempotencyKey: `${adapter.name}-order-key`,
        productId: "credits-5",
        channel: "wechat",
        status: "pending",
        paymentStatus: "mock_pending",
        paymentMode: "mock",
        amountCents: 500,
        currency: "CNY",
        credits: 5,
        productSnapshot: { id: "credits-5", amountCents: 500, credits: 5 },
        metadata: { source: "adapter-replay-test" },
      };

      const first = store.createOrder(request);
      const replay = store.createOrder({
        ...request,
        id: `${adapter.name}-order-retry`,
        productSnapshot: { credits: 5, amountCents: 500, id: "credits-5" },
      });

      assert.equal(first.created, true);
      assert.equal(replay.created, false);
      assert.equal(replay.id, first.id);
      assert.equal(Object.keys(first).includes("created"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(replay)), "created"), false);
      assert.equal(store.listOrders(owner.id).pagination.total, 1);
      assert.throws(
        () => store.createOrder({ ...request, id: `${adapter.name}-order-mismatch`, amountCents: 600 }),
        (error) => error.status === 409 && error.message === "Order idempotency conflict",
      );
      assert.throws(
        () => store.createOrder({ ...request, id: first.id, userId: otherOwner.id, idempotencyKey: `${adapter.name}-other-key` }),
        (error) => error.status === 409 && error.message === "Order idempotency conflict",
      );
      assert.equal(store.listOrders(otherOwner.id).pagination.total, 0);
    } finally {
      store.close();
    }
  });

  test(`${adapter.name} mock fulfillment is intrinsically disabled in production`, () => {
    const store = adapter.create({ environment: "production", initialCredits: 10 });
    try {
      const { order } = createMockOrder(store, `${adapter.name}-production`);
      assert.throws(
        () => store.fulfillMockOrder(order.id, completeMockIdentity(order.id)),
        (error) => error.status === 409 && /development mock payment required/i.test(error.message),
      );
    } finally {
      store.close();
    }
  });

  test(`${adapter.name} mock fulfillment requires pending persisted mock state and deterministic identities`, () => {
    const store = adapter.create({ environment: "test", initialCredits: 10 });
    try {
      const incomplete = createMockOrder(store, `${adapter.name}-incomplete`);
      const incompleteIdentity = completeMockIdentity(incomplete.order.id);
      delete incompleteIdentity.eventId;
      assert.throws(
        () => store.fulfillMockOrder(incomplete.order.id, incompleteIdentity),
        (error) => error.status === 409 && /development mock payment required/i.test(error.message),
      );

      const mismatch = createMockOrder(store, `${adapter.name}-mismatch`);
      assert.throws(
        () => store.fulfillMockOrder(mismatch.order.id, {
          ...completeMockIdentity(mismatch.order.id),
          providerTransactionId: "mock:another-order",
        }),
        (error) => error.status === 409 && /development mock payment required/i.test(error.message),
      );

      const wrongState = createMockOrder(store, `${adapter.name}-wrong-state`);
      store.cancelOrder(wrongState.order.id, { reason: "test-state" });
      assert.throws(
        () => store.fulfillMockOrder(wrongState.order.id, completeMockIdentity(wrongState.order.id)),
        (error) => error.status === 409 && /development mock payment required/i.test(error.message),
      );
    } finally {
      store.close();
    }
  });

  test(`${adapter.name} mock fulfillment grants fixed order credits exactly once`, () => {
    const store = adapter.create({ environment: "test", initialCredits: 10 });
    try {
      const { order, user } = createMockOrder(store, `${adapter.name}-fixed-credit`);
      const input = { ...completeMockIdentity(order.id), credits: 999 };

      const first = store.fulfillMockOrder(order.id, input);
      const replay = store.fulfillMockOrder(order.id, input);

      assert.equal(first.fulfilled, true);
      assert.equal(first.order.creditsGranted, 5);
      assert.equal(replay.fulfilled, false);
      assert.equal(store.getUser(user.id).balance, 15);
    } finally {
      store.close();
    }
  });
}

function startSqliteMockWorker(dbPath, orderId) {
  const modulePath = require.resolve("../src/store");
  const script = `
    const { createSqliteStore } = require(${JSON.stringify(modulePath)});
    process.stdout.write("ready\\n");
    process.stdin.once("data", () => {
      let store;
      try {
        store = createSqliteStore({ dbPath: process.argv[1], environment: "test" });
        const identity = "mock:" + process.argv[2];
        const result = store.fulfillMockOrder(process.argv[2], {
          fulfillmentKey: identity,
          provider: "mock",
          paymentMode: "mock",
          eventId: identity,
          providerTransactionId: identity,
          status: "FULFILLED",
          paymentVerified: true,
        });
        process.stdout.write(JSON.stringify({ fulfilled: result.fulfilled }) + "\\n");
      } catch (error) {
        process.stdout.write(JSON.stringify({ error: error.message, status: error.status || 500 }) + "\\n");
        process.exitCode = 1;
      } finally {
        if (store) store.close();
      }
    });
  `;
  const child = spawn(process.execPath, ["-e", script, dbPath, orderId], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let readyResolve;
  let resultResolve;
  let resultReject;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const result = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      if (line === "ready") readyResolve();
      else {
        const parsed = JSON.parse(line);
        if (parsed.error) resultReject(new Error(`${parsed.error} (${parsed.status})`));
        else resultResolve(parsed);
      }
    }
  });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk.toString();
  });
  child.on("error", resultReject);
  child.on("close", (code) => {
    if (code !== 0) resultReject(new Error(`SQLite worker exited with ${code}: ${errorOutput}`));
  });
  return { child, ready, result };
}

test("sqlite mock fulfillment is exactly once across two processes", async () => {
  const dbPath = tempDbPath();
  const setupStore = createSqliteStore({ dbPath, environment: "test", initialCredits: 10 });
  const { order, user } = createMockOrder(setupStore, "two-process");
  setupStore.close();

  const workers = [
    startSqliteMockWorker(dbPath, order.id),
    startSqliteMockWorker(dbPath, order.id),
  ];
  await Promise.all(workers.map((worker) => worker.ready));
  workers.forEach((worker) => worker.child.stdin.end("go\n"));
  const results = await Promise.all(workers.map((worker) => worker.result));

  const reopened = createSqliteStore({ dbPath, environment: "test", initialCredits: 10 });
  try {
    assert.deepEqual(results.map((result) => result.fulfilled).sort(), [false, true]);
    assert.equal(reopened.getUser(user.id).balance, 15);
    assert.equal(reopened.listCreditTransactions(user.id).records.filter((record) => record.amount === 5).length, 1);
    assert.equal(reopened.getOrder(order.id).mockFulfillmentKey, `mock:${order.id}`);
  } finally {
    reopened.close();
  }
});

test("sqlite order identity survives a store reopen", () => {
  const dbPath = tempDbPath();
  const firstStore = createSqliteStore({ dbPath, environment: "test", initialCredits: 10 });
  const user = firstStore.ensureUser({ sub: "sqlite-reopen-order-user", appid: "wx-reopen", openid: "sqlite-reopen" });
  const request = {
    id: "sqlite-reopen-order",
    userId: user.id,
    idempotencyKey: "sqlite-reopen-key",
    productId: "credits-5",
    amountCents: 500,
    credits: 5,
    productSnapshot: { id: "credits-5", amountCents: 500 },
    metadata: { source: "reopen-test" },
  };
  const first = firstStore.createOrder(request);
  firstStore.close();

  const reopened = createSqliteStore({ dbPath, environment: "test", initialCredits: 10 });
  try {
    const replay = reopened.createOrder({
      ...request,
      id: "sqlite-reopen-order-retry",
      productSnapshot: { amountCents: 500, id: "credits-5" },
    });
    assert.equal(replay.created, false);
    assert.equal(replay.id, first.id);
    assert.equal(reopened.listOrders(user.id).pagination.total, 1);
  } finally {
    reopened.close();
  }
});

test("sqlite store persists users, credit charges, and generation tasks", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = store.ensureUser(identity);
  assert.equal(user.balance, 10);
  assert.equal(store.charge(user.id, 1, "template:case-1"), 9);
  store.createTask({
    id: "task-1",
    taskId: "task-1",
    ownerId: user.id,
    status: "completed",
    images: ["https://cdn.example.com/result.jpg"],
    templateId: "case-1",
    provider: "preview",
    mode: "preview",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  store.close();

  const reopened = createSqliteStore({ dbPath, initialCredits: 10 });
  assert.equal(reopened.getUser(user.id).balance, 9);
  assert.deepEqual(reopened.getTask("task-1").images, ["https://cdn.example.com/result.jpg"]);
  assert.equal(reopened.listCreditTransactions(user.id).records.length, 1);
  reopened.close();
});

test("sqlite store syncs and pages templates", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const synced = store.syncTemplates([
    {
      id: "case-1",
      title: "鸡，谁懂？",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      thumbnailUrl: "http://127.0.0.1:8787/xhs-cases/case-1.jpg",
      previewUrl: "http://127.0.0.1:8787/xhs-cases/case-1.jpg",
      referenceImages: ["http://127.0.0.1:8787/xhs-cases/gallery/case-1/01.jpg"],
      prompt: "参考图文生成新主题",
      seed: { templateId: "case-1" },
    },
    {
      id: "case-2",
      title: "腿记",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      thumbnailUrl: "http://127.0.0.1:8787/xhs-cases/case-2.jpg",
      previewUrl: "http://127.0.0.1:8787/xhs-cases/case-2.jpg",
      referenceImages: [],
      prompt: "参考另一篇图文生成新主题",
      seed: { templateId: "case-2" },
    },
  ]);

  const page = store.listTemplates(new URLSearchParams({ page: "1", limit: "1", q: "鸡" }));
  assert.equal(synced, 2);
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].id, "case-1");
  assert.equal(page.pagination.total, 1);
  assert.equal(store.getTemplate("case-2").title, "腿记");
  store.close();
});

test("sqlite store filters and sorts templates like the web prompt library", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  store.syncTemplates([
    {
      id: "case-low",
      title: "低热度",
      category: "image",
      scenarioCategory: "清单种草",
      source: "github",
      metrics: { likes: 1000, saves: 900, shares: 600, potentialScore: 99, potentialRank: 1 },
    },
    {
      id: "case-like",
      title: "高赞",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      metrics: { likes: 30000, saves: 1000, shares: 200, potentialScore: 60, potentialRank: 3 },
    },
    {
      id: "case-save",
      title: "高收藏",
      category: "image",
      scenarioCategory: "清单种草",
      source: "github",
      metrics: { likes: 8000, saves: 22000, shares: 30000, potentialScore: 80, potentialRank: 2 },
    },
  ]);

  const hot = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", hot: "1", sort: "heat" }));
  assert.deepEqual(hot.records.map((record) => record.id), ["case-like", "case-save"]);

  const category = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", scenario_category: "清单种草", sort: "heat" }));
  assert.deepEqual(category.records.map((record) => record.id), ["case-save", "case-low"]);

  const saves = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "saves" }));
  assert.deepEqual(saves.records.map((record) => record.id), ["case-save", "case-like", "case-low"]);

  const shares = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "shares" }));
  assert.deepEqual(shares.records.map((record) => record.id), ["case-save", "case-low", "case-like"]);

  const potential = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "potential" }));
  assert.deepEqual(potential.records.map((record) => record.id), ["case-low", "case-save", "case-like"]);
  store.close();
});

test("sqlite store persists and filters generation task history", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = store.ensureUser(identity);
  store.createTask({
    id: "task-history-1",
    ownerId: user.id,
    status: "completed",
    images: ["https://cdn.example.com/history-1.jpg"],
    templateId: "tpl-queen",
    provider: "preview",
    prompt: "Create a lemon queen card",
    topic: "Lemon queen",
    referenceImages: ["https://cdn.example.com/reference.jpg"],
    model: "gpt-image-2-edit",
    outputCount: 2,
    aspectRatio: "1:1",
    resolution: "1024x1024",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  store.createTask({
    id: "task-history-2",
    ownerId: user.id,
    status: "failed",
    images: [],
    templateId: "tpl-other",
    provider: "preview",
    prompt: "Create a pumpkin poster",
    topic: "Pumpkin poster",
    referenceImages: [],
    model: "preview",
    outputCount: 1,
    aspectRatio: "3:4",
    resolution: "768x1024",
    createdAt: "2026-07-28T00:01:00.000Z",
  });
  store.close();

  const reopened = createSqliteStore({ dbPath, initialCredits: 10 });
  const promptMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "lemon", status: "completed" }));
  assert.equal(promptMatches.pagination.total, 1);
  assert.equal(promptMatches.records[0].id, "task-history-1");
  assert.equal(promptMatches.records[0].prompt, "Create a lemon queen card");
  assert.deepEqual(promptMatches.records[0].referenceImages, ["https://cdn.example.com/reference.jpg"]);
  assert.equal(promptMatches.records[0].model, "gpt-image-2-edit");
  assert.equal(promptMatches.records[0].outputCount, 2);
  assert.equal(promptMatches.records[0].aspectRatio, "1:1");
  assert.equal(promptMatches.records[0].resolution, "1024x1024");

  const modelMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "gpt-image-2-edit" }));
  assert.equal(modelMatches.pagination.total, 1);

  const templateMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "tpl-other" }));
  assert.equal(templateMatches.pagination.total, 1);
  assert.equal(templateMatches.records[0].id, "task-history-2");

  const firstPage = reopened.listTasks(user.id, new URLSearchParams({ page: "1", limit: "1" }));
  assert.equal(firstPage.records.length, 1);
  assert.equal(firstPage.records[0].id, "task-history-2");
  assert.equal(firstPage.pagination.total, 2);
  assert.equal(firstPage.pagination.totalPages, 2);
  reopened.close();
});

for (const adapter of mockAdapters) {
  test(`${adapter.name} atomically holds credits with an idempotent leased generation task`, async () => {
    const store = adapter.create({ environment: "test", initialCredits: 2 });
    try {
      const user = store.ensureUser({ appid: "wx-durable", openid: `${adapter.name}-durable` });
      const request = {
        task: {
          id: `${adapter.name}-durable-task`,
          ownerId: user.id,
          idempotencyKey: `${adapter.name}-durable-key`,
          status: "pending",
          requestedCredits: 2,
          outputCount: 2,
        },
        hold: {
          id: `${adapter.name}-durable-hold`,
          userId: user.id,
          taskId: `${adapter.name}-durable-task`,
          idempotencyKey: `${adapter.name}-durable-key`,
          credits: 2,
        },
      };
      const first = await store.createTaskWithCreditHold(request);
      const replay = await store.createTaskWithCreditHold({
        ...request,
        task: { ...request.task, id: `${adapter.name}-durable-retry` },
        hold: { ...request.hold, id: `${adapter.name}-durable-hold-retry` },
      });
      assert.equal(replay.task.id, first.task.id);
      assert.equal(replay.hold.id, first.hold.id);
      assert.equal((await store.getUser(user.id)).balance, 0);
      const claimed = await store.claimTask(`${adapter.name}-worker`, { leaseDurationMs: 10 });
      assert.equal(claimed.id, first.task.id);
      const reclaimed = await store.reclaimExpiredTasks(new Date(Date.now() + 20));
      assert.equal(reclaimed[0].id, first.task.id);
      assert.equal(reclaimed[0].status, "retryable");
    } finally {
      await store.close();
    }
  });
}
