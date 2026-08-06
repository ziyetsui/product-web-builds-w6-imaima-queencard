const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createWechatPayV3Provider } = require("../src/payments/wechat-pay-v3");

function fixture() {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    apiV3Key: "12345678901234567890123456789012",
    env: {
      WECHAT_MINIAPP_APP_ID: "wx-pay-test",
      WECHAT_PAY_MERCHANT_ID: "mch-test",
      WECHAT_PAY_CERTIFICATE_SERIAL: "serial-test",
      WECHAT_PAY_PRIVATE_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      WECHAT_PAY_API_V3_KEY: "12345678901234567890123456789012",
      WECHAT_PAY_NOTIFY_URL: "https://pay.example.com/api/miniapp/payments/wechat/notify",
      WECHAT_PAY_PUBLIC_KEY_ID: "wechat-public-key-test",
      WECHAT_PAY_PLATFORM_PUBLIC_KEY: pair.publicKey.export({ type: "spki", format: "pem" }),
    },
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function signedResponse(f, payload, options = {}) {
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp || "1785801600";
  const responseNonce = options.nonce || "response-nonce";
  const serial = options.serial || "wechat-public-key-test";
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${responseNonce}\n${body}\n`),
    f.privateKey,
  ).toString("base64");
  return response(payload, options.status || 200, {
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": responseNonce,
    "Wechatpay-Signature": signature,
    "Wechatpay-Serial": serial,
  });
}

test("creates a JSAPI payment with a valid WeChat v3 authorization and mini-program signature", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return signedResponse(f, { prepay_id: "prepay-test" });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
    nonce: () => "nonce-test",
  });

  const result = await provider.createPayment({
    order: {
      id: "ord_test_1",
      amountCents: 1900,
      currency: "CNY",
      productSnapshot: { title: "20 次创作包" },
    },
    openid: "openid-test",
  });

  assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.amount, { total: 1900, currency: "CNY" });
  assert.equal(body.appid, "wx-pay-test");
  assert.equal(body.mchid, "mch-test");
  assert.equal(body.payer.openid, "openid-test");
  assert.match(request.options.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
  assert.equal(result.paymentParams.package, "prepay_id=prepay-test");
  assert.equal(result.paymentParams.signType, "RSA");
  assert.equal(result.paymentParams.timeStamp, "1785801600");
  assert.equal(result.paymentParams.nonceStr, "nonce-test");
  const miniMessage = `wx-pay-test\n${result.paymentParams.timeStamp}\nnonce-test\nprepay_id=prepay-test\n`;
  const directSignature = crypto.sign("RSA-SHA256", Buffer.from(miniMessage), f.privateKey).toString("base64");
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(miniMessage), f.publicKey, Buffer.from(result.paymentParams.paySign, "base64")), true);
});

test("verifies and decrypts WeChat payment notifications and rejects a bad signature", () => {
  const f = fixture();
  const provider = createWechatPayV3Provider({
    env: f.env,
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });
  const resource = {
    algorithm: "AEAD_AES_256_GCM",
    ciphertext: "",
    associated_data: "transaction",
    nonce: "nonce-123",
  };
  const plaintext = JSON.stringify({ out_trade_no: "ord_test_1", transaction_id: "wx_tx_1", trade_state: "SUCCESS" });
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(f.apiV3Key), Buffer.from(resource.nonce));
  cipher.setAAD(Buffer.from(resource.associated_data));
  resource.ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = JSON.stringify({ resource });
  const timestamp = "1785801600";
  const nonce = "notify-nonce";
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(message), f.privateKey).toString("base64");
  const result = provider.parseNotification({
    headers: {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signature,
      "wechatpay-serial": "wechat-public-key-test",
    },
    body,
  });
  assert.deepEqual(result, { out_trade_no: "ord_test_1", transaction_id: "wx_tx_1", trade_state: "SUCCESS" });
  assert.throws(() => provider.parseNotification({
    headers: {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signature.slice(0, -4) + "xxxx",
      "wechatpay-serial": "wechat-public-key-test",
    },
    body,
  }), /signature/i);
});

test("uses the original order id for an idempotent refund request", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: {
      ...f.env,
      WECHAT_PAY_REFUND_NOTIFY_URL: "https://pay.example.com/api/miniapp/payments/wechat/refund-notify",
    },
    fetch: async (url, options) => {
      request = { url, options };
      return signedResponse(f, { refund_id: "refund-test", status: "PROCESSING" });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
    nonce: () => "nonce-refund",
  });
  const result = await provider.refund({
    order: { id: "ord_test_1", amountCents: 1900, currency: "CNY" },
    refundAmountCents: 1900,
    reason: "用户申请退款",
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "transaction_id"), false);
  assert.equal(body.out_trade_no, "ord_test_1");
  assert.equal(body.out_refund_no, "refund_ord_test_1");
  assert.equal(body.notify_url, "https://pay.example.com/api/miniapp/payments/wechat/refund-notify");
  assert.deepEqual(body.amount, { refund: 1900, total: 1900, currency: "CNY" });
  assert.equal(result.refund_id, "refund-test");
});

test("requires an explicit refund notify URL instead of reusing the transaction notify URL", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return signedResponse(f, { refund_id: "refund-test", status: "PROCESSING" });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
    nonce: () => "nonce-refund-missing-notify",
  });

  await assert.rejects(() => provider.refund({
    order: { id: "ord_test_1", amountCents: 1900, currency: "CNY" },
    refundAmountCents: 1900,
  }), /refund.*notify|refund.*configured/i);
  assert.equal(request, null);
});

test("queries an order by out_trade_no with a response key id separate from the merchant certificate serial", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return signedResponse(f, { out_trade_no: "ord_test_1", transaction_id: "wx_tx_1", trade_state: "SUCCESS" });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
    nonce: () => "nonce-query",
  });

  const result = await provider.queryOrder("ord_test_1");

  assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/ord_test_1?mchid=mch-test");
  assert.match(request.options.headers.Authorization, /serial_no="serial-test"/);
  const signature = request.options.headers.Authorization.match(/signature="([^"]+)"/)[1];
  assert.equal(crypto.verify(
    "RSA-SHA256",
    Buffer.from("GET\n/v3/pay/transactions/out-trade-no/ord_test_1?mchid=mch-test\n1785801600\nnonce-query\n\n"),
    f.publicKey,
    Buffer.from(signature, "base64"),
  ), true);
  assert.deepEqual(result, { out_trade_no: "ord_test_1", transaction_id: "wx_tx_1", trade_state: "SUCCESS" });
});

test("queries a refund by out_refund_no and verifies the signed response", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return signedResponse(f, { out_refund_no: "refund_ord_test_1", refund_status: "SUCCESS" });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
    nonce: () => "nonce-refund-query",
  });

  const result = await provider.queryRefund("refund_ord_test_1");

  assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/refund_ord_test_1");
  assert.match(request.options.headers.Authorization, /serial_no="serial-test"/);
  assert.deepEqual(result, { out_refund_no: "refund_ord_test_1", refund_status: "SUCCESS" });
});

test("bounds WeChat Pay requests with a timeout signal", async () => {
  const f = fixture();
  let requestSignal = null;
  const provider = createWechatPayV3Provider({
    env: { ...f.env, WECHAT_PAY_REQUEST_TIMEOUT_MS: "25" },
    fetch: async (url, options) => {
      void url;
      requestSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    },
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  await assert.rejects(
    provider.queryOrder("ord_timeout"),
    (error) => error.code === "PAYMENT_PROVIDER_TIMEOUT" && error.status === 504,
  );
  assert.equal(requestSignal instanceof AbortSignal, true);
  assert.equal(requestSignal.aborted, true);
});

test("selects a mapped response key by WeChat Pay serial without a single public key id", async () => {
  const f = fixture();
  const env = { ...f.env };
  delete env.WECHAT_PAY_PUBLIC_KEY_ID;
  delete env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
  env.WECHAT_PAY_PUBLIC_KEYS = JSON.stringify({
    "mapped-public-key-test": f.publicKey,
  });
  const provider = createWechatPayV3Provider({
    env,
    fetch: async () => signedResponse(f, {
      out_trade_no: "ord_test_1",
      trade_state: "SUCCESS",
    }, { serial: "mapped-public-key-test" }),
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  assert.deepEqual(await provider.queryOrder("ord_test_1"), {
    out_trade_no: "ord_test_1",
    trade_state: "SUCCESS",
  });
});

test("rejects a malformed signed WeChat response", async () => {
  const f = fixture();
  const rawBody = "not-json";
  const timestamp = "1785801600";
  const responseNonce = "malformed-response";
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${responseNonce}\n${rawBody}\n`),
    f.privateKey,
  ).toString("base64");
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async () => new Response(rawBody, {
      status: 200,
      headers: {
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": responseNonce,
        "Wechatpay-Signature": signature,
        "Wechatpay-Serial": "wechat-public-key-test",
      },
    }),
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  await assert.rejects(() => provider.queryOrder("ord_test_1"), /JSON|malformed|response/i);
});

