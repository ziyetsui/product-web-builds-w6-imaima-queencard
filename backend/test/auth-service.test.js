const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AuthService } = require("../src/services/auth-service");
const { createMemoryStore, createSqliteStore } = require("../src/store");

function clockAt(value) {
  let now = new Date(value);
  return {
    clock: () => new Date(now),
    advance(milliseconds) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createStore() {
  const users = new Map();
  const sessions = new Map();
  return {
    users,
    sessions,
    async ensureUser(identity) {
      const id = identity.sub || `wechat:${identity.appid}:${identity.openid}`;
      const user = users.get(id) || {
        id,
        provider: "wechat",
        appid: identity.appid,
        openid: identity.openid,
        unionid: identity.unionid || null,
        status: "active",
      };
      users.set(id, user);
      return user;
    },
    async getUser(id) {
      return users.get(id) || null;
    },
    async createSession(input) {
      const saved = { ...input, revokedAt: null, lastUsedAt: null };
      sessions.set(saved.id, saved);
      return saved;
    },
    async getSessionByTokenHash(tokenHash) {
      return Array.from(sessions.values()).find((session) => session.tokenHash === tokenHash) || null;
    },
    async touchSession(id) {
      const saved = sessions.get(id);
      saved.lastUsedAt = "touched";
      return saved;
    },
    async revokeSessionByTokenHash(tokenHash) {
      const saved = await this.getSessionByTokenHash(tokenHash);
      if (saved) saved.revokedAt = "revoked";
      return saved;
    },
  };
}

function temporaryDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-auth-")), "miniapp.sqlite");
}

test("login creates an opaque token and persists only its SHA-256 hash", async () => {
  const store = createStore();
  const service = new AuthService({
    store,
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "0",
      WECHAT_MINIAPP_APP_ID: "wx-app",
      WECHAT_MINIAPP_APP_SECRET: "secret",
    },
    fetchImpl: async () => response({ appid: "wx-app", openid: "openid-1", unionid: "unionid-1", session_key: "do-not-store" }),
  });

  const result = await service.loginWithCode({ code: "wx-code" });
  const saved = Array.from(store.sessions.values())[0];

  assert.equal(result.user.id, "wechat:wx-app:openid-1");
  assert.equal(typeof result.token, "string");
  assert.ok(result.token.length >= 40);
  assert.notEqual(saved.tokenHash, result.token);
  assert.equal(saved.tokenHash, crypto.createHash("sha256").update(result.token).digest("hex"));
  assert.equal(JSON.stringify(result).includes("session_key"), false);
  assert.equal(JSON.stringify(saved).includes("do-not-store"), false);
});

test("login rejects a code2Session response for another appid", async () => {
  const service = new AuthService({
    store: createStore(),
    env: {
      NODE_ENV: "test",
      WECHAT_MINIAPP_APP_ID: "wx-app",
      WECHAT_MINIAPP_APP_SECRET: "secret",
    },
    fetchImpl: async () => response({ appid: "wx-other", openid: "openid-1", session_key: "session-key" }),
  });

  await assert.rejects(
    service.loginWithCode({ code: "wx-code" }),
    (error) => error.status === 401 && error.code === "AUTH_REQUIRED",
  );
});

test("login requires strict code2Session identity and session fields", async () => {
  const invalidPayloads = [
    { openid: 123, session_key: "session-key" },
    { openid: { value: "openid-1" }, session_key: "session-key" },
    { openid: " ", session_key: "session-key" },
    { openid: "openid-1" },
    { openid: "openid-1", session_key: 123 },
    { openid: "openid-1", session_key: " " },
    { appid: 123, openid: "openid-1", session_key: "session-key" },
    { appid: " wx-app ", openid: "openid-1", session_key: "session-key" },
    { openid: "openid-1", session_key: "session-key", unionid: 123 },
    { openid: "openid-1", session_key: "session-key", unionid: null },
    { openid: "openid-1", session_key: "session-key", unionid: " " },
  ];

  for (const payload of invalidPayloads) {
    const store = createStore();
    const service = new AuthService({
      store,
      env: {
        NODE_ENV: "test",
        WECHAT_MINIAPP_APP_ID: "wx-app",
        WECHAT_MINIAPP_APP_SECRET: "secret",
      },
      fetchImpl: async () => response(payload),
    });

    await assert.rejects(
      service.loginWithCode({ code: "wx-code" }),
      (error) => error.status === 401 && error.code === "AUTH_REQUIRED",
    );
    assert.equal(store.users.size, 0);
    assert.equal(store.sessions.size, 0);
  }
});

test("login accepts an optional exact appid and optional valid unionid", async () => {
  const payloads = [
    { openid: "openid-without-appid", session_key: "session-key" },
    { appid: "wx-app", openid: "openid-with-unionid", session_key: "session-key", unionid: "unionid-1" },
  ];

  for (const payload of payloads) {
    const service = new AuthService({
      store: createStore(),
      env: {
        NODE_ENV: "test",
        WECHAT_MINIAPP_APP_ID: "wx-app",
        WECHAT_MINIAPP_APP_SECRET: "secret",
      },
      fetchImpl: async () => response(payload),
    });
    const result = await service.loginWithCode({ code: "wx-code" });
    assert.equal(result.user.openid, payload.openid);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "session_key"), false);
  }
});

