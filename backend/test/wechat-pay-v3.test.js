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
    },
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("creates a JSAPI payment with a valid WeChat v3 authorization and mini-program signature", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return response({ prepay_id: "prepay-test" });
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
    env: { ...f.env, WECHAT_PAY_PLATFORM_PUBLIC_KEY: f.publicKey },
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
      "wechatpay-serial": "serial-test",
    },
    body,
  });
  assert.deepEqual(result, { out_trade_no: "ord_test_1", transaction_id: "wx_tx_1", trade_state: "SUCCESS" });
  assert.throws(() => provider.parseNotification({
    headers: {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signature.slice(0, -4) + "xxxx",
      "wechatpay-serial": "serial-test",
    },
    body,
  }), /signature/i);
});

test("uses the original order id for an idempotent refund request", async () => {
  const f = fixture();
  let request = null;
  const provider = createWechatPayV3Provider({
    env: f.env,
    fetch: async (url, options) => {
      request = { url, options };
      return response({ refund_id: "refund-test", status: "PROCESSING" });
    },
    nonce: () => "nonce-refund",
  });
  const result = await provider.refund({
    order: { id: "ord_test_1", amountCents: 1900, currency: "CNY" },
    refundAmountCents: 1900,
    reason: "用户申请退款",
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds");
  assert.equal(body.out_trade_no, "ord_test_1");
  assert.equal(body.out_refund_no, "refund_ord_test_1");
  assert.deepEqual(body.amount, { refund: 1900, total: 1900, currency: "CNY" });
  assert.equal(result.refund_id, "refund-test");
});
