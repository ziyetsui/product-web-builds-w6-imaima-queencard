const {
  loadConfig,
  redactConfig,
} = require("../config");

const PRODUCTION_ENVIRONMENTS = new Set(["production", "prod"]);
const PLACEHOLDER_BUILD_SHAS = new Set(["unknown", "replace-with-source-commit-sha"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function valueFor(env, keys, fallback = "") {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function addIssue(issues, key) {
  if (!issues.includes(key)) issues.push(key);
}

function addConfigurationIssues(error, missing, invalid) {
  if (!error || error.code !== "CONFIG_INVALID" || !error.details) return;

  for (const key of Array.isArray(error.details.missing) ? error.details.missing : []) {
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) addIssue(missing, key);
  }
  for (const key of Array.isArray(error.details.invalid) ? error.details.invalid : []) {
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) addIssue(invalid, key);
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function sanitizeUrlCredentials(value) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    return url.username || url.password ? "[REDACTED_SECRET]" : value;
  } catch {
    return value;
  }
}

function sanitizeConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizeConfig);
  if (!value || typeof value !== "object") return sanitizeUrlCredentials(value);

  const result = {};
  for (const [key, childValue] of Object.entries(value)) {
    result[key] = sanitizeConfig(childValue);
  }
  return result;
}

function publicConfig(config) {
  return sanitizeConfig(redactConfig(config.public || config));
}

function serializedResult(result) {
  const sensitiveKey = /secret|password|api-key/i;
  return {
    ok: result.ok,
    missing: result.missing.map((key) => sensitiveKey.test(key) ? "[REDACTED_CONFIG_KEY]" : key),
    invalid: result.invalid.map((key) => sensitiveKey.test(key) ? "[REDACTED_CONFIG_KEY]" : key),
    config: result.config,
  };
}

function validateProductionEnvironment(env = process.env) {
  const missing = [];
  const invalid = [];
  let config;
  let configError;

  try {
    config = loadConfig(env);
  } catch (error) {
    configError = error;
  }

  const environment = valueFor(env, ["NODE_ENV"], "").toLowerCase();
  if (!environment) addIssue(missing, "NODE_ENV");
  else if (!PRODUCTION_ENVIRONMENTS.has(environment)) addIssue(invalid, "NODE_ENV");

  const buildSha = valueFor(env, ["BUILD_SHA", "GIT_SHA", "SOURCE_COMMIT"], "");
  if (!buildSha) addIssue(missing, "BUILD_SHA");
  else if (PLACEHOLDER_BUILD_SHAS.has(buildSha.toLowerCase())) addIssue(invalid, "BUILD_SHA");

  const configuredHost = valueFor(env, ["MINIAPP_BACKEND_HOST", "HOST"], "");
  if (!configuredHost) addIssue(missing, "MINIAPP_BACKEND_HOST");
  else if ((config?.server.host || configuredHost) !== "0.0.0.0") addIssue(invalid, "MINIAPP_BACKEND_HOST");

  const devLoginValue = valueFor(env, ["MINIAPP_DEV_LOGIN"], "0").toLowerCase();
  const devLogin = config?.wechat.devLogin ?? TRUE_VALUES.has(devLoginValue);
  if (devLogin) addIssue(invalid, "MINIAPP_DEV_LOGIN");

  const provider = (config?.generation.provider
    || valueFor(env, ["MINIAPP_IMAGE_PROVIDER", "GENERATION_PROVIDER", "MINIAPP_GENERATION_MODE"], "gptproto"))
    .toLowerCase();
  if (!["gptproto", "openai"].includes(provider)) addIssue(invalid, "MINIAPP_IMAGE_PROVIDER");

  const workerMode = (config?.generation.workerMode
    || valueFor(env, ["GENERATION_WORKER_MODE"], "durable"))
    .toLowerCase();
  if (workerMode !== "durable") addIssue(invalid, "GENERATION_WORKER_MODE");

  const publicAssetBaseUrl = config?.storage.publicBaseUrl
    || valueFor(env, ["MINIAPP_PUBLIC_ASSET_BASE_URL", "STORAGE_PUBLIC_BASE_URL"], "");
  if (!publicAssetBaseUrl) addIssue(missing, "MINIAPP_PUBLIC_ASSET_BASE_URL");
  else if (!isHttpsUrl(publicAssetBaseUrl)) addIssue(invalid, "MINIAPP_PUBLIC_ASSET_BASE_URL");

  const paymentProvider = (config?.payment.provider
    || valueFor(env, ["PAYMENT_PROVIDER"], "disabled"))
    .toLowerCase();
  if (paymentProvider !== "disabled") addIssue(invalid, "PAYMENT_PROVIDER");

  if (provider === "gptproto" && !valueFor(env, ["GPTPROTO_API_KEY"], "")) {
    addIssue(missing, "GPTPROTO_API_KEY");
  }
  if (provider === "openai" && !valueFor(env, ["OPENAI_IMAGE_API_KEY"], "")) {
    addIssue(missing, "OPENAI_IMAGE_API_KEY");
  }

  addConfigurationIssues(configError, missing, invalid);

  const result = {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    config: config ? publicConfig(config) : undefined,
  };
  Object.defineProperty(result, "toJSON", {
    enumerable: false,
    value: () => serializedResult(result),
  });
  return result;
}

module.exports = {
  validateProductionEnvironment,
};
