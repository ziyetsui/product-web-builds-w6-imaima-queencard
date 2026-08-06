const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createMemoryStore, createSqliteStore } = require("../src/store");
const {
  createPaymentReconciliationService,
  createPaymentReconciliationWorker,
} = require("../src/services/payment-reconciliation-service");

async function readJson(response) {
  return response.json();
}

async function login(app, code = "reconcile-user") {
  const response = await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code }),
  }));
  const body = await readJson(response);
  assert.equal(response.status, 200);
  return `Bearer ${body.data.token}`;
}

test("authenticated order reconcile verifies the provider transaction before one-time fulfillment", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  let orderId = "";
  let queryCalls = 0;
  const paymentProvider = {
    mode: "wechat",
    async createPayment() {
      return { paymentStatus: "created", paymentMode: "wechat", paymentParams: { package: "prepay_id=test" } };
    },
    async queryOrder(input) {
      queryCalls += 1;
      assert.equal(input.outTradeNo, orderId);
      return {
        appid: "wx-reconcile-test",
        mchid: "merchant-reconcile-test",
        out_trade_no: orderId,
        transaction_id: "wechat-transaction-reconcile-1",
        trade_state: "SUCCESS",
        success_time: "2026-08-05T00:00:00.000Z",
        amount: { total: 1900, currency: "CNY" },
      };
    },
  };
  const app = createApp({
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      PAYMENT_PROVIDER: "wechat",
      WECHAT_MINIAPP_APP_ID: "wx-reconcile-test",
      WECHAT_PAY_MERCHANT_ID: "merchant-reconcile-test",
    },
    store,
    paymentProvider,
  });

  try {
    const authorization = await login(app);
    const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "reconcile-order-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    orderId = created.data.order.id;

    const first = await readJson(await app.fetch(new Request(`http://local/api/miniapp/orders/${orderId}/reconcile`, {
      method: "POST",
      headers: { authorization },
    })));
    const second = await readJson(await app.fetch(new Request(`http://local/api/miniapp/orders/${orderId}/reconcile`, {
      method: "POST",
      headers: { authorization },
    })));

    assert.equal(first.success, true);
    assert.equal(first.data.order.status, "paid");
    assert.equal(second.data.order.status, "paid");
    assert.equal(queryCalls, 2);
    assert.equal(store.getUser("wechat:wx-reconcile-test:dev_reconcile-user").balance, 30);
  } finally {
    await app.close();
  }
});

test("refund acceptance stays paid until a verified refund query succeeds", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  let refundQueryStatus = "PROCESSING";
  let refundCalls = 0;
  const paymentProvider = {
    mode: "wechat",
    async createPayment() {
      return { paymentStatus: "created", paymentMode: "wechat", paymentParams: { package: "prepay_id=test" } };
    },
    async refund(input) {
      refundCalls += 1;
      assert.equal(input.outRefundNo, `refund_${input.order.id}`);
      return {
        refund_id: "refund-reconcile-1",
        out_refund_no: `refund_${input.order.id}`,
        status: "PROCESSING",
        amount: { refund: 1900, total: 1900, currency: "CNY" },
      };
    },
    async queryRefund(input) {
      assert.equal(input.outRefundNo, `refund_${input.order.id}`);
      return {
        refund_id: "refund-reconcile-1",
        out_trade_no: input.order.id,
        out_refund_no: `refund_${input.order.id}`,
        mchid: "merchant-refund-test",
        refund_status: refundQueryStatus,
        amount: { refund: 1900, total: 1900, currency: "CNY" },
      };
    },
  };
  const env = {
    NODE_ENV: "test",
    MINIAPP_DEV_LOGIN: "1",
    PAYMENT_PROVIDER: "wechat",
    WECHAT_MINIAPP_APP_ID: "wx-refund-test",
    WECHAT_PAY_MERCHANT_ID: "merchant-refund-test",
  };
  const app = createApp({ env, store, paymentProvider });

  try {
    const authorization = await login(app, "refund-admin");
    const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "refund-order-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    const orderId = created.data.order.id;
    await store.fulfillPayment({
      fulfillmentKey: "wechat:refund-payment-1",
      orderId,
      provider: "wechat",
      eventId: "refund-payment-1",
      providerTransactionId: "refund-payment-1",
      status: "FULFILLED",
      paymentVerified: true,
      paidAt: "2026-08-05T00:00:00.000Z",
    });

    env.MINIAPP_ADMIN_USER_IDS = "wechat:wx-refund-test:dev_refund-admin";
    const accepted = await readJson(await app.fetch(new Request(`http://local/api/miniapp/admin/orders/${orderId}/refund`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ reason: "customer request" }),
    })));
    assert.equal(accepted.success, true);
    assert.equal(accepted.data.order.status, "paid");
    assert.equal(accepted.data.order.refundStatus, "accepted");
    assert.equal(store.getUser("wechat:wx-refund-test:dev_refund-admin").balance, 30);

    const repeated = await readJson(await app.fetch(new Request(`http://local/api/miniapp/admin/orders/${orderId}/refund`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ reason: "customer request" }),
    })));
    assert.equal(repeated.success, true);
    assert.equal(repeated.data.order.refundStatus, "accepted");
    assert.equal(refundCalls, 1);
    assert.equal(store.listPaymentAudit(new URLSearchParams({ orderId })).records.filter((record) => record.type === "refund_accepted").length, 1);

    refundQueryStatus = "SUCCESS";
    const completed = await readJson(await app.fetch(new Request(`http://local/api/miniapp/admin/orders/${orderId}/reconcile`, {
      method: "POST",
      headers: { authorization },
    })));
    assert.equal(completed.success, true);
    assert.equal(completed.data.order.status, "refunded");
    assert.equal(completed.data.order.refundStatus, "succeeded");
    assert.equal(store.getUser("wechat:wx-refund-test:dev_refund-admin").balance, 10);
  } finally {
    await app.close();
  }
});

