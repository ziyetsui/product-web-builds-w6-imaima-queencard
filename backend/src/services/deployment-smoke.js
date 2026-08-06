const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ABORT_TIMEOUT_MS = 2_147_483_647;
const PLACEHOLDER_BUILD_SHAS = new Set([
  "unknown",
  "replace-with-source-commit-sha",
  "placeholder",
  "replace-me",
  "todo",
]);

const ENDPOINTS = [
  "/health",
  "/api/miniapp/templates?page=1&limit=1",
  "/api/miniapp/models",
  "/api/miniapp/auth/me",
  "/api/miniapp/pricing",
];

const { REQUIRED_FIELDS: TEMPLATE_REQUIRED_FIELDS } = require("./catalog-service");

const TEMPLATE_STRING_FIELDS = ["id", "title", "author", "category", "prompt", "source", "createdAt", "updatedAt"];
const OPTIONAL_TEMPLATE_STRING_FIELDS = ["subtitle", "scenarioCategory", "sourceId", "sourceUrl", "thumbnailUrl", "previewUrl", "useCase"];
const TEMPLATE_ARRAY_FIELDS = ["tags", "referenceImages", "previewImages"];
const METRIC_NUMBER_FIELDS = ["likes", "saves", "shares"];
const METRIC_STRING_FIELDS = ["likesText", "savesText", "sharesText"];
const OPTIONAL_METRIC_NUMBER_FIELDS = ["followers", "potentialRatio", "likeFollowerRatio", "potentialScore", "potentialRank"];
const OPTIONAL_METRIC_STRING_FIELDS = ["followersText"];
const NONNEGATIVE_METRIC_FIELDS = ["likes", "saves", "shares", "followers"];
const METRIC_BOOLEAN_FIELDS = ["isPotentialHit"];
const METRIC_FIELDS = [
  ...METRIC_NUMBER_FIELDS,
  ...METRIC_STRING_FIELDS,
  ...OPTIONAL_METRIC_NUMBER_FIELDS,
  ...OPTIONAL_METRIC_STRING_FIELDS,
  ...METRIC_BOOLEAN_FIELDS,
];
const METADATA_STRING_FIELDS = ["sourceTitle", "authorUrl", "patternId", "likesText", "savesText", "sharesText"];
const METADATA_FIELDS = [...METADATA_STRING_FIELDS, "suggestedPatternValues"];
const SEED_STRING_FIELDS = ["templateId", "prompt", "sourceCaseId", "sourceCaseCategory", "sourceTitle"];
const SEED_FIELDS = [...SEED_STRING_FIELDS, "referenceImages"];
const PRICING_PRODUCT_STRING_FIELDS = ["id", "type", "title", "currency"];
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PAYMENT_PROFILES = new Set(["payment-disabled", "payment-enabled"]);

