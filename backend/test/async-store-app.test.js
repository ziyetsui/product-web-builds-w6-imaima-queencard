const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createMemoryStore } = require("../src/store");

function asyncStoreFrom(store, overrides = {}) {
  const wrapped = {};
  for (const [name, value] of Object.entries(store)) {
    if (typeof value !== "function") {
      wrapped[name] = value;
      continue;
    }
    wrapped[name] = (...args) => new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(value(...args));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  return { ...wrapped, ...overrides };
}

function testEnv() {
  return {
    NODE_ENV: "test",
    MINIAPP_DEV_LOGIN: "1",
    MINIAPP_PAYMENT_MODE: "mock",
    MINIAPP_AUTH_TOKEN_SECRET: "async-store-test-secret-that-is-long-enough",
    WECHAT_MINIAPP_APP_ID: "wx-async-store",
    MINIAPP_ADMIN_OPENIDS: "dev_async-user",
  };
}

async function body(response) {
  return response.json();
}

async function login(app) {
  const response = await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "async-user" }),
  }));
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data.user.id, "wechat:wx-async-store:dev_async-user");
  assert.equal(payload.data.user.balance, 10);
  return `Bearer ${payload.data.token}`;
}

async function waitForCompletedTask(app, taskId, authorization) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.fetch(new Request(`http://local/api/miniapp/image-generations/${taskId}`, {
      headers: { authorization },
    }));
    const payload = await body(response);
    if (payload.data?.status === "completed") return payload.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Task ${taskId} did not complete`);
}

test("all API routes await a genuinely asynchronous store and return concrete DTOs", async () => {
  const base = createMemoryStore({ initialCredits: 10 });
  const store = asyncStoreFrom(base);
  const app = createApp({
    env: testEnv(),
    store,
    imageProvider: {
      name: "async-provider",
      async generate() {
        await new Promise((resolve) => setImmediate(resolve));
        return {
          status: "completed",
          provider: "async-provider",
          images: ["https://cdn.example.com/async-result.png"],
          raw: { requestId: "async-request-1" },
        };
      },
    },
  });
  const authorization = await login(app);

  const me = await body(await app.fetch(new Request("http://local/api/miniapp/account/me", {
    headers: { authorization },
  })));
  assert.equal(me.data.user.openid, "dev_async-user");

  const templates = await body(await app.fetch(new Request("http://local/api/miniapp/templates?page=1&limit=2")));
  assert.equal(Array.isArray(templates.data.records), true);
  assert.equal(typeof templates.data.pagination.total, "number");

  const createdOrder = await body(await app.fetch(new Request("http://local/api/miniapp/orders", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ productId: "credits_20" }),
  })));
  assert.equal(createdOrder.data.order.productId, "credits_20");

  const orders = await body(await app.fetch(new Request("http://local/api/miniapp/orders", {
    headers: { authorization },
  })));
  assert.equal(orders.data.records[0].id, createdOrder.data.order.id);

  const billing = await body(await app.fetch(new Request("http://local/api/miniapp/billing", {
    headers: { authorization },
  })));
  assert.equal(billing.data.user.id, "wechat:wx-async-store:dev_async-user");
  assert.equal(Array.isArray(billing.data.orders.records), true);
  assert.equal(Array.isArray(billing.data.creditTransactions.records), true);
  assert.equal(Array.isArray(billing.data.paymentEvents.records), true);

  const adjusted = await body(await app.fetch(new Request("http://local/api/miniapp/admin/credits/add", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ userId: billing.data.user.id, amount: 2, reason: "async-admin" }),
  })));
  assert.equal(adjusted.data.user.balance, 12);

  const submitted = await body(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Async generation", capability: "text-to-image", outputCount: 1 }),
  })));
  assert.equal(typeof submitted.data.taskId, "string");
  assert.equal(submitted.data.status, "pending");
  const completed = await waitForCompletedTask(app, submitted.data.taskId, authorization);
  assert.equal(completed.images[0], "https://cdn.example.com/async-result.png");

  const history = await body(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    headers: { authorization },
  })));
  assert.equal(history.data.records.some((record) => record.id === submitted.data.taskId), true);

  const credits = await body(await app.fetch(new Request("http://local/api/miniapp/credit/history", {
    headers: { authorization },
  })));
  assert.equal(credits.data.records.some((record) => record.amount === -1), true);

  const regenerated = await body(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${submitted.data.taskId}/regenerate`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: "{}",
  })));
  assert.equal(typeof regenerated.data.taskId, "string");
  assert.notEqual(regenerated.data.taskId, submitted.data.taskId);

  const assetId = encodeURIComponent("https://cdn.example.com/async-result.png");
  const download = await app.fetch(new Request(`http://local/api/miniapp/image-assets/${assetId}/download`, {
    headers: { authorization },
    redirect: "manual",
  }));
  assert.equal(download.status, 302);
  assert.equal(download.headers.get("location"), "https://cdn.example.com/async-result.png");

  await app.close();
});

test("async store rejections are converted into the route error response", async () => {
  const base = createMemoryStore({ initialCredits: 10 });
  const unavailable = new Error("database temporarily unavailable");
  unavailable.status = 503;
  const store = asyncStoreFrom(base, {
    async listOrders() {
      await new Promise((resolve) => setImmediate(resolve));
      throw unavailable;
    },
  });
  const app = createApp({ env: testEnv(), store });
  const authorization = await login(app);

  const response = await app.fetch(new Request("http://local/api/miniapp/billing", {
    headers: { authorization },
  }));
  const payload = await body(response);

  assert.equal(response.status, 503);
  assert.deepEqual(payload, { success: false, error: "database temporarily unavailable" });
  await app.close();
});
