const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
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

function runPreflight(env) {
  return spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "preflight"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
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

test("accepts an OpenAI production provider when its matching key is configured", () => {
  const result = validateProductionEnvironment(productionEnvironment({
    MINIAPP_IMAGE_PROVIDER: "openai",
    GPTPROTO_API_KEY: "",
    OPENAI_IMAGE_API_KEY: "openai-secret",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.config.generation.provider, "openai");
  assert.deepEqual(result.missing, []);
});

test("rejects a non-HTTPS public asset base URL", () => {
  const result = validateProductionEnvironment(productionEnvironment({
    MINIAPP_PUBLIC_ASSET_BASE_URL: "http://miniapp.example",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["MINIAPP_PUBLIC_ASSET_BASE_URL"]);
});

test("rejects unrecognized development-login values", () => {
  for (const value of ["garbage", "2"]) {
    const result = validateProductionEnvironment(productionEnvironment({
      MINIAPP_DEV_LOGIN: value,
    }));

    assert.equal(result.ok, false);
    assert.deepEqual(result.invalid, ["MINIAPP_DEV_LOGIN"]);
  }
});

test("keeps loadConfig public asset alias precedence after an unrelated config error", () => {
  const result = validateProductionEnvironment(productionEnvironment({
    DATABASE_URL: "",
    STORAGE_PUBLIC_BASE_URL: "https://storage.example/assets",
    MINIAPP_PUBLIC_ASSET_BASE_URL: "http://invalid.example/assets",
  }));

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("DATABASE_URL"));
  assert.equal(result.invalid.includes("MINIAPP_PUBLIC_ASSET_BASE_URL"), false);
});

test("redacts credential-bearing query and fragment URL data", () => {
  const result = validateProductionEnvironment(productionEnvironment({
    STORAGE_ENDPOINT: "https://s3.example/?token=super-secret#fragment-secret",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.config.storage.endpoint, "[REDACTED_SECRET]");
  assert.doesNotMatch(JSON.stringify(result), /super-secret|fragment-secret/);
});

test("CLI accepts a complete environment and prints its exact success line", () => {
  const result = runPreflight(productionEnvironment());
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /(^|\n)PREFLIGHT_OK environment=production payment=disabled(\n|$)/);
});

test("CLI rejects invalid values and prints its exact failure line", () => {
  const result = runPreflight(productionEnvironment({
    MINIAPP_DEV_LOGIN: "garbage",
    PAYMENT_PROVIDER: "mock",
  }));
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /(^|\n)PREFLIGHT_FAILED missing=- invalid=MINIAPP_DEV_LOGIN,PAYMENT_PROVIDER(\n|$)/);
});