test("reconcile rejects a queried transaction with the wrong merchant before granting credits", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const paymentProvider = {
    mode: "wechat",
    async queryOrder() {
      return {
        appid: "wx-reconcile-test",
        mchid: "wrong-merchant",
        out_trade_no: "wrong-merchant-order",
        transaction_id: "wrong-merchant-transaction",
        trade_state: "SUCCESS",
        amount: { total: 1900 },
      };
    },
  };
  const app = createApp({
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      PAYMENT_PROVIDER: "wechat",
      WECHAT_MINIAPP_APP_ID: "wx-reconcile-test",
      WECHAT_PAY_MERCHANT_ID: "merchant-reconcile-test",
    },
    store,
    paymentProvider,
  });
  try {
    const authorization = await login(app, "identity-user");
    const userId = "wechat:wx-reconcile-test:dev_identity-user";
    const order = store.createOrder({ id: "wrong-merchant-order", userId, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20 });
    const response = await app.fetch(new Request(`http://local/api/miniapp/orders/${order.id}/reconcile`, {
      method: "POST",
      headers: { authorization },
    }));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "PAYMENT_RECONCILIATION_IDENTITY_MISMATCH");
    assert.equal(store.getUser(userId).balance, 10);
    assert.equal(store.getOrder(order.id).status, "pending");
  } finally {
    await app.close();
  }
});

test("refund requests reject partial amounts before contacting the provider", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const user = store.ensureUser({ sub: "partial-refund-user", appid: "wx-partial-refund", openid: "partial-refund-openid" });
  const order = store.createOrder({ id: "partial-refund-order", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20 });
  store.fulfillPayment({ fulfillmentKey: "partial-refund-payment", orderId: order.id, provider: "wechat", eventId: "partial-refund-payment", providerTransactionId: "partial-refund-payment", status: "FULFILLED", paymentVerified: true });
  const service = createPaymentReconciliationService({
    store,
    env: { WECHAT_MINIAPP_APP_ID: "wx-partial-refund", WECHAT_PAY_MERCHANT_ID: "merchant-partial-refund" },
    paymentProvider: {
      mode: "wechat",
      async refund() {
        return { refund_id: "partial-refund-provider", status: "PROCESSING", amount: { refund: 1000 } };
      },
    },
  });

  await assert.rejects(
    service.requestRefund(order.id, { refundAmountCents: 1000 }),
    (error) => error.code === "PAYMENT_REFUND_AMOUNT_MISMATCH",
  );
  assert.equal(store.getOrder(order.id).paymentStatus, "fulfilled");
  assert.equal(store.getOrder(order.id).refundStatus, "none");
});

