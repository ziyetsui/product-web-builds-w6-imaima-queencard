const assert = require("node:assert/strict");
const test = require("node:test");

const { validateProductionEnvironment } = require("../src/services/production-preflight");

function productionEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    BUILD_SHA: "bb04859",
    MINIAPP_BACKEND_HOST: "0.0.0.0",
    MINIAPP_DEV_LOGIN: "0",
    WECHAT_MINIAPP_APP_ID: "wx-production",
    WECHAT_MINIAPP_APP_SECRET: "wechat-secret",
    DATABASE_URL: "postgres://user:password@db.example/miniapp",
    DATABASE_SSL: "1",
    STORAGE_PROVIDER: "s3",
    STORAGE_ENDPOINT: "https://s3.example",
    STORAGE_BUCKET: "miniapp-assets",
    STORAGE_ACCESS_KEY_ID: "storage-access",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret",
    MINIAPP_ASSET_SIGNING_SECRET: "asset-secret",
    MINIAPP_PUBLIC_ASSET_BASE_URL: "https://miniapp.example",
    MINIAPP_IMAGE_PROVIDER: "gptproto",
    GPTPROTO_API_KEY: "gptproto-secret",
    GENERATION_WORKER_MODE: "durable",
    PAYMENT_PROVIDER: "disabled",
    ...overrides,
  };
}

test("accepts a payment-disabled GPTProto internal-test environment", () => {
  const result = validateProductionEnvironment(productionEnvironment());

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test("rejects development login, mock payment, preview generation, and placeholder SHA", () => {
  const result = validateProductionEnvironment({
    NODE_ENV: "production",
    BUILD_SHA: "replace-with-source-commit-sha",
    MINIAPP_DEV_LOGIN: "1",
    MINIAPP_IMAGE_PROVIDER: "preview",
    PAYMENT_PROVIDER: "mock",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, [
    "BUILD_SHA",
    "MINIAPP_DEV_LOGIN",
    "MINIAPP_IMAGE_PROVIDER",
    "PAYMENT_PROVIDER",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret|password|api-key/i);
});
