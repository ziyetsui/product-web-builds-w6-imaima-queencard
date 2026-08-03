const crypto = require("node:crypto");

const {
  DEFAULT_SESSION_TTL_SECONDS,
  createSessionToken,
  hashSessionToken,
  wechatIdentity,
} = require("../auth");

function isProduction(env) {
  return ["NODE_ENV", "APP_ENV", "RUNTIME_ENV"].some((key) => (
    ["production", "prod"].includes(String(env[key] || "").trim().toLowerCase())
  ));
}

function authError(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.publicMessage = message;
  return error;
}

function getEnv(env, key, fallback = "") {
  return env[key] || fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

class AuthService {
  constructor(options = {}) {
    if (!options.store) throw new TypeError("AuthService requires a store");
    this.store = options.store;
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || fetch;
    this.clock = options.clock || (() => new Date());
  }

  async loginWithCode(input = {}) {
    const code = String(input.code || "").trim();
    if (!code) throw authError("AUTH_REQUIRED", "请先登录", 400);

    const exchange = await this.exchangeCode(code);
    const appid = getEnv(this.env, "WECHAT_MINIAPP_APP_ID");
    const identity = wechatIdentity(appid, exchange.openid, exchange.unionid);
    const user = await this.store.ensureUser(identity);
    if (user && user.status === "disabled") throw authError("ACCOUNT_DISABLED", "账号已停用");

    const token = createSessionToken();
    const now = this.clock();
    const ttlSeconds = parsePositiveInteger(
      getEnv(this.env, "MINIAPP_SESSION_TTL_SECONDS"),
      DEFAULT_SESSION_TTL_SECONDS,
    );
    await this.store.createSession({
      id: `session_${crypto.randomBytes(16).toString("hex")}`,
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      ipAddress: input.ipAddress || "",
      userAgent: input.userAgent || "",
    });
    return { token, user };
  }

  async exchangeCode(code) {
    if (isProduction(this.env) && this.env.MINIAPP_DEV_LOGIN === "1") {
      throw authError("AUTH_CONFIG_INVALID", "登录配置不可用", 503);
    }

    const appid = getEnv(this.env, "WECHAT_MINIAPP_APP_ID");
    if (!appid) throw authError("AUTH_CONFIG_INVALID", "登录配置不可用", 503);
    if (this.env.MINIAPP_DEV_LOGIN === "1" && !isProduction(this.env)) {
      return { openid: `dev_${code}`, unionid: null };
    }

    const secret = getEnv(this.env, "WECHAT_MINIAPP_APP_SECRET");
    if (!secret) throw authError("AUTH_CONFIG_INVALID", "登录配置不可用", 503);

    const endpoint = new URL(getEnv(
      this.env,
      "WECHAT_LOGIN_ENDPOINT",
      "https://api.weixin.qq.com/sns/jscode2session",
    ));
    endpoint.searchParams.set("appid", appid);
    endpoint.searchParams.set("secret", secret);
    endpoint.searchParams.set("js_code", code);
    endpoint.searchParams.set("grant_type", "authorization_code");

    let response;
    let payload;
    try {
      response = await this.fetchImpl(endpoint.toString());
      payload = await response.json();
    } catch {
      throw authError("AUTH_REQUIRED", "微信登录失败");
    }

    const validOpenid = typeof payload?.openid === "string" && payload.openid.trim();
    const validSessionKey = typeof payload?.session_key === "string" && payload.session_key.trim();
    const hasAppid = payload && Object.prototype.hasOwnProperty.call(payload, "appid");
    const hasUnionid = payload && Object.prototype.hasOwnProperty.call(payload, "unionid");
    if (!response.ok
      || !payload
      || payload.errcode
      || !validOpenid
      || !validSessionKey
      || (hasAppid && (typeof payload.appid !== "string" || payload.appid !== appid))
      || (hasUnionid && (typeof payload.unionid !== "string" || !payload.unionid.trim()))) {
      throw authError("AUTH_REQUIRED", "微信登录失败");
    }
    return {
      openid: payload.openid.trim(),
      unionid: hasUnionid ? payload.unionid.trim() : null,
    };
  }

  async authenticate(token) {
    const rawToken = String(token || "").trim();
    if (!rawToken) throw authError("AUTH_REQUIRED", "请先登录");

    const session = await this.store.getSessionByTokenHash(hashSessionToken(rawToken));
    if (!session) throw authError("AUTH_REQUIRED", "请先登录");
    const expiresAt = toDate(session.expiresAt);
    if (session.revokedAt || !expiresAt || expiresAt.getTime() <= this.clock().getTime()) {
      throw authError("SESSION_EXPIRED", "登录状态已失效");
    }

    const user = await this.store.getUser(session.userId);
    if (!user) throw authError("AUTH_REQUIRED", "请先登录");
    if (user.status === "disabled") throw authError("ACCOUNT_DISABLED", "账号已停用");

    const touchedSession = await this.touchSession(session.id);
    return {
      session: touchedSession || session,
      user,
      payload: wechatIdentity(user.appid, user.openid, user.unionid),
    };
  }

  async touchSession(sessionId) {
    return this.store.touchSession(sessionId);
  }

  async logout(token) {
    const rawToken = String(token || "").trim();
    if (!rawToken) return null;
    return this.store.revokeSessionByTokenHash(hashSessionToken(rawToken));
  }
}

module.exports = {
  AuthService,
  authError,
};