test("initial refund acceptance requires the expected refund number and currency", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const user = store.ensureUser({ sub: "refund-response-user", appid: "wx-refund-response", openid: "refund-response-openid" });
  const order = store.createOrder({ id: "refund-response-order", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, currency: "CNY", credits: 20 });
  store.fulfillPayment({ fulfillmentKey: "refund-response-payment", orderId: order.id, provider: "wechat", eventId: "refund-response-payment", providerTransactionId: "refund-response-payment", status: "FULFILLED", paymentVerified: true });
  let response = {
    refund_id: "refund-response-provider",
    status: "PROCESSING",
    amount: { refund: 1900, total: 1900, currency: "CNY" },
  };
  const service = createPaymentReconciliationService({
    store,
    env: { WECHAT_MINIAPP_APP_ID: "wx-refund-response", WECHAT_PAY_MERCHANT_ID: "merchant-refund-response" },
    paymentProvider: { mode: "wechat", async refund() { return response; } },
  });

  await assert.rejects(
    service.requestRefund(order.id),
    (error) => error.code === "PAYMENT_REFUND_IDENTITY_MISMATCH",
  );

  response = {
    ...response,
    out_refund_no: `refund_${order.id}`,
    amount: { refund: 1900, total: 1900 },
  };
  await assert.rejects(
    service.requestRefund(order.id),
    (error) => error.code === "PAYMENT_REFUND_CURRENCY_MISMATCH",
  );

  response = {
    ...response,
    amount: { refund: 1900, total: 1900, currency: "USD" },
  };
  await assert.rejects(
    service.requestRefund(order.id),
    (error) => error.code === "PAYMENT_REFUND_CURRENCY_MISMATCH",
  );
});

test("refund identity and terminal failures preserve the local payment state", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const user = store.ensureUser({ sub: "refund-identity-user", appid: "wx-refund-identity", openid: "refund-identity-openid" });
  const order = store.createOrder({ id: "refund-identity-order", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20 });
  store.fulfillPayment({ fulfillmentKey: "refund-identity-payment", orderId: order.id, provider: "wechat", eventId: "refund-identity-payment", providerTransactionId: "refund-identity-payment", status: "FULFILLED", paymentVerified: true });
  store.acceptRefund(order.id, { refundId: "wechat-refund-identity", refundAmountCents: 1900, refundStatus: "accepted" });
  const service = createPaymentReconciliationService({
    store,
    env: { WECHAT_MINIAPP_APP_ID: "wx-refund-identity", WECHAT_PAY_MERCHANT_ID: "merchant-refund-identity" },
    paymentProvider: {
      mode: "wechat",
      async queryRefund(input) {
        assert.equal(input.outRefundNo, `refund_${order.id}`);
        return {
          refund_id: "wechat-refund-identity",
          out_trade_no: order.id,
          out_refund_no: `refund_${order.id}`,
          mchid: "wrong-refund-merchant",
          refund_status: "CLOSED",
          amount: { refund: 1900, total: 1900, currency: "CNY" },
        };
      },
    },
  });

  await assert.rejects(
    service.reconcileRefund(order.id),
    (error) => error.code === "PAYMENT_REFUND_IDENTITY_MISMATCH",
  );
  assert.equal(store.getOrder(order.id).paymentStatus, "refund_pending");

  const successService = createPaymentReconciliationService({
    store,
    env: { WECHAT_MINIAPP_APP_ID: "wx-refund-identity", WECHAT_PAY_MERCHANT_ID: "merchant-refund-identity" },
    paymentProvider: {
      mode: "wechat",
      async queryRefund() {
        return {
          refund_id: "wechat-refund-identity",
          out_trade_no: order.id,
          out_refund_no: `refund_${order.id}`,
          mchid: "merchant-refund-identity",
          refund_status: "CLOSED",
          amount: { refund: 1900, total: 1900, currency: "CNY" },
        };
      },
    },
  });
  const failed = await successService.reconcileRefund(order.id);
  assert.equal(failed.refundStatus, "failed");
  assert.equal(failed.order.paymentStatus, "fulfilled");
});

test("stale selection uses the last reconciliation timestamp", () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const user = store.ensureUser({ sub: "stale-selection-user", appid: "wx-stale-selection", openid: "stale-selection-openid" });
  store.createOrder({ id: "stale-selection-order", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20, createdAt: "2026-08-01T00:00:00.000Z" });
  const first = store.claimStaleOrders("stale-worker", { now: new Date("2026-08-05T00:00:00.000Z"), staleAfterMs: 60_000, leaseDurationMs: 60_000, limit: 1 });
  assert.equal(first.length, 1);
  store.releaseOrderReconciliationLease(first[0].id, "stale-worker", { reconciledAt: "2026-08-05T00:00:00.000Z" });
  const second = store.claimStaleOrders("stale-worker-2", { now: new Date("2026-08-05T00:00:30.000Z"), staleAfterMs: 60_000, leaseDurationMs: 60_000, limit: 1 });
  assert.equal(second.length, 0);
  void user;
});

