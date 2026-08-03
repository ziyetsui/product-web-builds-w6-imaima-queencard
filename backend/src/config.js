const path = require("node:path");

const REDACTED_SECRET = "[REDACTED_SECRET]";

function valueFor(env, keys, fallback = "") {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function numberFor(env, keys, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const rawValue = valueFor(env, keys, "");
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function booleanFor(env, keys, fallback) {
  const value = valueFor(env, keys, "");
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function environmentFor(env) {
  return valueFor(env, ["NODE_ENV", "APP_ENV", "RUNTIME_ENV"], "development").toLowerCase();
}

function isProduction(environment) {
  return environment === "production" || environment === "prod";
}

function requiredValue(env, keys, canonicalKey, missing) {
  const value = valueFor(env, keys, "");
  if (!value) missing.push(canonicalKey);
  return value;
}

function configError(missing, invalid) {
  const issues = [
    ...missing.map((key) => `missing ${key}`),
    ...invalid.map((key) => `invalid ${key}`),
  ];
  const error = new Error(`Invalid runtime configuration: ${issues.join(", ")}`);
  error.name = "ConfigurationError";
  error.code = "CONFIG_INVALID";
  error.details = {
    missing: [...missing],
    invalid: [...invalid],
  };
  error.toJSON = () => ({
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
  });
  return error;
}

function isSecretKey(key) {
  const normalized = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized.includes("secret")
    || normalized.includes("token")
    || normalized.includes("password")
    || normalized.includes("privatekey")
    || normalized.includes("accesskey")
    || normalized.endsWith("apikey")
    || normalized === "apiv3key"
    || normalized === "databaseurl";
}

function redactConfig(value, key = "") {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") {
    return isSecretKey(key) || /^url$/i.test(key)
      ? REDACTED_SECRET
      : value;
  }
  if (Array.isArray(value)) return value.map((entry) => redactConfig(entry, key));

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (isSecretKey(childKey)) {
      result[childKey] = REDACTED_SECRET;
    } else if (/^url$/i.test(childKey) && /database|connection/i.test(key)) {
      result[childKey] = REDACTED_SECRET;
    } else {
      result[childKey] = redactConfig(childValue, childKey);
    }
  }
  return result;
}

function publicConfig(config) {
  return {
    server: {
      environment: config.server.environment,
      host: config.server.host,
      port: config.server.port,
      buildSha: config.server.buildSha,
    },
    database: {
      driver: config.database.driver,
      ssl: config.database.ssl,
    },
    wechat: {
      appId: config.wechat.appId,
      devLogin: config.wechat.devLogin,
    },
    auth: {},
    storage: {
      driver: config.storage.driver,
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      bucket: config.storage.bucket,
      publicBaseUrl: config.storage.publicBaseUrl,
    },
    generation: {
      provider: config.generation.provider,
      workerMode: config.generation.workerMode,
      workerConcurrency: config.generation.workerConcurrency,
    },
    payment: {
      provider: config.payment.provider,
      mode: config.payment.mode,
    },
  };
}

function loadConfig(env = process.env) {
  const environment = environmentFor(env);
  const production = isProduction(environment);
  const missing = [];
  const invalid = [];
  const defaultRoot = path.resolve(__dirname, "../data");

  const appId = production
    ? requiredValue(env, ["WECHAT_MINIAPP_APP_ID", "WECHAT_APP_ID"], "WECHAT_MINIAPP_APP_ID", missing)
    : valueFor(env, ["WECHAT_MINIAPP_APP_ID", "WECHAT_APP_ID"], "wx-dev");
  const appSecret = production
    ? requiredValue(env, ["WECHAT_MINIAPP_APP_SECRET", "WECHAT_APP_SECRET"], "WECHAT_MINIAPP_APP_SECRET", missing)
    : valueFor(env, ["WECHAT_MINIAPP_APP_SECRET", "WECHAT_APP_SECRET"], "");
  const devLogin = booleanFor(env, ["MINIAPP_DEV_LOGIN"], !production);
  if (production && devLogin) invalid.push("MINIAPP_DEV_LOGIN");

  const databaseUrl = valueFor(env, ["DATABASE_URL", "POSTGRES_URL"], "");
  if (production && !databaseUrl) missing.push("DATABASE_URL");
  const databaseDriver = production || databaseUrl ? "postgres" : "sqlite";

  const storageDriver = valueFor(env, ["STORAGE_PROVIDER", "MINIAPP_STORAGE_PROVIDER"], production ? "s3" : "local").toLowerCase();
  const storageEndpoint = production
    ? requiredValue(env, ["STORAGE_ENDPOINT", "S3_ENDPOINT"], "STORAGE_ENDPOINT", missing)
    : valueFor(env, ["STORAGE_ENDPOINT", "S3_ENDPOINT"], "");
  const storageBucket = production
    ? requiredValue(env, ["STORAGE_BUCKET", "S3_BUCKET"], "STORAGE_BUCKET", missing)
    : valueFor(env, ["STORAGE_BUCKET", "S3_BUCKET"], "");
  const storageAccessKeyId = production
    ? requiredValue(env, ["STORAGE_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"], "STORAGE_ACCESS_KEY_ID", missing)
    : valueFor(env, ["STORAGE_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"], "");
  const storageSecretAccessKey = production
    ? requiredValue(env, ["STORAGE_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"], "STORAGE_SECRET_ACCESS_KEY", missing)
    : valueFor(env, ["STORAGE_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"], "");
  if (!["local", "s3", "minio", "r2"].includes(storageDriver)) invalid.push("STORAGE_PROVIDER");

  const legacyPaymentMode = valueFor(env, ["MINIAPP_PAYMENT_MODE"], production ? "manual" : "mock").toLowerCase();
  const paymentProvider = valueFor(
    env,
    ["PAYMENT_PROVIDER"],
    legacyPaymentMode === "mock" || legacyPaymentMode === "wechat"
      ? legacyPaymentMode
      : "disabled",
  ).toLowerCase();
  if (production && legacyPaymentMode === "mock") invalid.push("MINIAPP_PAYMENT_MODE");
  if (production && paymentProvider === "mock") invalid.push("PAYMENT_PROVIDER");
  const paymentMode = paymentProvider === "mock"
    ? "mock"
    : paymentProvider === "wechat" ? "wechat" : "manual";

  const config = {
    server: {
      environment,
      host: valueFor(env, ["MINIAPP_BACKEND_HOST", "HOST"], "127.0.0.1"),
      port: numberFor(env, ["PORT"], 8787, { min: 0 }),
      buildSha: valueFor(env, ["BUILD_SHA", "GIT_SHA", "SOURCE_COMMIT"], "unknown"),
      shutdownTimeoutMs: numberFor(env, ["SHUTDOWN_TIMEOUT_MS"], 10000, { min: 0 }),
      logLevel: valueFor(env, ["LOG_LEVEL"], "info"),
    },
    database: {
      driver: databaseDriver,
      url: databaseUrl,
      ssl: booleanFor(env, ["DATABASE_SSL", "PGSSL"], production),
      sqlitePath: valueFor(env, ["MINIAPP_DB_PATH"], path.join(defaultRoot, "miniapp.sqlite")),
      poolMax: numberFor(env, ["DATABASE_POOL_MAX", "PGPOOL_MAX"], 10, { min: 1 }),
      idleTimeoutMs: numberFor(env, ["DATABASE_IDLE_TIMEOUT_MS"], 30000, { min: 0 }),
      connectionTimeoutMs: numberFor(env, ["DATABASE_CONNECTION_TIMEOUT_MS"], 5000, { min: 0 }),
    },
    wechat: {
      appId,
      appSecret,
      devLogin,
      loginEndpoint: valueFor(env, ["WECHAT_LOGIN_ENDPOINT"], "https://api.weixin.qq.com/sns/jscode2session"),
    },
    auth: {
      tokenTtlSeconds: numberFor(env, ["MINIAPP_AUTH_TOKEN_TTL_SECONDS"], 30 * 24 * 60 * 60, { min: 60 }),
    },
    storage: {
      driver: storageDriver,
      endpoint: storageEndpoint,
      region: valueFor(env, ["STORAGE_REGION", "S3_REGION"], "auto"),
      bucket: storageBucket,
      accessKeyId: storageAccessKeyId,
      secretAccessKey: storageSecretAccessKey,
      publicBaseUrl: valueFor(env, ["STORAGE_PUBLIC_BASE_URL", "MINIAPP_PUBLIC_ASSET_BASE_URL"], ""),
      localRoot: valueFor(env, ["STORAGE_LOCAL_ROOT", "MINIAPP_UPLOAD_ROOT"], path.join(defaultRoot, "uploads")),
      forcePathStyle: booleanFor(env, ["STORAGE_FORCE_PATH_STYLE", "S3_FORCE_PATH_STYLE"], storageDriver === "minio"),
    },
    generation: {
      provider: valueFor(env, ["MINIAPP_IMAGE_PROVIDER", "GENERATION_PROVIDER", "MINIAPP_GENERATION_MODE"], "preview").toLowerCase(),
      upstreamBaseUrl: valueFor(env, ["GENERATION_UPSTREAM_BASE_URL", "ANCHER_GENERATOR_API_BASE_URL"], ""),
      upstreamAuthToken: valueFor(env, ["GENERATION_UPSTREAM_AUTH_TOKEN", "MINIAPP_UPSTREAM_AUTH_TOKEN"], ""),
      workerMode: valueFor(env, ["GENERATION_WORKER_MODE"], production ? "durable" : "in-process").toLowerCase(),
      workerConcurrency: numberFor(env, ["GENERATION_WORKER_CONCURRENCY"], 1, { min: 1 }),
      leaseDurationMs: numberFor(env, ["GENERATION_LEASE_DURATION_MS"], 60000, { min: 1000 }),
      pollIntervalMs: numberFor(env, ["GENERATION_POLL_INTERVAL_MS"], 1000, { min: 0 }),
      maxAttempts: numberFor(env, ["GENERATION_MAX_ATTEMPTS"], 3, { min: 1 }),
    },
    payment: {
      provider: paymentProvider,
      mode: paymentMode,
      merchantId: valueFor(env, ["WECHAT_PAY_MERCHANT_ID", "WECHAT_MCHID"], ""),
      certificateSerial: valueFor(env, ["WECHAT_PAY_CERTIFICATE_SERIAL"], ""),
      apiV3Key: valueFor(env, ["WECHAT_PAY_API_V3_KEY"], ""),
      privateKey: valueFor(env, ["WECHAT_PAY_PRIVATE_KEY"], ""),
      notifyUrl: valueFor(env, ["WECHAT_PAY_NOTIFY_URL"], ""),
    },
  };

  if (missing.length || invalid.length) throw configError(missing, invalid);

  config.public = publicConfig(config);
  Object.defineProperty(config, "toJSON", {
    enumerable: false,
    value: () => config.public,
  });
  return config;
}

function toRuntimeEnv(config, sourceEnv = {}) {
  const runtimeSource = { ...sourceEnv };
  delete runtimeSource.MINIAPP_AUTH_TOKEN_SECRET;
  delete runtimeSource.AUTH_TOKEN_SECRET;
  return {
    ...runtimeSource,
    NODE_ENV: config.server.environment,
    PORT: String(config.server.port),
    MINIAPP_BACKEND_HOST: config.server.host,
    MINIAPP_DEV_LOGIN: config.wechat.devLogin ? "1" : "0",
    WECHAT_MINIAPP_APP_ID: config.wechat.appId,
    WECHAT_MINIAPP_APP_SECRET: config.wechat.appSecret,
    WECHAT_LOGIN_ENDPOINT: config.wechat.loginEndpoint,
    MINIAPP_AUTH_TOKEN_TTL_SECONDS: String(config.auth.tokenTtlSeconds),
    MINIAPP_DB_PATH: config.database.sqlitePath,
    MINIAPP_UPLOAD_ROOT: config.storage.localRoot,
    MINIAPP_PUBLIC_ASSET_BASE_URL: config.storage.publicBaseUrl,
    MINIAPP_IMAGE_PROVIDER: config.generation.provider,
    PAYMENT_PROVIDER: config.payment.provider,
    MINIAPP_PAYMENT_MODE: config.payment.mode,
  };
}

module.exports = {
  REDACTED_SECRET,
  loadConfig,
  redactConfig,
  toRuntimeEnv,
};
