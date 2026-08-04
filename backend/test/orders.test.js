const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createMemoryStore } = require("../src/store");

async function json(response) {
  return response.json();
}

async function login(app, code) {
  const response = await json(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code }),
  })));
  assert.equal(response.success, true);
  return `Bearer ${response.data.token}`;
}

function createTestApp() {
  return createApp({
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      MINIAPP_PAYMENT_MODE: "mock",
      WECHAT_MINIAPP_APP_ID: "wx-orders-test",
      MINIAPP_INITIAL_CREDITS: "10",
    },
    store: createMemoryStore({ environment: "test", initialCredits: 10 }),
  });
}

test("order response keeps a server snapshot but does not expose payment or owner internals", async () => {
  const app = createTestApp();
  try {
    const authorization = await login(app, "orders-owner");
    const response = await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "snapshot-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    }));
    const body = await json(response);
    assert.equal(response.status, 201);
    assert.equal(body.data.order.productSnapshot.id, "credits_20");
    assert.equal(body.data.order.userId, undefined);
    assert.equal(body.data.order.idempotencyKey, undefined);
    assert.equal(body.data.order.paymentParams, undefined);
    assert.equal(body.data.order.requestFingerprint, undefined);
  } finally {
    app.close();
  }
});

test("billing response preserves independent paginated order, ledger, and payment collections", async () => {
  const app = createTestApp();
  try {
    const authorization = await login(app, "billing-owner");
    const created = await json(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    const billing = await json(await app.fetch(new Request("http://local/api/miniapp/billing?page=1&limit=20", {
      headers: { authorization },
    })));
    assert.equal(billing.success, true);
    assert.equal(billing.data.orders.pagination.total, 1);
    assert.equal(billing.data.creditTransactions.pagination.total, 0);
    assert.equal(billing.data.paymentEvents.pagination.total, 1);
    assert.equal(billing.data.orders.records[0].id, created.data.order.id);
    assert.equal(billing.data.paymentEvents.records[0].userId, undefined);
  } finally {
    app.close();
  }
});

test("account profile validation accepts one to forty characters and rejects empty or oversized names", async () => {
  const app = createTestApp();
  try {
    const authorization = await login(app, "profile-owner");
    const empty = await app.fetch(new Request("http://local/api/miniapp/account/me", {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    }));
    const oversized = await app.fetch(new Request("http://local/api/miniapp/account/me", {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(41) }),
    }));
    const valid = await json(await app.fetch(new Request("http://local/api/miniapp/account/me", {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "柠檬米" }),
    })));
    assert.equal(empty.status, 400);
    assert.equal(oversized.status, 400);
    assert.equal(valid.success, true);
    assert.equal(valid.data.user.name, "柠檬米");
    assert.equal(valid.data.user.openid, undefined);
  } finally {
    app.close();
  }
});
