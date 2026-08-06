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

async function readResponse(response, verifySignature) {
  const text = await response.text();
  if (verifySignature) verifySignature(response.headers, text);
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw paymentError("Malformed WeChat Pay response JSON", 502, "PAYMENT_RESPONSE_INVALID");
  }
  if (!response.ok) throw errorFromResponse(response.status, payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw paymentError("Malformed WeChat Pay response payload", 502, "PAYMENT_RESPONSE_INVALID");
  }
  return payload;
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
  if (typeof headers.get === "function") return String(headers.get(name) || "");
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
  const refundNotifyUrl = value(env, ["WECHAT_PAY_REFUND_NOTIFY_URL"]);
  const publicKeyId = value(env, ["WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID"]);
  const platformCertificateSerial = value(env, ["WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL", "WECHAT_PAY_PLATFORM_CERT_SERIAL"]);
  const platformPublicKey = pem(value(env, ["WECHAT_PAY_PLATFORM_PUBLIC_KEY", "WECHAT_PAY_PUBLIC_KEY"]));
  const platformCertificate = pem(value(env, ["WECHAT_PAY_PLATFORM_CERTIFICATE", "WECHAT_PAY_CERTIFICATE"]));
  const publicKeys = value(env, ["WECHAT_PAY_PUBLIC_KEYS"]);
  const origin = value(env, ["WECHAT_PAY_API_ORIGIN"], API_ORIGIN).replace(/\/$/, "");
  const configuredRequestTimeoutMs = Number(value(env, ["WECHAT_PAY_REQUEST_TIMEOUT_MS"], "10000"));
  const requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs)
    ? Math.min(Math.max(configuredRequestTimeoutMs, 1), 30000)
    : 10000;

  function assertCreateConfig() {
    if (!merchantId || !appId || !serial || !privateKey || !notifyUrl) {
      throw paymentError("WeChat Pay v3 creation is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  function assertRequestConfig() {
    if (!merchantId || !serial || !privateKey) {
      throw paymentError("WeChat Pay request signing is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  function parsePublicKeys() {
    if (!publicKeys) return null;
    let parsed;
    try {
      parsed = JSON.parse(publicKeys);
    } catch {
      throw paymentError("WeChat Pay public key map is invalid", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw paymentError("WeChat Pay public key map is invalid", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    const keys = new Map();
    for (const [id, key] of Object.entries(parsed)) {
      if (String(id).trim() && String(key || "").trim()) keys.set(String(id).trim(), pem(key));
    }
    if (!keys.size) throw paymentError("WeChat Pay public key map is empty", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    return keys;
  }

  function assertVerificationConfig() {
    if (!platformPublicKey && !platformCertificate && !publicKeys) {
      throw paymentError("WeChat Pay response verification is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    if (publicKeys) {
      parsePublicKeys();
      return;
    }
    if (platformPublicKey) {
      if (!publicKeyId) {
        throw paymentError("WeChat Pay public key ID is required for response verification", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
      }
      return;
    }
    if (!platformCertificateSerial) {
      throw paymentError("WeChat Pay platform certificate serial is required for response verification", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  function verificationKey(serialValue) {
    const keyMap = parsePublicKeys();
    if (keyMap) {
      const key = keyMap.get(serialValue);
      if (!key) throw paymentError("Unknown WeChat Pay public key id", 400, "PAYMENT_SIGNATURE_INVALID");
      return key;
    }

    if (platformPublicKey) {
      if (serialValue !== publicKeyId) throw paymentError("Unknown WeChat Pay public key id", 400, "PAYMENT_SIGNATURE_INVALID");
      return platformPublicKey;
    }
    if (platformCertificate) {
      if (serialValue !== platformCertificateSerial) {
        throw paymentError("Unknown WeChat Pay platform certificate serial", 400, "PAYMENT_SIGNATURE_INVALID");
      }
      return platformCertificate;
    }
    throw paymentError("WeChat Pay response verification is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
  }

  function verifySignedPayload(headers, body, kind, status) {
    assertVerificationConfig();
    const timestamp = headerValue(headers, "wechatpay-timestamp");
    const nonceValue = headerValue(headers, "wechatpay-nonce");
    const signature = headerValue(headers, "wechatpay-signature");
    const serialValue = headerValue(headers, "wechatpay-serial");
    if (!timestamp || !nonceValue || !signature || !serialValue) {
      throw paymentError(`Invalid WeChat Pay ${kind} signature headers`, status, "PAYMENT_SIGNATURE_INVALID");
    }
    const timestampNumber = Number(timestamp);
    const age = Math.abs(Math.floor(clock().getTime() / 1000) - timestampNumber);
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(timestampNumber) || age > 300) {
      throw paymentError(`WeChat Pay ${kind} signature timestamp is outside the allowed window`, status, "PAYMENT_SIGNATURE_INVALID");
    }
    const key = verificationKey(serialValue);
    let valid = false;
    try {
      valid = crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${timestamp}\n${nonceValue}\n${body}\n`),
        crypto.createPublicKey(key),
        Buffer.from(signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw paymentError(`Invalid WeChat Pay ${kind} signature`, status, "PAYMENT_SIGNATURE_INVALID");
  }

  function verifyResponse(headers, body) {
    verifySignedPayload(headers, body, "response", 502);
  }

  function assertNotifyConfig() {
    if (!apiV3Key || apiV3Key.length !== 32) {
      throw paymentError("WeChat Pay notification verification is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    assertVerificationConfig();
  }

  async function request(method, path, body) {
    assertRequestConfig();
    const encoded = body ? JSON.stringify(body) : "";
    const requestNonce = nonce();
    const timestamp = unixTimestamp(clock);
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorizationHeader({ merchantId, serial, privateKey, nonce: requestNonce, timestamp, method, path, body: encoded }),
    };
    const signal = AbortSignal.timeout(requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, { method, headers, body: encoded || undefined, signal });
    } catch (error) {
      if (signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
        const timeoutError = paymentError("WeChat Pay request timed out", 504, "PAYMENT_PROVIDER_TIMEOUT");
        timeoutError.retryable = true;
        throw timeoutError;
      }
      throw error;
    }
    return readResponse(response, verifyResponse);
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
    verifySignedPayload(headers, body, "notification", 400);
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
    if (!refundNotifyUrl) {
      throw paymentError("WeChat Pay refund notify URL is not configured", 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    const order = input.order || {};
    const total = amountCents(order);
    const refund = Number(input.refundAmountCents || total);
    if (!Number.isSafeInteger(refund) || refund <= 0 || refund > total) throw new Error("Refund amount must be between 1 and the paid amount");
    return request("POST", REFUND_PATH, {
      out_trade_no: order.id,
      out_refund_no: `refund_${order.id}`,
      reason: String(input.reason || "").slice(0, 80) || undefined,
      notify_url: refundNotifyUrl,
      amount: { refund, total, currency: order.currency || "CNY" },
    });
  }

  function inputValue(input, keys, label) {
    const source = typeof input === "string" ? input : input || {};
    for (const key of keys) {
      const candidate = typeof source === "string" ? source : source[key];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate).trim();
    }
    throw new Error(`WeChat Pay ${label} is required`);
  }

  async function queryOrder(input) {
    const outTradeNo = inputValue(input, ["outTradeNo", "out_trade_no"], "out_trade_no");
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(merchantId)}`;
    return request("GET", path);
  }

  async function queryRefund(input) {
    const outRefundNo = inputValue(input, ["outRefundNo", "out_refund_no"], "out_refund_no");
    return request("GET", `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);
  }

  return {
    name: "wechat-pay-v3",
    mode: "wechat",
    createPayment,
    refund,
    queryOrder,
    queryRefund,
    parseNotification,
    verifyNotification,
    decryptNotification,
  };
}

module.exports = {
  createWechatPayV3Provider,
  authorizationHeader,
};
