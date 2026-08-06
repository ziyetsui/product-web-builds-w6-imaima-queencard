const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const billingPath = require.resolve("../services/billing.js");
const pricingPagePath = require.resolve("../pages/pricing/index.js");
const apiPath = require.resolve("../services/api.js");
const sessionPath = require.resolve("../services/session.js");
const env = require("../config/env.js");

function createWxHarness(envVersion) {
  const requests = [];
  const modals = [];
  const storage = new Map();
  global.wx = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    getAccountInfoSync() {
      return { miniProgram: { envVersion: envVersion || "develop" } };
    },
    request(options) {
      requests.push(options);
      return { abort() {} };
    },
    requestPayment(options) {
      options.success({});
    },
    showModal(options) {
      modals.push(options);
    },
  };
  return { requests, modals };
}

function unload() {
  delete require.cache[pricingPagePath];
  delete require.cache[billingPath];
  delete require.cache[apiPath];
  delete require.cache[sessionPath];
  delete global.Page;
  delete global.wx;
}

function loadPricingPage(envVersion) {
  let page;
  global.Page = (definition) => {
    page = definition;
  };
  if (!global.wx) createWxHarness(envVersion);
  delete require.cache[pricingPagePath];
  require(pricingPagePath);
  return page;
}

test("reconcileOrder asks the backend to verify the order after WeChat payment", async () => {
  const harness = createWxHarness();
  try {
    const billing = require(billingPath);
    const pending = billing.reconcileOrder("order-123");

    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].method, "POST");
    assert.match(harness.requests[0].url, /\/api\/miniapp\/orders\/order-123\/reconcile$/);

    harness.requests[0].success({
      statusCode: 200,
      data: {
        success: true,
        data: {
          order: {
            id: "order-123",
            status: "paid",
            paymentStatus: "fulfilled",
            creditsGranted: 20,
          },
        },
      },
    });

    const result = await pending;
    assert.equal(result.order.id, "order-123");
    assert.equal(billing.describeOrderStatus(result.order).state, "fulfilled");
  } finally {
    unload();
  }
});

test("payment status descriptions keep cancellation, syncing, fulfillment, failure, cancellation, and refund distinct", () => {
  const billing = require(billingPath);
  const cases = [
    [{}, "user_canceled", "已取消支付"],
    [{ status: "pending", paymentStatus: "created" }, "paid_syncing", "支付已提交"],
    [{ status: "paid", paymentStatus: "fulfilled" }, "fulfilled", "已完成"],
    [{ status: "failed", paymentStatus: "failed" }, "failed", "支付失败"],
    [{ status: "canceled", paymentStatus: "canceled" }, "canceled", "订单已取消"],
    [{ status: "pending", paymentStatus: "refund_pending" }, "refund_pending", "退款处理中"],
    [{ status: "pending", paymentStatus: "refunding" }, "refunding", "退款处理中"],
    [{ status: "refunded", paymentStatus: "refunded" }, "refunded", "已退款"],
  ];

  for (const [order, fallback, label] of cases) {
    const description = billing.describeOrderStatus(order, fallback);
    assert.equal(description.state, fallback);
    assert.equal(description.label, label);
    assert.ok(description.message);
  }
});

test("normalizes serialized order timestamps, revoked credits, and product snapshot name", () => {
  const billing = require(billingPath);
  const result = billing.normalizeOrderResult({
    order: {
      id: "order-123",
      productSnapshot: { title: "20 次创作包" },
      fulfilled_at: "2026-08-05T01:02:03.000Z",
      refunded_at: "2026-08-05T02:03:04.000Z",
      canceled_at: "2026-08-05T03:04:05.000Z",
      credits_revoked: 7,
    },
  }).order;

  assert.equal(result.productName, "20 次创作包");
  assert.equal(result.fulfilledAt, "2026-08-05T01:02:03.000Z");
  assert.equal(result.refundedAt, "2026-08-05T02:03:04.000Z");
  assert.equal(result.canceledAt, "2026-08-05T03:04:05.000Z");
  assert.equal(result.creditsRevoked, 7);
});

