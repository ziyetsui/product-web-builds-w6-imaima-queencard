const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REDACTED_SECRET,
  loadConfig,
  redactConfig,
  toRuntimeEnv,
} = require("../src/config");

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    PORT: "8080",
    MINIAPP_BACKEND_HOST: "0.0.0.0",
    DATABASE_URL: "postgres://db-user:db-password@db.example/miniapp",
    STORAGE_PROVIDER: "s3",
    STORAGE_ENDPOINT: "https://s3.example.com",
    STORAGE_REGION: "auto",
    STORAGE_BUCKET: "miniapp-assets",
    STORAGE_ACCESS_KEY_ID: "storage-access-key",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret-key",
    WECHAT_MINIAPP_APP_ID: "wx-production",
    WECHAT_MINIAPP_APP_SECRET: "wechat-app-secret",
    ...overrides,
  };
}

test("rejects incomplete production configuration without leaking secret values", () => {
  const env = productionEnv({
    DATABASE_URL: "",
    STORAGE_BUCKET: "",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret-that-must-not-leak",
    WECHAT_MINIAPP_APP_SECRET: "wechat-secret-that-must-not-leak",
  });

  assert.throws(
    () => loadConfig(env),
    (error) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /STORAGE_BUCKET/);
      assert.doesNotMatch(error.message, /storage-secret-that-must-not-leak/);
      assert.doesNotMatch(error.message, /wechat-secret-that-must-not-leak/);
      assert.doesNotMatch(JSON.stringify(error), /db-password|storage-access-key/);
      return true;
    },
  );
});

test("requires the production database, storage, and WeChat credential groups", () => {
  const env = productionEnv();
  for (const key of [
    "DATABASE_URL",
    "STORAGE_ENDPOINT",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
    "WECHAT_MINIAPP_APP_ID",
    "WECHAT_MINIAPP_APP_SECRET",
  ]) {
    const incomplete = { ...env, [key]: "" };
    assert.throws(() => loadConfig(incomplete), new RegExp(key));
  }
});

test("keeps non-production defaults usable", () => {
  const config = loadConfig({ NODE_ENV: "test" });

  assert.equal(config.server.environment, "test");
  assert.equal(config.server.port, 8787);
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.database.driver, "sqlite");
  assert.equal(config.storage.driver, "local");
  assert.equal(config.wechat.appId, "wx-dev");
  assert.equal(config.wechat.devLogin, true);
  assert.equal(config.auth.tokenSecret, undefined);
  assert.equal(config.generation.provider, "preview");
  assert.equal(config.payment.provider, "mock");
});

test("returns typed runtime sections and redacted public diagnostics", () => {
  const config = loadConfig(productionEnv({
    BUILD_SHA: "build-123",
    PORT: "9090",
    MINIAPP_DEV_LOGIN: "0",
    GENERATION_WORKER_CONCURRENCY: "3",
    PAYMENT_PROVIDER: "disabled",
  }));

  assert.equal(config.server.port, 9090);
  assert.equal(config.server.buildSha, "build-123");
  assert.equal(config.database.driver, "postgres");
  assert.equal(config.database.url, "postgres://db-user:db-password@db.example/miniapp");
  assert.equal(config.storage.driver, "s3");
  assert.equal(config.storage.bucket, "miniapp-assets");
  assert.equal(config.wechat.devLogin, false);
  assert.equal(config.generation.workerConcurrency, 3);
  assert.equal(config.payment.provider, "disabled");
  assert.equal(config.public.database.url, undefined);
  assert.equal(config.public.storage.secretAccessKey, undefined);
  assert.equal(config.public.auth.tokenSecret, undefined);
  assert.doesNotMatch(JSON.stringify(config.public), /db-password|storage-secret-key/);
});

test("does not require or forward the obsolete auth token secret", () => {
  const config = loadConfig(productionEnv());
  const runtimeEnv = toRuntimeEnv(config, {
    MINIAPP_AUTH_TOKEN_SECRET: "obsolete-secret",
    AUTH_TOKEN_SECRET: "obsolete-alias",
  });

  assert.equal(config.auth.tokenSecret, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(runtimeEnv, "MINIAPP_AUTH_TOKEN_SECRET"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(runtimeEnv, "AUTH_TOKEN_SECRET"), false);
});

test("rejects mock payment in production through either payment variable", () => {
  const cases = [
    {
      PAYMENT_PROVIDER: "disabled",
      MINIAPP_PAYMENT_MODE: "mock",
      expectedKey: "MINIAPP_PAYMENT_MODE",
    },
    {
      PAYMENT_PROVIDER: "mock",
      MINIAPP_PAYMENT_MODE: "manual",
      expectedKey: "PAYMENT_PROVIDER",
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => loadConfig(productionEnv(fixture)),
      (error) => {
        assert.equal(error.code, "CONFIG_INVALID");
        assert.match(error.message, new RegExp(fixture.expectedKey));
        return true;
      },
    );
  }
});

test("preserves legacy manual payment mode outside production", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    MINIAPP_PAYMENT_MODE: "manual",
  });

  assert.equal(config.payment.provider, "disabled");
  assert.equal(config.payment.mode, "manual");
  assert.equal(toRuntimeEnv(config).MINIAPP_PAYMENT_MODE, "manual");
});

test("keeps the existing MINIAPP_IMAGE_PROVIDER authoritative during migration", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    GENERATION_PROVIDER: "preview",
    MINIAPP_IMAGE_PROVIDER: "gptproto",
  });
  const runtimeEnv = toRuntimeEnv(config);

  assert.equal(config.generation.provider, "gptproto");
  assert.equal(runtimeEnv.MINIAPP_IMAGE_PROVIDER, "gptproto");
});

test("redacts every configured secret field including the WeChat Pay API v3 key", () => {
  const redacted = redactConfig({
    database: { url: "postgres://user:password@db.example/miniapp" },
    auth: { tokenSecret: "token-secret" },
    wechat: { appSecret: "wechat-secret" },
    storage: {
      accessKeyId: "access-key",
      secretAccessKey: "secret-access-key",
    },
    generation: { upstreamAuthToken: "upstream-token" },
    payment: {
      apiV3Key: "api-v3-secret",
      privateKey: "private-key",
    },
  });

  assert.equal(redacted.database.url, REDACTED_SECRET);
  assert.equal(redacted.auth.tokenSecret, REDACTED_SECRET);
  assert.equal(redacted.wechat.appSecret, REDACTED_SECRET);
  assert.equal(redacted.storage.accessKeyId, REDACTED_SECRET);
  assert.equal(redacted.storage.secretAccessKey, REDACTED_SECRET);
  assert.equal(redacted.generation.upstreamAuthToken, REDACTED_SECRET);
  assert.equal(redacted.payment.apiV3Key, REDACTED_SECRET);
  assert.equal(redacted.payment.privateKey, REDACTED_SECRET);
});

test("propagates the configured WeChat login endpoint into the app runtime", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    WECHAT_LOGIN_ENDPOINT: "https://wechat-gateway.example/code2session",
  });

  assert.equal(
    toRuntimeEnv(config).WECHAT_LOGIN_ENDPOINT,
    "https://wechat-gateway.example/code2session",
  );
});
