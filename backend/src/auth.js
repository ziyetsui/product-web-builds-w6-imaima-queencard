const crypto = require("node:crypto");

const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function assertSecret(secret) {
  if (!secret || secret.length < 8) {
    throw new Error("Missing or weak MINIAPP_AUTH_TOKEN_SECRET");
  }
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createMiniappToken(options) {
  assertSecret(options.secret);
  const nowSeconds = Math.floor((options.now || new Date()).getTime() / 1000);
  const payload = {
    sub: `wechat:${options.appid}:${options.openid}`,
    appid: options.appid,
    openid: options.openid,
    ...(options.unionid ? { unionid: options.unionid } : {}),
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds || DEFAULT_TOKEN_TTL_SECONDS),
  };
  const headerPart = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signedPart = `${headerPart}.${payloadPart}`;
  return `${signedPart}.${sign(signedPart, options.secret)}`;
}

function verifyMiniappToken(token, options) {
  assertSecret(options.secret);
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid miniapp token format");
  }
  const signedPart = `${parts[0]}.${parts[1]}`;
  const expected = sign(signedPart, options.secret);
  const actual = parts[2];
  if (actual.length !== expected.length) {
    throw new Error("Invalid miniapp token signature");
  }
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    throw new Error("Invalid miniapp token signature");
  }
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  const nowSeconds = Math.floor((options.now || new Date()).getTime() / 1000);
  if (!payload.sub || !payload.appid || !payload.openid || !payload.exp) {
    throw new Error("Invalid miniapp token payload");
  }
  if (payload.exp <= nowSeconds) {
    throw new Error("Miniapp token expired");
  }
  if (options.expectedAppid && payload.appid !== options.expectedAppid) {
    throw new Error("Invalid miniapp token appid");
  }
  return payload;
}

module.exports = {
  createMiniappToken,
  verifyMiniappToken,
};
