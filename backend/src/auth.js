const crypto = require("node:crypto");

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function assertSessionTokenHash(tokenHash) {
  if (typeof tokenHash !== "string" || !/^[a-f0-9]{64}$/i.test(tokenHash)) {
    throw new TypeError("Session tokenHash must be a 64-character SHA-256 hash");
  }
  return tokenHash.toLowerCase();
}

function wechatIdentity(appid, openid, unionid) {
  const normalizedAppid = String(appid || "").trim();
  const normalizedOpenid = String(openid || "").trim();
  if (!normalizedAppid || !normalizedOpenid) {
    throw new TypeError("WeChat appid and openid are required");
  }
  return {
    sub: `wechat:${normalizedAppid}:${normalizedOpenid}`,
    appid: normalizedAppid,
    openid: normalizedOpenid,
    ...(unionid ? { unionid: String(unionid) } : {}),
  };
}

module.exports = {
  DEFAULT_SESSION_TTL_SECONDS,
  assertSessionTokenHash,
  createSessionToken,
  hashSessionToken,
  wechatIdentity,
};