test("retains platform certificate verification compatibility when no public key id is configured", async () => {
  const f = fixture();
  const env = { ...f.env };
  delete env.WECHAT_PAY_PUBLIC_KEY_ID;
  delete env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
  env.WECHAT_PAY_PLATFORM_CERTIFICATE = f.publicKey;
  env.WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL = "platform-certificate-test";
  const provider = createWechatPayV3Provider({
    env,
    fetch: async () => signedResponse(f, { out_trade_no: "ord_test_1", trade_state: "SUCCESS" }, {
      serial: "platform-certificate-test",
    }),
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  assert.deepEqual(await provider.queryOrder("ord_test_1"), {
    out_trade_no: "ord_test_1",
    trade_state: "SUCCESS",
  });
});

test("rejects the merchant certificate serial as a response serial when the public key id is absent", async () => {
  const f = fixture();
  const env = { ...f.env };
  delete env.WECHAT_PAY_PUBLIC_KEY_ID;
  const provider = createWechatPayV3Provider({
    env,
    fetch: async () => signedResponse(f, { out_trade_no: "ord_test_1", trade_state: "SUCCESS" }, {
      serial: "serial-test",
    }),
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  await assert.rejects(() => provider.queryOrder("ord_test_1"), /public key id|verification/i);
});

test("requires a platform certificate serial in certificate verification mode", async () => {
  const f = fixture();
  const env = { ...f.env };
  delete env.WECHAT_PAY_PUBLIC_KEY_ID;
  delete env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
  env.WECHAT_PAY_PLATFORM_CERTIFICATE = f.publicKey;
  const provider = createWechatPayV3Provider({
    env,
    fetch: async () => signedResponse(f, { out_trade_no: "ord_test_1", trade_state: "SUCCESS" }, {
      serial: "serial-test",
    }),
    clock: () => new Date("2026-08-04T00:00:00.000Z"),
  });

  await assert.rejects(() => provider.queryOrder("ord_test_1"), /certificate serial|verification/i);
});