function makeCheck(name, ok, status, detail) {
  return { name, ok, status, detail };
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const input = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    if (url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function timeoutFor(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1, Math.floor(value)), MAX_ABORT_TIMEOUT_MS);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value) {
  return hasNonEmptyString(value) && DATE_TIME_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasOnlyKnownFields(value, fields) {
  return Object.keys(value).every((field) => fields.includes(field));
}

function isMetadata(value) {
  if (!isObject(value) || !hasOnlyKnownFields(value, METADATA_FIELDS)) return false;
  if (METADATA_STRING_FIELDS.some((field) => typeof value[field] !== "string")) return false;
  return value.suggestedPatternValues === null || isObject(value.suggestedPatternValues);
}

function isSeed(value) {
  if (!isObject(value) || !hasOnlyKnownFields(value, SEED_FIELDS)) return false;
  if (SEED_STRING_FIELDS.some((field) => typeof value[field] !== "string")) return false;
  return isStringArray(value.referenceImages);
}

function isTemplateRecord(record) {
  if (!isObject(record) || TEMPLATE_REQUIRED_FIELDS.some((field) => !(field in record))) return false;
  if (TEMPLATE_STRING_FIELDS.some((field) => !hasNonEmptyString(record[field]))) return false;
  if (OPTIONAL_TEMPLATE_STRING_FIELDS.some((field) => field in record && typeof record[field] !== "string")) return false;
  if (!isValidDate(record.createdAt) || !isValidDate(record.updatedAt)) return false;
  if (TEMPLATE_ARRAY_FIELDS.some((field) => !isStringArray(record[field]))) return false;

  const metrics = record.metrics;
  if (!isObject(metrics)) return false;
  if (!hasOnlyKnownFields(metrics, METRIC_FIELDS)) return false;
  if (METRIC_NUMBER_FIELDS.some((field) => typeof metrics[field] !== "number" || !Number.isFinite(metrics[field]))) return false;
  if (METRIC_STRING_FIELDS.some((field) => typeof metrics[field] !== "string")) return false;
  if (OPTIONAL_METRIC_NUMBER_FIELDS.some((field) => field in metrics
    && (typeof metrics[field] !== "number" || !Number.isFinite(metrics[field])))) return false;
  if (OPTIONAL_METRIC_STRING_FIELDS.some((field) => field in metrics && typeof metrics[field] !== "string")) return false;
  if (METRIC_BOOLEAN_FIELDS.some((field) => field in metrics && typeof metrics[field] !== "boolean")) return false;
  if (NONNEGATIVE_METRIC_FIELDS.some((field) => field in metrics && metrics[field] < 0)) return false;
  if ("potentialRank" in metrics && metrics.potentialRank < 1) return false;
  if ("metadata" in record && !isMetadata(record.metadata)) return false;
  return !("seed" in record) || isSeed(record.seed);
}

function isPricingProduct(product) {
  if (!isObject(product)) return false;
  if (PRICING_PRODUCT_STRING_FIELDS.some((field) => !hasNonEmptyString(product[field]))) return false;
  if (!Number.isSafeInteger(product.credits) || product.credits < 0) return false;
  if (!Number.isSafeInteger(product.amountCents) || product.amountCents < 0) return false;
  if (product.subtitle !== undefined && typeof product.subtitle !== "string") return false;
  return product.interval === undefined || typeof product.interval === "string";
}

function isTimeoutError(error, signal) {
  return Boolean(signal && signal.aborted)
    || error && ["AbortError", "TimeoutError"].includes(error.name);
}

async function fetchEndpoint({ name, url, fetchImpl, timeoutMs }) {
  const signal = AbortSignal.timeout(timeoutMs);
  let timeoutReject;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutReject = () => {
      const error = new Error("Deployment smoke request timed out");
      error.name = "TimeoutError";
      reject(error);
    };
    if (signal.aborted) timeoutReject();
    else signal.addEventListener("abort", timeoutReject, { once: true });
  });

  try {
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal,
      })),
      timeoutPromise,
    ]);
    const status = Number.isInteger(response && response.status) ? response.status : null;
    if (status !== null && status >= 300 && status < 400) {
      return { response, status, check: makeCheck(name, false, status, "redirect responses are not allowed") };
    }
    return { response, status };
  } catch (error) {
    return {
      response: null,
      status: null,
      check: makeCheck(name, false, null, isTimeoutError(error, signal) ? "request timed out" : "request failed"),
    };
  } finally {
    signal.removeEventListener("abort", timeoutReject);
  }
}

async function readJsonResponse(result, name) {
  if (result.check) return { check: result.check };
  if (result.status === null || result.status < 200 || result.status >= 300) {
    return { check: makeCheck(name, false, result.status, "expected a successful response") };
  }

  const contentType = result.response && result.response.headers && result.response.headers.get("content-type");
  if (!contentType || !/\bjson\b/i.test(contentType)) {
    return { check: makeCheck(name, false, result.status, "expected an application/json response") };
  }

  try {
    return { status: result.status, body: await result.response.json() };
  } catch {
    return { check: makeCheck(name, false, result.status, "response was not valid JSON") };
  }
}

function checkHealth(name, result) {
  const parsed = result.body;
  const data = parsed && parsed.data;
  const buildSha = typeof data?.buildSha === "string" ? data.buildSha.trim() : "";
  const buildReady = Boolean(buildSha) && !PLACEHOLDER_BUILD_SHAS.has(buildSha.toLowerCase());
  const dependenciesReady = ["database", "storage", "workers"].every((key) => data?.dependencies?.[key]?.ready === true);

  if (result.status !== 200) return makeCheck(name, false, result.status, "expected HTTP 200");
  if (parsed?.success !== true || data?.ok !== true) return makeCheck(name, false, result.status, "health payload is not ready");
  if (data.environment !== "production") return makeCheck(name, false, result.status, "health environment is not production");
  if (!buildReady) return makeCheck(name, false, result.status, "build SHA is missing or a placeholder");
  if (!dependenciesReady) return makeCheck(name, false, result.status, "one or more dependencies are not ready");
  return makeCheck(name, true, result.status, "production health is ready");
}

function checkTemplates(name, result) {
  if (!result.body || result.body.success !== true) return makeCheck(name, false, result.status, "template response was not successful");
  const records = result.body.data?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return makeCheck(name, false, result.status, "template catalog is empty");
  }
  if (records.some((record) => !isTemplateRecord(record))) {
    return makeCheck(name, false, result.status, "template catalog contains malformed records");
  }
  return makeCheck(name, true, result.status, "template catalog is non-empty");
}

