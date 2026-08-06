const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createPostgresStore } = require("../src/repositories/postgres-store");
const { applyPgMemSchema, createPgMemPool } = require("./support/pg-mem");

async function payload(response) {
  return response.json();
}

async function login(app, code = "payment-user") {
  const response = await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code }),
  }));
  const body = await payload(response);
  assert.equal(response.status, 200);
  return `Bearer ${body.data.token}`;
}

function testEnv() {
  return {
    NODE_ENV: "test",
    MINIAPP_DEV_LOGIN: "1",
    PAYMENT_PROVIDER: "wechat",
    WECHAT_MINIAPP_APP_ID: "wx-payment-app",
    WECHAT_PAY_MERCHANT_ID: "merchant-test",
  };
}

test("wechat provider creates an order and notification fulfillment is idempotent", async () => {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const store = createPostgresStore({ pool, environment: "test", initialCredits: 10 });
  let createCalls = 0;
  const paymentProvider = {
    name: "wechat-pay-v3",
    mode: "wechat",
    async createPayment() {
      createCalls += 1;
      return {
        paymentStatus: "created",
        paymentMode: "wechat",
        paymentParams: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=1", signType: "RSA", paySign: "sig" },
        providerOrderId: "prepay-1",
      };
    },
    parseNotification() {
      return {
        appid: "wx-payment-app",
        mchid: "merchant-test",
        out_trade_no: orderId,
        transaction_id: "wx-transaction-1",
        trade_state: "SUCCESS",
        trade_type: "JSAPI",
        success_time: "2026-08-04T00:00:00+08:00",
        amount: { total: 1900, currency: "CNY" },
      };
    },
  };
  let orderId = "";
  const app = createApp({ env: testEnv(), store, paymentProvider });
  try {
    const authorization = await login(app);
    const created = await payload(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "payment-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    orderId = created.data.order.id;
    assert.equal(created.data.paymentParams.package, "prepay_id=1");
    assert.equal(createCalls, 1);

    const replay = await payload(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "payment-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    assert.equal(replay.data.order.id, orderId);
    assert.equal(createCalls, 1);

    const firstNotify = await payload(await app.fetch(new Request("http://local/api/miniapp/payments/wechat/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })));
    const secondNotify = await payload(await app.fetch(new Request("http://local/api/miniapp/payments/wechat/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })));
    assert.deepEqual(firstNotify, { code: "SUCCESS", message: "成功", data: { fulfillmentId: firstNotify.data.fulfillmentId } });
    assert.deepEqual(secondNotify, firstNotify);
    assert.equal((await store.getUser("wechat:wx-payment-app:dev_payment-user")).balance, 30);
    assert.equal((await store.listPaymentAudit(new URLSearchParams({ orderId }))).records.length, 3);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("concurrent idempotent order creation reuses one WeChat out_trade_no", async () => {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const store = createPostgresStore({ pool, environment: "test", initialCredits: 10 });
  const providerOrderIds = [];
  let releaseBoth;
  const bothEntered = new Promise((resolve) => { releaseBoth = resolve; });
  const app = createApp({
    env: testEnv(),
    store,
    paymentProvider: {
      mode: "wechat",
      async createPayment({ order }) {
        providerOrderIds.push(order.id);
        if (providerOrderIds.length === 2) releaseBoth();
        await bothEntered;
        return {
          paymentStatus: "created",
          paymentMode: "wechat",
          paymentParams: { package: `prepay_id=${order.id}` },
          providerOrderId: order.id,
        };
      },
    },
  });
  try {
    const authorization = await login(app, "concurrent-payment-user");
    const createRequest = () => app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": "concurrent-payment-key",
      },
      body: JSON.stringify({ productId: "credits_20" }),
    }));

    const [first, second] = await Promise.all([createRequest(), createRequest()]);
    const [firstBody, secondBody] = await Promise.all([payload(first), payload(second)]);

    assert.equal([200, 201].includes(first.status), true);
    assert.equal([200, 201].includes(second.status), true);
    assert.equal(providerOrderIds.length, 2);
    assert.equal(new Set(providerOrderIds).size, 1);
    assert.equal(firstBody.data.order.id, secondBody.data.order.id);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("payment notification delegates transaction fulfillment to reconciliation", async () => {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const store = createPostgresStore({ pool, environment: "test", initialCredits: 10 });
  let orderId = "";
  let delegated = 0;
  const app = createApp({
    env: testEnv(),
    store,
    paymentReconciliationService: {
      async fulfillFromTransaction(order, transaction, input) {
        delegated += 1;
        assert.equal(order.id, orderId);
        assert.equal(transaction.trade_type, "JSAPI");
        assert.equal(input.source, "notify");
        return { fulfillment: { id: "delegated-fulfillment" } };
      },
    },
    paymentReconciliationWorker: { start() {}, stop() {} },
    paymentProvider: {
      mode: "wechat",
      async createPayment() {
        return { paymentStatus: "created", paymentMode: "wechat", paymentParams: { package: "prepay_id=delegated" } };
      },
      parseNotification() {
        return {
          appid: "wx-payment-app",
          mchid: "merchant-test",
          out_trade_no: orderId,
          transaction_id: "delegated-transaction",
          trade_state: "SUCCESS",
          trade_type: "JSAPI",
          amount: { total: 1900, currency: "CNY" },
        };
      },
    },
  });
  try {
    const authorization = await login(app, "delegated-payment-user");
    const created = await payload(await app.fetch(new Request("http://local/api/miniapp/orders", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", "idempotency-key": "delegated-payment-key" },
      body: JSON.stringify({ productId: "credits_20" }),
    })));
    orderId = created.data.order.id;
    const response = await payload(await app.fetch(new Request("http://local/api/miniapp/payments/wechat/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })));
    assert.equal(response.code, "SUCCESS");
    assert.equal(response.data.fulfillmentId, "delegated-fulfillment");
    assert.equal(delegated, 1);
  } finally {
    await app.close();
    await pool.end();
  }
});
