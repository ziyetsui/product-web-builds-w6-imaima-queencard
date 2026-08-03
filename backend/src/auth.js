const crypto = require("node:crypto");

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
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
  createSessionToken,
  hashSessionToken,
  wechatIdentity,
};
