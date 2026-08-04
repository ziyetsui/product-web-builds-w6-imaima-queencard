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
const TEMPLATE_ARRAY_FIELDS = ["tags", "referenceImages", "previewImages"];
const METRIC_NUMBER_FIELDS = ["likes", "saves", "shares"];
const METRIC_STRING_FIELDS = ["likesText", "savesText", "sharesText"];
const PRICING_PRODUCT_STRING_FIELDS = ["id", "title", "subtitle", "currency"];

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

function isTemplateRecord(record) {
  if (!isObject(record) || TEMPLATE_REQUIRED_FIELDS.some((field) => !(field in record))) return false;
  if (TEMPLATE_STRING_FIELDS.some((field) => !hasNonEmptyString(record[field]))) return false;
  if (TEMPLATE_ARRAY_FIELDS.some((field) => !Array.isArray(record[field]))) return false;

  const metrics = record.metrics;
  if (!isObject(metrics)) return false;
  if (METRIC_NUMBER_FIELDS.some((field) => typeof metrics[field] !== "number" || !Number.isFinite(metrics[field]))) return false;
  return METRIC_STRING_FIELDS.every((field) => typeof metrics[field] === "string");
}

function isPricingProduct(product, type) {
  if (!isObject(product) || product.type !== type) return false;
  if (PRICING_PRODUCT_STRING_FIELDS.some((field) => !hasNonEmptyString(product[field]))) return false;
  if (typeof product.badge !== "string") return false;
  if (!Number.isSafeInteger(product.credits) || product.credits <= 0) return false;
  if (!Number.isSafeInteger(product.amountCents) || product.amountCents <= 0) return false;
  return type !== "subscription" || hasNonEmptyString(product.interval);
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

function checkPricing(name, result) {
  if (result.body?.success !== true) return makeCheck(name, false, result.status, "pricing response was not successful");
  const data = result.body.data;
  const payment = data?.payment;
  if (!isObject(data) || !hasNonEmptyString(data.currency)) {
    return makeCheck(name, false, result.status, "pricing currency is missing");
  }
  if (!Array.isArray(data.packs) || data.packs.length === 0 || !data.packs.every((product) => isPricingProduct(product, "pack"))) {
    return makeCheck(name, false, result.status, "pricing packs are missing required fields");
  }
  if (!Array.isArray(data.subscriptions) || data.subscriptions.length === 0
    || !data.subscriptions.every((product) => isPricingProduct(product, "subscription"))) {
    return makeCheck(name, false, result.status, "pricing subscriptions are missing required fields");
  }
  if (!isObject(payment) || !hasNonEmptyString(payment.mode)) {
    return makeCheck(name, false, result.status, "pricing payment contract is incomplete");
  }
  if (payment.available !== false) return makeCheck(name, false, result.status, "payment must be disabled for this smoke run");
  return makeCheck(name, true, result.status, "payment is disabled");
}

async function runDeploymentSmoke({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs } = {}) {
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
  checks.push(pricingResult.check || checkPricing("/api/miniapp/pricing", pricingResult));

  return { ok: checks.every((check) => check.ok), checks };
}

module.exports = {
  runDeploymentSmoke,
};
