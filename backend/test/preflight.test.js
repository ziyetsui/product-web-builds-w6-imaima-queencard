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

function paymentEnabledEnvironment(overrides = {}) {
  return productionEnvironment({
    PAYMENT_PROVIDER: "wechat",
    WECHAT_PAY_MERCHANT_ID: "merchant-test",
    WECHAT_PAY_CERTIFICATE_SERIAL: "certificate-serial-test",
    WECHAT_PAY_API_V3_KEY: "12345678901234567890123456789012",
    WECHAT_PAY_PRIVATE_KEY: "private-key-placeholder",
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: "public-key-placeholder",
    WECHAT_PAY_PUBLIC_KEY_ID: "public-key-id-test",
    WECHAT_PAY_NOTIFY_URL: "https://miniapp.example/api/miniapp/payments/wechat/notify",
    WECHAT_PAY_REFUND_NOTIFY_URL: "https://miniapp.example/api/miniapp/payments/wechat/refund-notify",
    ...overrides,
  });
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

test("accepts a complete payment-enabled direct-merchant production environment", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment());

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.config.payment.provider, "wechat");
});

test("rejects invalid direct-merchant payment fields", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_API_V3_KEY: "short",
    WECHAT_PAY_NOTIFY_URL: "http://miniapp.example/notify",
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: "",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["WECHAT_PAY_PLATFORM_PUBLIC_KEY"]);
  assert.deepEqual(result.invalid, ["WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_NOTIFY_URL"]);
});

test("requires a separate public key id for platform public key verification", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_PUBLIC_KEY_ID: "",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["WECHAT_PAY_PUBLIC_KEY_ID"]);
});

test("accepts public key map verification without a single public key id", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_PUBLIC_KEY_ID: "",
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: "",
    WECHAT_PAY_PUBLIC_KEYS: '{"public-key-id-test":"public-key-placeholder"}',
    WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "platform-certificate-serial-test",
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test("accepts explicit platform certificate serial compatibility when public key id is absent", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_PUBLIC_KEY_ID: "",
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: "",
    WECHAT_PAY_PLATFORM_CERTIFICATE: "certificate-placeholder",
    WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "platform-certificate-serial-test",
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test("requires a certificate serial when platform certificate verification material is configured", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_PLATFORM_CERTIFICATE: "certificate-placeholder",
    WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL"]);
});

test("requires a separate HTTPS refund notification URL", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_REFUND_NOTIFY_URL: "http://miniapp.example/refund-notify",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["WECHAT_PAY_REFUND_NOTIFY_URL"]);
});

test("rejects payment and refund notification URLs with the same pathname", () => {
  const result = validateProductionEnvironment(paymentEnabledEnvironment({
    WECHAT_PAY_NOTIFY_URL: "https://miniapp.example/hooks/wechat",
    WECHAT_PAY_REFUND_NOTIFY_URL: "https://refund.example/hooks/wechat",
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, ["WECHAT_PAY_REFUND_NOTIFY_URL"]);
});

test("requires every direct-merchant payment field", () => {
  const fields = [
    "WECHAT_PAY_MERCHANT_ID",
    "WECHAT_PAY_CERTIFICATE_SERIAL",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PRIVATE_KEY",
    "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
    "WECHAT_PAY_NOTIFY_URL",
    "WECHAT_PAY_REFUND_NOTIFY_URL",
  ];

  for (const field of fields) {
    const result = validateProductionEnvironment(paymentEnabledEnvironment({ [field]: "" }));

    assert.equal(result.ok, false, field);
    assert.deepEqual(result.missing, [field], field);
  }
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
