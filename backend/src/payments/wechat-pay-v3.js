const crypto = require("node:crypto");

const API_ORIGIN = "https://api.mch.weixin.qq.com";
const PAYMENT_PATH = "/v3/pay/transactions/jsapi";
const REFUND_PATH = "/v3/refund/domestic/refunds";

function value(env, keys, fallback = "") {
  for (const key of keys) {
    if (env[key] !== undefined && env[key] !== null && String(env[key]).trim() !== "") return String(env[key]).trim();
  }
  return fallback;
}

function pem(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function errorFromResponse(status, payload) {
  const details = payload && typeof payload === "object"
    ? payload.message || payload.code || JSON.stringify(payload)
    : String(payload || "");
  const error = new Error(`WeChat Pay request failed (${status})${details ? `: ${details}` : ""}`);
  error.status = status;
  error.provider = "wechat";
  return error;
}

function paymentError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readResponse(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw errorFromResponse(response.status, payload);
  return payload || {};
}

function unixTimestamp(clock) {
  return Math.floor((clock ? clock() : new Date()).getTime() / 1000).toString();
}

function signSha256(privateKey, message) {
  return crypto.sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64");
}

function authorizationHeader({ merchantId, serial, privateKey, nonce, timestamp, method, path, body }) {
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = signSha256(privateKey, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serial}",signature="${signature}"`;
}

function headerValue(headers, name) {
  if (!headers) return "";
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value || "");
  }
  return "";
}

function amountCents(order) {
  const value = Number(order && (order.amountCents !== undefined ? order.amountCents : order.amount_cents));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("WeChat Pay order amount must be a positive integer");
  return value;
}

function createWechatPayV3Provider(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const clock = options.clock || (() => new Date());
  const nonce = options.nonce || (() => crypto.randomBytes(16).toString("hex"));
  const merchantId = value(env, ["WECHAT_PAY_MERCHANT_ID", "WECHAT_MCHID"]);
  const appId = value(env, ["WECHAT_MINIAPP_APP_ID", "WECHAT_APP_ID"]);
  const serial = value(env, ["WECHAT_PAY_CERTIFICATE_SERIAL"]);
  const privateKey = pem(value(env, ["WECHAT_PAY_PRIVATE_KEY"]));
  const apiV3Key = value(env, ["WECHAT_PAY_API_V3_KEY"]);
  const notifyUrl = value(env, ["WECHAT_PAY_NOTIFY_URL"]);
  const platformPublicKey = pem(value(env, ["WECHAT_PAY_PLATFORM_PUBLIC_KEY", "WECHAT_PAY_PUBLIC_KEY"]));
  const origin = value(env, ["WECHAT_PAY_API_ORIGIN"], API_ORIGIN).replace(/\/$/, "");

  function assertCreateConfig() {
    if (!merchantId || !appId || !serial || !privateKey || !notifyUrl) {
      throw paymentError("WeChat Pay v3 creation is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  function assertNotifyConfig() {
    if (!serial || !apiV3Key || apiV3Key.length !== 32 || !platformPublicKey) {
      throw paymentError("WeChat Pay notification verification is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  async function request(method, path, body) {
    const encoded = body ? JSON.stringify(body) : "";
    const requestNonce = nonce();
    const timestamp = unixTimestamp(clock);
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorizationHeader({ merchantId, serial, privateKey, nonce: requestNonce, timestamp, method, path, body: encoded }),
    };
    const response = await fetchImpl(`${origin}${path}`, { method, headers, body: encoded || undefined });
    return readResponse(response);
  }

  async function createPayment(input = {}) {
    assertCreateConfig();
    const order = input.order || {};
    const total = amountCents(order);
    const snapshot = order.productSnapshot || {};
    const payload = await request("POST", PAYMENT_PATH, {
      appid: appId,
      mchid: merchantId,
      description: snapshot.title || snapshot.name || order.productId || "积分套餐",
      out_trade_no: order.id,
      notify_url: notifyUrl,
      amount: { total, currency: order.currency || "CNY" },
      payer: { openid: String(input.openid || "") },
    });
    if (!payload.prepay_id) throw new Error("WeChat Pay did not return prepay_id");
    const timeStamp = unixTimestamp(clock);
    const nonceStr = nonce();
    const packageValue = `prepay_id=${payload.prepay_id}`;
    const paySign = signSha256(privateKey, `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
    return {
      paymentStatus: "created",
      paymentMode: "wechat",
      paymentParams: { timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign },
      providerOrderId: payload.prepay_id,
    };
  }

  function verifyNotification(headers, body) {
    assertNotifyConfig();
    const timestamp = headerValue(headers, "wechatpay-timestamp");
    const nonceValue = headerValue(headers, "wechatpay-nonce");
    const signature = headerValue(headers, "wechatpay-signature");
    const serialValue = headerValue(headers, "wechatpay-serial");
    if (!timestamp || !nonceValue || !signature || serialValue !== serial) throw paymentError("Invalid WeChat Pay notification headers", 400, "PAYMENT_NOTIFICATION_INVALID");
    const age = Math.abs(Math.floor(clock().getTime() / 1000) - Number(timestamp));
    if (!Number.isSafeInteger(Number(timestamp)) || age > 300) throw paymentError("WeChat Pay notification timestamp is outside the allowed window", 400, "PAYMENT_NOTIFICATION_INVALID");
    const valid = crypto.verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonceValue}\n${body}\n`), platformPublicKey, Buffer.from(signature, "base64"));
    if (!valid) throw paymentError("Invalid WeChat Pay notification signature", 400, "PAYMENT_NOTIFICATION_INVALID");
  }

  function decryptNotification(resource) {
    assertNotifyConfig();
    if (!resource || resource.algorithm !== "AEAD_AES_256_GCM") throw new Error("Unsupported WeChat Pay notification algorithm");
    const ciphertext = Buffer.from(String(resource.ciphertext || ""), "base64");
    if (ciphertext.length < 17) throw new Error("Invalid WeChat Pay notification ciphertext");
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(String(resource.nonce || "")));
    decipher.setAAD(Buffer.from(String(resource.associated_data || "")));
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8"));
  }

  function parseNotification(input = {}) {
    const body = typeof input.body === "string" ? input.body : JSON.stringify(input.body || {});
    verifyNotification(input.headers || {}, body);
    return decryptNotification(JSON.parse(body).resource);
  }

  async function refund(input = {}) {
    assertCreateConfig();
    const order = input.order || {};
    const total = amountCents(order);
    const refund = Number(input.refundAmountCents || total);
    if (!Number.isSafeInteger(refund) || refund <= 0 || refund > total) throw new Error("Refund amount must be between 1 and the paid amount");
    return request("POST", REFUND_PATH, {
      transaction_id: input.providerTransactionId || undefined,
      out_trade_no: order.id,
      out_refund_no: `refund_${order.id}`,
      reason: String(input.reason || "").slice(0, 80) || undefined,
      amount: { refund, total, currency: order.currency || "CNY" },
    });
  }

  return {
    name: "wechat-pay-v3",
    mode: "wechat",
    createPayment,
    refund,
    parseNotification,
    verifyNotification,
    decryptNotification,
  };
}

module.exports = {
  createWechatPayV3Provider,
  authorizationHeader,
};