test("application worker starts payment reconciliation in durable generation mode and stops with the app", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  let reconciliationStarts = 0;
  let reconciliationStops = 0;
  const app = createApp({
    env: {
      NODE_ENV: "production",
      GENERATION_WORKER_MODE: "durable",
      PAYMENT_PROVIDER: "wechat",
      WECHAT_MINIAPP_APP_ID: "wx-runtime-test",
      WECHAT_PAY_MERCHANT_ID: "merchant-runtime-test",
      MINIAPP_ASSET_SIGNING_SECRET: "test-only",
    },
    store,
    paymentProvider: { mode: "wechat" },
    worker: { start() {}, stop() {}, schedule() {}, runOnce() {} },
    paymentReconciliationWorker: {
      start() { reconciliationStarts += 1; },
      stop() { reconciliationStops += 1; },
    },
  });
  assert.equal(reconciliationStarts, 0);
  app.worker.start();
  assert.equal(reconciliationStarts, 1);
  await app.close();
  assert.equal(reconciliationStops, 1);
});

test("user reconcile is owner-scoped and rate-limited", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  const app = createApp({
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", PAYMENT_PROVIDER: "wechat", WECHAT_MINIAPP_APP_ID: "wx-scope-test", WECHAT_PAY_MERCHANT_ID: "merchant-scope-test" },
    store,
    paymentProvider: { mode: "wechat", async queryOrder() { throw new Error("must not query"); } },
  });
  try {
    const ownerAuthorization = await login(app, "scope-owner");
    const otherAuthorization = await login(app, "scope-other");
    const order = store.createOrder({ id: "owner-scoped-order", userId: "wechat:wx-scope-test:dev_scope-owner", productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20 });
    const response = await app.fetch(new Request(`http://local/api/miniapp/orders/${order.id}/reconcile`, {
      method: "POST",
      headers: { authorization: otherAuthorization },
    }));
    assert.equal(response.status, 404);
    assert.equal((await readJson(response)).error, "Order not found");
    void ownerAuthorization;
  } finally {
    await app.close();
  }

  const limitedStore = createMemoryStore({ environment: "test", initialCredits: 10 });
  const limitedApp = createApp({
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", PAYMENT_PROVIDER: "wechat", WECHAT_MINIAPP_APP_ID: "wx-limit-test", WECHAT_PAY_MERCHANT_ID: "merchant-limit-test" },
    store: limitedStore,
    rateLimiter: { consume({ scope }) { return scope === "order" ? { allowed: false, retryAfter: 9 } : { allowed: true, retryAfter: 0 }; } },
    paymentProvider: { mode: "wechat", async queryOrder() { throw new Error("must not query"); } },
  });
  try {
    const authorization = await login(limitedApp, "limited-user");
    const order = limitedStore.createOrder({ id: "limited-order", userId: "wechat:wx-limit-test:dev_limited-user", productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20 });
    const response = await limitedApp.fetch(new Request(`http://local/api/miniapp/orders/${order.id}/reconcile`, { method: "POST", headers: { authorization } }));
    assert.equal(response.status, 429);
    assert.equal((await readJson(response)).error.code, "RATE_LIMITED");
  } finally {
    await limitedApp.close();
  }
});