test("payment errors convert user cancellation into a safe status message", () => {
  const billing = require(billingPath);
  const canceled = billing.describePaymentError({ errMsg: "requestPayment:fail cancel" });
  const failed = billing.describePaymentError({ errMsg: "requestPayment:fail system error" });

  assert.equal(canceled.state, "user_canceled");
  assert.equal(canceled.label, "已取消支付");
  assert.equal(failed.state, "failed");
  assert.equal(failed.message, "支付未完成，请稍后重试。");
});

test("payment completion waits on backend reconciliation instead of local order polling", async () => {
  const page = loadPricingPage("develop");
  const billing = require(billingPath);
  const originalReconcile = billing.reconcileOrder;
  const originalGetOrder = billing.getOrder;
  let calls = 0;
  billing.reconcileOrder = async (orderId) => {
    calls += 1;
    return { order: { id: orderId, status: "paid", paymentStatus: "fulfilled", creditsGranted: 20 } };
  };
  billing.getOrder = async () => {
    throw new Error("local order polling must not be used after payment");
  };

  try {
    const order = await page.waitForOrder("order-123");
    assert.equal(order.id, "order-123");
    assert.equal(calls, 1);
  } finally {
    billing.reconcileOrder = originalReconcile;
    billing.getOrder = originalGetOrder;
    unload();
  }
});

test("reconcile failures keep payment in a generic syncing state", async () => {
  const page = loadPricingPage("release");
  const billing = require(billingPath);
  const originalCreateOrder = billing.createOrder;
  const originalReconcile = billing.reconcileOrder;
  page.data = Object.assign({}, page.data);
  page.setData = (patch) => {
    page.data = Object.assign({}, page.data, patch);
  };
  page.refreshCredits = () => {};
  billing.createOrder = async () => ({
    order: { id: "order-123", paymentMode: "wechat" },
    paymentParams: {
      timeStamp: "1",
      nonceStr: "nonce",
      package: "prepay_id=test",
      paySign: "signature",
    },
  });
  billing.reconcileOrder = async () => {
    throw new Error("provider secret must stay out of the mini program");
  };

  try {
    page.choosePack({ currentTarget: { dataset: { id: "credits_20" } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.paymentState, "paid_syncing");
    assert.equal(page.data.notice, "支付已提交，积分正在同步，请稍后查看订单。");
  } finally {
    billing.createOrder = originalCreateOrder;
    billing.reconcileOrder = originalReconcile;
    unload();
  }
});

test("release builds never expose the mock payment control", () => {
  const harness = createWxHarness("release");
  const page = loadPricingPage("release");
  page.setData = (patch) => {
    page.data = Object.assign({}, page.data, patch);
  };

  try {
    page.offerMockPay({ id: "order-123" });
    assert.equal(harness.modals.length, 0);
    assert.equal(page.data.paymentState, "failed");
    assert.match(page.data.notice, /支付通道暂不可用/);
  } finally {
    unload();
  }
});

test("missing payment params expose mock completion only for an explicitly mock order", () => {
  const harness = createWxHarness("develop");
  const page = loadPricingPage("develop");
  page.setData = (patch) => {
    page.data = Object.assign({}, page.data, patch);
  };

  try {
    page.offerMockPay({ id: "wechat-order", paymentMode: "wechat" });
    page.offerMockPay({ id: "unknown-order", paymentMode: "unknown" });
    assert.equal(harness.modals.length, 0);

    page.offerMockPay({ id: "mock-order", paymentMode: "mock" });
    assert.equal(harness.modals.length, 1);
  } finally {
    unload();
  }
});

test("pricing renders the normalized payment state label", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../pages/pricing/index.wxml"), "utf8");
  assert.match(source, /paymentStateLabel/);
});
