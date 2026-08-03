const assert = require("node:assert/strict");
const test = require("node:test");

const { loadConfig } = require("../src/config");

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
    MINIAPP_AUTH_TOKEN_SECRET: "auth-token-secret-that-is-long-enough",
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
    MINIAPP_AUTH_TOKEN_SECRET: "auth-secret-that-must-not-leak",
    WECHAT_MINIAPP_APP_SECRET: "wechat-secret-that-must-not-leak",
  });

  assert.throws(
    () => loadConfig(env),
    (error) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /STORAGE_BUCKET/);
      assert.doesNotMatch(error.message, /storage-secret-that-must-not-leak/);
      assert.doesNotMatch(error.message, /auth-secret-that-must-not-leak/);
      assert.doesNotMatch(error.message, /wechat-secret-that-must-not-leak/);
      assert.doesNotMatch(JSON.stringify(error), /db-password|storage-access-key/);
      return true;
    },
  );
});

test("requires the production database, storage, auth, and WeChat credential groups", () => {
  const env = productionEnv();
  for (const key of [
    "DATABASE_URL",
    "STORAGE_ENDPOINT",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
    "MINIAPP_AUTH_TOKEN_SECRET",
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
  assert.equal(config.auth.tokenSecret, "change-this-dev-secret");
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
  assert.doesNotMatch(JSON.stringify(config.public), /db-password|storage-secret-key|auth-token-secret/);
});