test("reconciliation worker claims a bounded stale batch and does not overlap its own lease", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10, clock: () => new Date("2026-08-05T00:10:00.000Z") });
  const user = store.ensureUser({ sub: "worker-user", appid: "wx-worker-test", openid: "worker-openid" });
  store.createOrder({ id: "stale-order-1", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20, createdAt: "2026-08-04T00:00:00.000Z" });
  store.createOrder({ id: "stale-order-2", userId: user.id, productId: "credits_20", paymentMode: "wechat", amountCents: 1900, credits: 20, createdAt: "2026-08-04T00:01:00.000Z" });
  let queryCalls = 0;
  const worker = createPaymentReconciliationWorker({
    store,
    paymentProvider: {
      mode: "wechat",
      async queryOrder() {
        queryCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { appid: "wx-worker-test", mchid: "merchant-worker-test", out_trade_no: "stale-order-1", transaction_id: `worker-tx-${queryCalls}`, trade_state: "NOTPAY", amount: { total: 1900 } };
      },
    },
    env: { WECHAT_MINIAPP_APP_ID: "wx-worker-test", WECHAT_PAY_MERCHANT_ID: "merchant-worker-test" },
    clock: () => new Date("2026-08-05T00:10:00.000Z"),
    batchSize: 1,
    staleAfterMs: 60_000,
  });
  const [first, overlap] = await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.equal(first.skipped, false);
  assert.equal(overlap.skipped, true);
  assert.equal(first.results.length, 1);
  assert.equal(queryCalls, 1);
  assert.equal(store.getOrder("stale-order-1").reconcileLeaseOwner, "");
  assert.equal(store.getOrder("stale-order-1").lastReconciledAt, "2026-08-05T00:10:00.000Z");
  assert.equal(store.getOrder("stale-order-2").reconcileLeaseOwner, "");
  worker.stop();
});

test("sqlite store keeps refund acceptance separate from verified completion", async () => {
  const store = createSqliteStore({ dbPath: ":memory:", environment: "test", initialCredits: 10 });
  try {
    const user = store.ensureUser({ sub: "sqlite-reconciliation-user", appid: "wx-sqlite-reconcile", openid: "sqlite-reconcile-openid" });
    const order = store.createOrder({ id: "sqlite-refund-order", userId: user.id, productId: "credits-5", paymentMode: "wechat", amountCents: 500, credits: 5 });
    store.fulfillPayment({ fulfillmentKey: "sqlite-payment-1", orderId: order.id, provider: "wechat", eventId: "sqlite-payment-1", providerTransactionId: "sqlite-payment-1", status: "FULFILLED", paymentVerified: true });
    const accepted = store.acceptRefund(order.id, { refundId: "sqlite-refund-1", refundAmountCents: 500, refundStatus: "accepted" });
    assert.equal(accepted.order.status, "paid");
    assert.equal(accepted.order.paymentStatus, "refund_pending");
    assert.equal(accepted.order.refundStatus, "accepted");
    assert.equal(store.getUser(user.id).balance, 15);
    const completed = store.completeRefund(order.id, { verified: true, refundId: "sqlite-refund-1", refundAmountCents: 500 });
    assert.equal(completed.order.status, "refunded");
    assert.equal(completed.order.refundStatus, "succeeded");
    assert.equal(store.getUser(user.id).balance, 10);
  } finally {
    store.close();
  }
});

test("refund callback uses its configured route and never creates a payment fulfillment", async () => {
  const store = createMemoryStore({ environment: "test", initialCredits: 10 });
  let orderId = "";
  const app = createApp({
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      PAYMENT_PROVIDER: "wechat",
      WECHAT_MINIAPP_APP_ID: "wx-refund-callback-test",
      WECHAT_PAY_MERCHANT_ID: "merchant-refund-callback-test",
      WECHAT_PAY_REFUND_NOTIFY_URL: "https://pay.test/hooks/refunds",
    },
    store,
    paymentProvider: {
      mode: "wechat",
      async createPayment() { return { paymentStatus: "created", paymentMode: "wechat", paymentParams: { package: "prepay_id=test" } }; },
      parseNotification() {
        return { out_trade_no: orderId, out_refund_no: `refund_${orderId}`, refund_id: "refund-callback-1", mchid: "merchant-refund-callback-test", refund_status: "SUCCESS", amount: { refund: 1900, total: 1900 } };
      },
    },
  });
  try {
    const authorization = await login(app, "refund-callback-user");
    const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    orderId = created.data.order.id;
    await store.fulfillPayment({ fulfillmentKey: "wechat:callback-payment", orderId, provider: "wechat", eventId: "callback-payment", providerTransactionId: "callback-payment", status: "FULFILLED", paymentVerified: true });
    await store.acceptRefund(orderId, { refundId: "refund-callback-1", refundAmountCents: 1900, refundStatus: "accepted" });
    const response = await app.fetch(new Request("http://local/hooks/refunds", { method: "POST", body: "{}" }));
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.data.order.status, "refunded");
    assert.equal(store.getPaymentFulfillment("wechat:refund-callback-1"), null);
  } finally {
    await app.close();
  }
});