test("login rejects code2Session upstream errors without leaking upstream payloads", async () => {
  const service = new AuthService({
    store: createStore(),
    env: {
      NODE_ENV: "test",
      WECHAT_MINIAPP_APP_ID: "wx-app",
      WECHAT_MINIAPP_APP_SECRET: "secret",
    },
    fetchImpl: async () => response({ errcode: 40029, errmsg: "invalid code session_key=secret" }),
  });

  await assert.rejects(
    service.loginWithCode({ code: "wx-code" }),
    (error) => error.status === 401
      && error.code === "AUTH_REQUIRED"
      && !String(error.message).includes("session_key"),
  );
});

test("production never accepts development login even when direct app construction enables it", async () => {
  const environments = [
    { NODE_ENV: "production" },
    { NODE_ENV: "  ProD  " },
    { APP_ENV: "production" },
    { APP_ENV: " PROD " },
    { RUNTIME_ENV: "Production " },
    { NODE_ENV: "test", APP_ENV: " production " },
    { APP_ENV: "development", RUNTIME_ENV: "prod" },
  ];

  for (const environment of environments) {
    const service = new AuthService({
      store: createStore(),
      env: {
        ...environment,
        MINIAPP_DEV_LOGIN: "1",
        WECHAT_MINIAPP_APP_ID: "wx-production",
        WECHAT_MINIAPP_APP_SECRET: "secret",
      },
      fetchImpl: async () => response({ openid: "should-not-be-used", session_key: "session-key" }),
    });

    await assert.rejects(
      service.loginWithCode({ code: "dev-code" }),
      (error) => error.status === 503 && error.code === "AUTH_CONFIG_INVALID",
    );
  }
});

test("authenticate touches an active session and logout revokes the current session", async () => {
  const store = createStore();
  const service = new AuthService({
    store,
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", WECHAT_MINIAPP_APP_ID: "wx-app" },
    fetchImpl: async () => response({ openid: "unused" }),
  });
  const loggedIn = await service.loginWithCode({ code: "openid-2" });
  const authenticated = await service.authenticate(loggedIn.token);

  assert.equal(authenticated.user.id, "wechat:wx-app:dev_openid-2");
  assert.equal(Array.from(store.sessions.values())[0].lastUsedAt, "touched");

  await service.logout(loggedIn.token);
  await assert.rejects(
    service.authenticate(loggedIn.token),
    (error) => error.status === 401 && error.code === "SESSION_EXPIRED",
  );
});

test("authenticate returns stable errors for expired and disabled users", async () => {
  const time = clockAt("2026-08-03T00:00:00.000Z");
  const store = createStore();
  const service = new AuthService({
    store,
    clock: time.clock,
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", WECHAT_MINIAPP_APP_ID: "wx-app", MINIAPP_SESSION_TTL_SECONDS: "60" },
    fetchImpl: async () => response({ openid: "openid-1" }),
  });
  const loggedIn = await service.loginWithCode({ code: "wx-code" });
  time.advance(61 * 1000);

  await assert.rejects(
    service.authenticate(loggedIn.token),
    (error) => error.status === 401 && error.code === "SESSION_EXPIRED",
  );

  const fresh = await service.loginWithCode({ code: "wx-code-2" });
  fresh.user.status = "disabled";
  await assert.rejects(
    service.authenticate(fresh.token),
    (error) => error.status === 401 && error.code === "ACCOUNT_DISABLED",
  );
});

for (const adapter of ["memory", "sqlite"]) {
  test(`${adapter} session adapter stores the supplied hash and never a raw token`, () => {
    const store = adapter === "memory"
      ? createMemoryStore({ environment: "test" })
      : createSqliteStore({ environment: "test", dbPath: temporaryDbPath() });
    try {
      const user = store.ensureUser({ sub: `wechat:wx-${adapter}:openid`, appid: `wx-${adapter}`, openid: "openid" });
      const rawToken = "raw-session-token";
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const saved = store.createSession({
        userId: user.id,
        tokenHash,
        expiresAt: "2026-08-04T00:00:00.000Z",
      });

      assert.ok(saved.id);
      assert.equal(store.getSessionByTokenHash(tokenHash).tokenHash, tokenHash);
      assert.equal(JSON.stringify(store.getSession(saved.id)).includes(rawToken), false);
    } finally {
      store.close();
    }
  });

  test(`${adapter} session adapter rejects raw tokens at the createSession boundary`, () => {
    const store = adapter === "memory"
      ? createMemoryStore({ environment: "test" })
      : createSqliteStore({ environment: "test", dbPath: temporaryDbPath() });
    try {
      const user = store.ensureUser({ sub: `wechat:wx-${adapter}:raw`, appid: `wx-${adapter}`, openid: "raw" });
      assert.throws(
        () => store.createSession({
          userId: user.id,
          tokenHash: "raw-opaque-token",
          expiresAt: "2026-08-04T00:00:00.000Z",
        }),
        /64-character SHA-256 hash/,
      );
    } finally {
      store.close();
    }
  });
}