function checkModels(name, result) {
  const data = result.body && result.body.data;
  const models = Array.isArray(data?.models) ? data.models : [];
  const defaultModel = models.find((model) => model && model.key === "gpt-image-2");
  if (result.body?.success !== true || data?.defaultModel !== "gpt-image-2" || defaultModel?.enabled !== true) {
    return makeCheck(name, false, result.status, "GPT Image 2 is not the enabled default model");
  }
  return makeCheck(name, true, result.status, "GPT Image 2 is the enabled default model");
}

function checkAuth(name, result) {
  if (result.status === 401) return makeCheck(name, true, result.status, "missing bearer token is rejected");
  return makeCheck(name, false, result.status, "missing bearer token did not return HTTP 401");
}

function normalizePaymentProfile(value) {
  const profile = String(value || "payment-disabled").trim().toLowerCase();
  if (profile === "disabled") return "payment-disabled";
  if (profile === "enabled" || profile === "wechat") return "payment-enabled";
  return profile;
}

function checkPricing(name, result, profile) {
  if (result.body?.success !== true) return makeCheck(name, false, result.status, "pricing response was not successful");
  const data = result.body.data;
  const payment = data?.payment;
  if (!isObject(data) || !hasNonEmptyString(data.currency)) {
    return makeCheck(name, false, result.status, "pricing currency is missing");
  }
  if (!Array.isArray(data.packs) || !data.packs.every((product) => isPricingProduct(product))) {
    return makeCheck(name, false, result.status, "pricing packs are missing required fields");
  }
  if (!Array.isArray(data.subscriptions) || !data.subscriptions.every((product) => isPricingProduct(product))) {
    return makeCheck(name, false, result.status, "pricing subscriptions are missing required fields");
  }
  if (!isObject(payment) || !hasNonEmptyString(payment.mode)) {
    return makeCheck(name, false, result.status, "pricing payment contract is incomplete");
  }
  if (profile === "payment-enabled") {
    if (payment.available !== true || payment.mode !== "wechat") {
      return makeCheck(name, false, result.status, "payment-enabled profile requires available WeChat payment");
    }
    return makeCheck(name, true, result.status, "WeChat payment is enabled");
  }
  if (payment.available !== false) return makeCheck(name, false, result.status, "payment must be disabled for this smoke run");
  return makeCheck(name, true, result.status, "payment is disabled");
}

async function runDeploymentSmoke({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs,
  profile,
  paymentProfile,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return {
      ok: false,
      checks: [makeCheck("base-url", false, null, "base URL must be a valid HTTPS URL without credentials")],
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      checks: [makeCheck("base-url", false, null, "fetch implementation is unavailable")],
    };
  }

  const selectedProfile = normalizePaymentProfile(
    profile || paymentProfile || process.env.DEPLOYMENT_SMOKE_PROFILE || "payment-disabled",
  );
  if (!PAYMENT_PROFILES.has(selectedProfile)) {
    return {
      ok: false,
      checks: [makeCheck("profile", false, null, "profile must be payment-disabled or payment-enabled")],
    };
  }

  const timeout = timeoutFor(timeoutMs);
  const checks = [];
  const endpointUrl = (endpoint) => `${normalizedBaseUrl}${endpoint}`;

  const healthResult = await readJsonResponse(
    await fetchEndpoint({ name: "/health", url: endpointUrl(ENDPOINTS[0]), fetchImpl, timeoutMs: timeout }),
    "/health",
  );
  checks.push(healthResult.check || checkHealth("/health", healthResult));

  const templatesResult = await readJsonResponse(
    await fetchEndpoint({ name: "/api/miniapp/templates", url: endpointUrl(ENDPOINTS[1]), fetchImpl, timeoutMs: timeout }),
    "/api/miniapp/templates",
  );
  checks.push(templatesResult.check || checkTemplates("/api/miniapp/templates", templatesResult));

  const modelsResult = await readJsonResponse(
    await fetchEndpoint({ name: "/api/miniapp/models", url: endpointUrl(ENDPOINTS[2]), fetchImpl, timeoutMs: timeout }),
    "/api/miniapp/models",
  );
  checks.push(modelsResult.check || checkModels("/api/miniapp/models", modelsResult));

  const authResult = await fetchEndpoint({
    name: "/api/miniapp/auth/me",
    url: endpointUrl(ENDPOINTS[3]),
    fetchImpl,
    timeoutMs: timeout,
  });
  checks.push(authResult.check || checkAuth("/api/miniapp/auth/me", authResult));

  const pricingResult = await readJsonResponse(
    await fetchEndpoint({ name: "/api/miniapp/pricing", url: endpointUrl(ENDPOINTS[4]), fetchImpl, timeoutMs: timeout }),
    "/api/miniapp/pricing",
  );
  checks.push(pricingResult.check || checkPricing("/api/miniapp/pricing", pricingResult, selectedProfile));

  return { ok: checks.every((check) => check.ok), checks };
}

module.exports = {
  runDeploymentSmoke,
};
