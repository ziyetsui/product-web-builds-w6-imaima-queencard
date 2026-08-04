const fs = require("node:fs/promises");
const pathModule = require("node:path");
const crypto = require("node:crypto");

const { AuthService } = require("./services/auth-service");
const { serveAsset } = require("./assets");
const { createImageProvider } = require("./providers");
const { createSqliteStore } = require("./store");
const { createLocalStorage } = require("./storage/local-storage");
const { createS3Storage } = require("./storage/s3-storage");
const { createAssetService } = require("./services/asset-service");
const { createCreditService } = require("./services/credit-service");
const { createGenerationService } = require("./services/generation-service");
const { createGenerationWorker } = require("./worker/generation-worker");
const { createModelRegistry } = require("./services/model-registry");
const { createPaymentProvider } = require("./payments");
const orderService = require("./services/order-service");
const { fetchTemplateById, fetchTemplateList } = require("./templates");
const { importCatalog, validateCatalog } = require("./services/catalog-service");

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization, idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function getEnv(env, key, fallback = "") {
  return env[key] || fallback;
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

async function getAuthPayload(request, authService) {
  return (await authService.authenticate(bearerToken(request))).payload;
}

async function getCurrentUser(request, authService) {
  return authService.authenticate(bearerToken(request));
}

function publicAccountUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    provider: user.provider || "wechat",
    name: user.name || "",
    avatarUrl: user.avatarUrl || "",
    balance: Number(user.balance || 0),
    status: user.status || "active",
    role: user.role || "user",
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
  };
}

function envList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function requireAdmin(request, authService, env) {
  const { payload, user } = await getCurrentUser(request, authService);
  const adminOpenids = envList(getEnv(env, "MINIAPP_ADMIN_OPENIDS"));
  const adminUserIds = envList(getEnv(env, "MINIAPP_ADMIN_USER_IDS"));
  if (!adminOpenids.includes(payload.openid) && !adminUserIds.includes(user.id)) {
    const error = new Error("Admin access required");
    error.status = 403;
    throw error;
  }
  return { payload, user };
}

function appOrderId() {
  return `ord_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateCredits(body = {}) {
  return positiveInt(body.outputCount || body.outputNumber, 1);
}

function generationCapability(body = {}, referenceImages = [], referenceAssetIds = []) {
  return body.capability || (Math.max(referenceImages.length, referenceAssetIds.length) > 0 ? "image-edit" : "text-to-image");
}

function validateGenerationBody(body = {}) {
  const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : [];
  const referenceAssetIds = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];
  const capability = generationCapability(body, referenceImages, referenceAssetIds);
  const referenceCount = Math.max(referenceImages.length, referenceAssetIds.length);
  const outputCount = estimateCredits(body);

  if (!["text-to-image", "image-edit", "image-to-image"].includes(capability)) {
    const error = new Error("Unsupported generation capability");
    error.status = 400;
    throw error;
  }

  if (outputCount > 4) {
    const error = new Error("Output count must be between 1 and 4");
    error.status = 400;
    throw error;
  }

  if (capability === "text-to-image" && referenceCount > 0) {
    const error = new Error("Text-to-image generation must not include reference images");
    error.code = "MODEL_REFERENCES_UNSUPPORTED";
    error.status = 400;
    throw error;
  }

  if (capability !== "text-to-image" && (referenceCount < 1 || referenceCount > 3)) {
    const error = new Error("Image reference generation requires 1 to 3 reference images");
    error.status = 400;
    throw error;
  }

  return {
    capability,
    referenceImages,
    referenceAssetIds,
    outputCount,
  };
}

function taskMetadata(template, body = {}) {
  const seed = template && template.seed ? template.seed : {};
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages
    : Array.isArray(template && template.referenceImages)
      ? template.referenceImages
      : [];
  const capability = generationCapability(body, referenceImages);
  return {
    prompt: body.prompt || (template && template.prompt) || "",
    topic: body.topic || (template && template.title) || "",
    referenceImages,
    capability,
    model: body.model || seed.model || "gpt-image-2",
    outputCount: estimateCredits(body),
    aspectRatio: body.aspectRatio || seed.aspectRatio || "",
    resolution: body.resolution || seed.resolution || "",
  };
}

function publicBaseUrl(env, request) {
  const configured = getEnv(env, "MINIAPP_PUBLIC_ASSET_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  const requestUrl = new URL(request.url);
  const forwardedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || requestUrl.host)
    .split(",")[0]
    .trim();
  const forwardedProto = (request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", ""))
    .split(",")[0]
    .trim();
  const isLocalHost = forwardedHost.startsWith("127.0.0.1") || forwardedHost.startsWith("localhost");
  const protocol = !isLocalHost && forwardedProto === "http" ? "https" : forwardedProto;
  return `${protocol}://${forwardedHost}`.replace(/\/$/, "");
}

function publicAssetUrl(value, env, request) {
  if (!value || typeof value !== "string") return value;
  const baseUrl = publicBaseUrl(env, request);
  if (value.startsWith("/")) return `${baseUrl}${value}`;
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const url = new URL(value);
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!isLocal) return value;
    return `${baseUrl}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function publicTemplateAssets(template, env, request) {
  if (!template) return template;
  const referenceImages = Array.isArray(template.referenceImages)
    ? template.referenceImages.map((image) => publicAssetUrl(image, env, request))
    : [];
  const previewImages = Array.isArray(template.previewImages)
    ? template.previewImages.map((image) => publicAssetUrl(image, env, request))
    : [];
  return {
    ...template,
    thumbnailUrl: publicAssetUrl(template.thumbnailUrl, env, request),
    previewUrl: publicAssetUrl(template.previewUrl, env, request),
    referenceImages,
    previewImages,
    seed: template.seed ? {
      ...template.seed,
      referenceImages: Array.isArray(template.seed.referenceImages)
        ? template.seed.referenceImages.map((image) => publicAssetUrl(image, env, request))
        : template.seed.referenceImages,
    } : template.seed,
  };
}

function publicTemplateListAssets(data, env, request) {
  return {
    ...data,
    records: (data.records || []).map((template) => publicTemplateAssets(template, env, request)),
  };
}

function parseEnvJson(env, key, fallback) {
  const value = getEnv(env, key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function pricingProducts(env) {
  const configured = parseEnvJson(env, "MINIAPP_PRICING_JSON", null);
  if (configured && Array.isArray(configured.packs) && Array.isArray(configured.subscriptions)) return configured;
  return {
    currency: "CNY",
    packs: [
      {
        id: "credits_20",
        type: "pack",
        title: "20 次创作包",
        subtitle: "适合轻量体验",
        credits: 20,
        amountCents: 1900,
        currency: "CNY",
        badge: "",
      },
      {
        id: "credits_60",
        type: "pack",
        title: "60 次创作包",
        subtitle: "热门选择",
        credits: 60,
        amountCents: 4900,
        currency: "CNY",
        badge: "hot",
      },
      {
        id: "credits_160",
        type: "pack",
        title: "160 次创作包",
        subtitle: "高频创作者",
        credits: 160,
        amountCents: 9900,
        currency: "CNY",
        badge: "best_value",
      },
    ],
    subscriptions: [
      {
        id: "sub_monthly_200",
        type: "subscription",
        title: "月度 Pro",
        subtitle: "每月 200 次创作额度",
        credits: 200,
        amountCents: 12900,
        currency: "CNY",
        interval: "month",
        badge: "pro",
      },
    ],
  };
}

function findProduct(env, productId) {
  const pricing = pricingProducts(env);
  return [...pricing.packs, ...pricing.subscriptions].find((product) => product.id === productId) || null;
}

function paymentMode(env) {
  const production = ["production", "prod"].includes(String(getEnv(env, "NODE_ENV")).toLowerCase());
  const provider = String(getEnv(env, "PAYMENT_PROVIDER")).trim().toLowerCase();
  if (provider === "mock") return production ? "disabled" : "mock";
  if (provider === "wechat") return "wechat";
  if (provider) return "disabled";
  if (production) return "disabled";
  return getEnv(env, "MINIAPP_PAYMENT_MODE", env.MINIAPP_DEV_LOGIN === "1" ? "mock" : "manual");
}

function paymentInstructions(order) {
  if (order.paymentMode === "mock") {
    return {
      mode: "mock",
      status: "mock_pending",
      message: "Local testing can complete this order with POST /api/miniapp/orders/:id/mock-pay.",
    };
  }
  return {
    mode: "manual",
    status: "manual_pending",
    message: "Payment is pending manual confirmation.",
  };
}

function templateOptions(env, query, request) {
  const source = getEnv(env, "MINIAPP_TEMPLATE_SOURCE", getEnv(env, "MINIAPP_TEMPLATE_API_BASE_URL") ? "remote" : "github");
  return {
    source,
    baseUrl: source === "remote" ? getEnv(env, "MINIAPP_TEMPLATE_API_BASE_URL") : "",
    githubCasesFile: getEnv(env, "MINIAPP_GITHUB_CASES_FILE"),
    assetBaseUrl: request ? publicBaseUrl(env, request) : getEnv(env, "MINIAPP_PUBLIC_ASSET_BASE_URL"),
    env,
    query,
  };
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const store = options.store || createSqliteStore({
    dbPath: getEnv(env, "MINIAPP_DB_PATH"),
    initialCredits: getEnv(env, "MINIAPP_INITIAL_CREDITS", "10"),
    environment: getEnv(env, "NODE_ENV", "development"),
  });
  const authService = options.authService || new AuthService({
    store,
    env,
    fetchImpl,
    clock: options.clock,
  });
  const paymentProvider = options.paymentProvider || createPaymentProvider({
    env,
    fetch: fetchImpl,
    clock: options.clock,
    nonce: options.paymentNonce,
  });
  const imageProvider = options.imageProvider || createImageProvider({
    env,
    fetch: fetchImpl,
  });
  const modelRegistry = options.modelRegistry || createModelRegistry({ models: options.models });
  const storage = options.storage || (() => {
    const driver = String(getEnv(env, "MINIAPP_STORAGE_PROVIDER", getEnv(env, "STORAGE_PROVIDER", "local"))).toLowerCase();
    if (driver === "s3" || driver === "minio" || driver === "r2") {
      return createS3Storage({
        bucket: getEnv(env, "MINIAPP_STORAGE_BUCKET", getEnv(env, "S3_BUCKET")),
        endpoint: getEnv(env, "MINIAPP_STORAGE_ENDPOINT", getEnv(env, "S3_ENDPOINT")),
        region: getEnv(env, "MINIAPP_STORAGE_REGION", getEnv(env, "S3_REGION", "auto")),
        accessKeyId: getEnv(env, "MINIAPP_STORAGE_ACCESS_KEY_ID", getEnv(env, "S3_ACCESS_KEY_ID")),
        secretAccessKey: getEnv(env, "MINIAPP_STORAGE_SECRET_ACCESS_KEY", getEnv(env, "S3_SECRET_ACCESS_KEY")),
        forcePathStyle: getEnv(env, "MINIAPP_STORAGE_FORCE_PATH_STYLE", "") === "1",
      });
    }
    if (["production", "prod"].includes(String(getEnv(env, "NODE_ENV")).toLowerCase())) {
      if (!getEnv(env, "MINIAPP_ASSET_SIGNING_SECRET")) {
        const unavailable = async () => {
          const error = new Error("Private asset storage is not configured in production");
          error.code = "ASSET_STORAGE_CONFIG_INVALID";
          error.status = 503;
          throw error;
        };
        return { driver: "disabled", put: unavailable, head: unavailable, get: unavailable, getSignedDownloadUrl: unavailable, delete: unavailable };
      }
    }
    return createLocalStorage({
      root: getEnv(env, "MINIAPP_UPLOAD_ROOT", pathModule.resolve(__dirname, "../data/uploads")),
      baseUrl: getEnv(env, "MINIAPP_PUBLIC_ASSET_BASE_URL"),
      signingSecret: getEnv(env, "MINIAPP_ASSET_SIGNING_SECRET", "local-development-only-secret"),
    });
  })();
  const assetService = options.assetService || createAssetService({
    store,
    storage,
    fetch: fetchImpl,
    environment: getEnv(env, "NODE_ENV", "development"),
  });
  const creditService = options.creditService || createCreditService({ store });
  const generationService = options.generationService || createGenerationService({
    store,
    registry: modelRegistry,
    creditService,
    providerName: imageProvider.name,
  });
  const generationWorker = options.worker || createGenerationWorker({
    store,
    provider: imageProvider,
    generation: generationService,
    registry: modelRegistry,
    assetService,
    leaseDurationMs: Number(getEnv(env, "MINIAPP_GENERATION_LEASE_MS", "60000")),
    pollIntervalMs: Number(getEnv(env, "MINIAPP_GENERATION_POLL_MS", "1000")),
    maxAttempts: Number(getEnv(env, "MINIAPP_GENERATION_MAX_ATTEMPTS", "3")),
    backoffBaseMs: Number(getEnv(env, "MINIAPP_GENERATION_BACKOFF_BASE_MS", "1000")),
    backoffCapMs: Number(getEnv(env, "MINIAPP_GENERATION_BACKOFF_CAP_MS", "30000")),
  });
  const remoteTemplateSource = getEnv(env, "MINIAPP_TEMPLATE_SOURCE", "") === "remote"
    || Boolean(getEnv(env, "MINIAPP_TEMPLATE_API_BASE_URL", ""));
  const configuredSnapshot = options.catalogSnapshot === false
    ? null
    : options.catalogSnapshot !== undefined
      ? options.catalogSnapshot
      : remoteTemplateSource ? null : pathModule.resolve(__dirname, "../catalog/catalog.snapshot.json");
  let catalogSnapshotPromise = configuredSnapshot && typeof configuredSnapshot !== "object"
    ? fs.readFile(configuredSnapshot, "utf8").then((contents) => JSON.parse(contents))
    : Promise.resolve(configuredSnapshot);
  let initializationPromise = null;

  async function initializeTemplates(request) {
    if (!store.syncTemplates) return;
    const snapshot = await catalogSnapshotPromise;
    catalogSnapshotPromise = null;
    if (snapshot && store.importCatalogVersion) {
      const active = store.getActiveCatalogVersion ? await store.getActiveCatalogVersion() : null;
      const state = store.getCatalogVersionState
        ? await store.getCatalogVersionState(snapshot.catalogVersion)
        : null;
      const expectedCount = Array.isArray(snapshot.records) ? snapshot.records.length : -1;
      const complete = active
        && active.id === snapshot.catalogVersion
        && active.checksum === snapshot.checksum
        && active.recordCount === expectedCount
        && state
        && state.persistedRecordCount === expectedCount
        && state.persistedChecksum === snapshot.checksum
        && state.complete;
      if (complete) validateCatalog(snapshot);
      else await importCatalog(store, snapshot);
      return;
    }
    const syncQuery = new URLSearchParams({
      page: "1",
      limit: getEnv(env, "MINIAPP_TEMPLATE_SYNC_LIMIT", "10000"),
      category: "image",
      language: "zh",
    });
    const data = await fetchTemplateList({
      ...templateOptions(env, syncQuery, request),
      fetch: fetchImpl,
    });
    await store.syncTemplates(data.records || []);
  }

  function initialize(request) {
    if (!initializationPromise) initializationPromise = initializeTemplates(request);
    return initializationPromise;
  }

  async function ensureTemplatesSynced(request) {
    await initialize(request);
  }

  async function getTemplate(templateId, request) {
    let template;
    if (store.getTemplate) {
      await ensureTemplatesSynced(request);
      template = await store.getTemplate(templateId);
    } else {
      template = await fetchTemplateById({
        id: templateId,
        ...templateOptions(env, new URLSearchParams({ page: "1", limit: "50", category: "image", language: "zh" }), request),
        fetch: fetchImpl,
      });
    }
    return publicTemplateAssets(template, env, request);
  }

  async function createGenerationTask(input) {
    const body = input.body || {};
    const template = input.template || {};
    const templateReferences = Array.isArray(template.referenceImages) && template.referenceImages.length
      ? template.referenceImages
      : template.previewUrl ? [template.previewUrl] : [];
    const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : templateReferences;
    const referenceAssetIds = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];
    const capability = body.capability || (referenceImages.length || referenceAssetIds.length ? "image-edit" : "text-to-image");
    const model = body.model || template.seed?.model || undefined;
    const result = await generationService.submit({
      ownerId: input.user.id,
      idempotencyKey: input.idempotencyKey,
      templateId: template.id || "custom",
      prompt: body.prompt || template.prompt || "",
      topic: body.topic || template.title || "",
      model,
      capability,
      referenceAssetIds,
      referenceImages,
      aspectRatio: body.aspectRatio || template.seed?.aspectRatio || (capability === "text-to-image" ? "1:1" : "3:4"),
      resolution: body.resolution || template.seed?.resolution || "1k",
      outputCount: body.outputCount || body.outputNumber || 1,
      previewUrl: template.previewUrl || template.thumbnailUrl || "",
    });
    setImmediate(() => generationWorker.schedule());
    return result.task;
  }

  function publicTaskError(task) {
    const messages = {
      PROVIDER_TIMEOUT: "生成服务响应超时，请稍后重试。",
      GENERATION_PROVIDER_ERROR: "生成服务暂时不可用，请稍后重试。",
      MODEL_UNAVAILABLE: "当前模型暂不可用，请更换模型后重试。",
      MODEL_OUTPUT_LIMIT_EXCEEDED: "当前模型不支持这个输出数量，请减少张数后重试。",
      MODEL_REFERENCES_UNSUPPORTED: "当前模型不支持参考图，请更换模型或模式。",
      INSUFFICIENT_CREDITS: "生成额度不足，请先充值。",
    };
    const code = String(task?.errorCode || "");
    return messages[code] || (code ? "生成失败，请稍后重试。" : "");
  }

  async function serializeTask(task, request) {
    const rawImages = Array.isArray(task?.images) ? task.images : [];
    const outputItems = rawImages.map((image) => ({
      assetId: typeof image === "string" ? "" : String(image?.assetId || ""),
      url: typeof image === "string" ? image : String(image?.url || ""),
    })).filter((image) => image.assetId || image.url);
    const publicImages = [];
    for (const item of outputItems) {
      let url = item.url;
      if (!url && item.assetId) {
        try {
          url = await assetService.getGeneratedDownloadUrl(task.ownerId, item.assetId, {
            baseUrl: publicBaseUrl(env, request),
            expiresInSeconds: 300,
          });
        } catch {
          url = "";
        }
      }
      item.url = url;
      if (url) publicImages.push(url);
    }
    return {
      id: task.id,
      taskId: task.taskId || task.id,
      status: task.status,
      images: publicImages,
      imageAssets: outputItems.filter((image) => image.assetId).map((image) => ({
        assetId: image.assetId,
        url: image.url,
      })),
      templateId: task.templateId || "",
      provider: task.provider || "",
      mode: task.mode || "",
      prompt: task.prompt || "",
      topic: task.topic || "",
      referenceImages: Array.isArray(task.referenceImages) ? task.referenceImages : [],
      referenceAssetIds: Array.isArray(task.referenceAssetIds) ? task.referenceAssetIds : [],
      model: task.model || "",
      outputCount: Number(task.outputCount || 1),
      aspectRatio: task.aspectRatio || "",
      resolution: task.resolution || "",
      errorCode: task.errorCode || "",
      error: publicTaskError(task),
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null,
      startedAt: task.startedAt || null,
      completedAt: task.completedAt || null,
    };
  }

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return json({ success: true });
    }

    try {
      if (path === "/health") {
        return json({ success: true, data: { ok: true } });
      }

      const assetResponse = await serveAsset(path, env, request);
      if (assetResponse) return assetResponse;

      if (path === "/api/miniapp/auth/wechat-login" && request.method === "POST") {
        const body = await readJson(request);
        const code = String(body.code || "").trim();
        if (!code) return json({ success: false, error: "Missing wx.login code" }, 400);

        const session = await authService.loginWithCode({
          code,
          ipAddress: request.headers.get("x-forwarded-for") || "",
          userAgent: request.headers.get("user-agent") || "",
        });
        return json({ success: true, data: session });
      }

      if (path === "/api/miniapp/auth/me" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        return json({ success: true, data: { user } });
      }

      if (path === "/api/miniapp/auth/logout" && request.method === "POST") {
        await authService.logout(bearerToken(request));
        return json({ success: true, data: null });
      }

      if (path === "/api/miniapp/payments/wechat/notify" && request.method === "POST") {
        if (paymentProvider.mode !== "wechat" || typeof paymentProvider.parseNotification !== "function") {
          return json({ code: "FAIL", message: "Payment notification endpoint is disabled" }, 503);
        }
        const rawBody = await request.text();
        const transaction = paymentProvider.parseNotification({
          headers: Object.fromEntries(request.headers.entries()),
          body: rawBody,
        });
        if (transaction.trade_state !== "SUCCESS") {
          return json({ code: "SUCCESS", message: "非成功交易已忽略" });
        }
        const appId = getEnv(env, "WECHAT_MINIAPP_APP_ID", getEnv(env, "WECHAT_APP_ID"));
        const merchantId = getEnv(env, "WECHAT_PAY_MERCHANT_ID", getEnv(env, "WECHAT_MCHID"));
        if ((transaction.appid && transaction.appid !== appId) || (transaction.mchid && transaction.mchid !== merchantId)) {
          const error = new Error("WeChat payment identity does not match this application");
          error.status = 400;
          error.code = "PAYMENT_NOTIFICATION_IDENTITY_MISMATCH";
          throw error;
        }
        const orderId = String(transaction.out_trade_no || "").trim();
        const transactionId = String(transaction.transaction_id || "").trim();
        if (!orderId || !transactionId) {
          const error = new Error("WeChat payment notification is missing order identity");
          error.status = 400;
          error.code = "PAYMENT_NOTIFICATION_INVALID";
          throw error;
        }
        const order = await store.getOrder(orderId);
        if (!order || order.paymentMode !== "wechat") {
          const error = new Error("WeChat payment order not found");
          error.status = 404;
          error.code = "PAYMENT_ORDER_NOT_FOUND";
          throw error;
        }
        const total = Number(transaction.amount && transaction.amount.total);
        if (!Number.isSafeInteger(total) || total !== Number(order.amountCents)) {
          const error = new Error("WeChat payment amount does not match the order");
          error.status = 400;
          error.code = "PAYMENT_AMOUNT_MISMATCH";
          throw error;
        }
        const fulfillmentKey = `wechat:${transactionId}`;
        const existingFulfillment = store.getPaymentFulfillment
          ? await store.getPaymentFulfillment(fulfillmentKey)
          : null;
        const fulfillment = await store.fulfillPayment({
          fulfillmentKey,
          orderId,
          provider: "wechat",
          eventId: transactionId,
          eventType: "TRANSACTION.SUCCESS",
          providerOrderId: orderId,
          providerTransactionId: transactionId,
          status: "FULFILLED",
          paymentVerified: true,
          paidAt: transaction.success_time || undefined,
          metadata: {
            paymentVerified: true,
            tradeState: transaction.trade_state,
            appid: transaction.appid || "",
            mchid: transaction.mchid || "",
          },
        });
        if (!existingFulfillment) {
          await store.recordPaymentEvent({
            orderId,
            userId: order.userId,
            type: "pay",
            actorId: "wechat-pay",
            message: "WeChat payment completed",
            metadata: { transactionId, amountCents: total },
          });
          await store.recordPaymentEvent({
            orderId,
            userId: order.userId,
            type: "fulfill",
            actorId: "wechat-pay",
            message: "Credits granted",
            metadata: { credits: order.credits },
          });
        }
        return json({ code: "SUCCESS", message: "成功", data: { fulfillmentId: fulfillment && fulfillment.id } });
      }

      if (path === "/api/miniapp/pricing" && request.method === "GET") {
        const mode = paymentMode(env);
        return json({
          success: true,
          data: {
            ...pricingProducts(env),
            payment: {
              mode,
              available: ["mock", "wechat"].includes(mode),
            },
          },
        });
      }

      if (path === "/api/miniapp/models" && request.method === "GET") {
        return json({
          success: true,
          data: {
            defaultModel: modelRegistry.defaultModel().key,
            models: modelRegistry.listPublic(),
          },
        });
      }

      if (path === "/api/miniapp/account/me" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        return json({ success: true, data: { user: publicAccountUser(user) } });
      }

      if (path === "/api/miniapp/account/me" && request.method === "PATCH") {
        const { user } = await getCurrentUser(request, authService);
        const body = await readJson(request);
        const name = String(body.name || body.nickname || "").trim();
        if (!name || name.length > 40) return json({ success: false, error: "Name must be 1 to 40 characters" }, 400);
        return json({ success: true, data: { user: publicAccountUser(await store.updateUserProfile(user.id, { name })) } });
      }

      if (path === "/api/miniapp/credit/balance" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        return json({
          success: true,
          data: {
            balance: user.balance,
            availableCredits: user.balance,
            heldCredits: 0,
            expiringCredits: 0,
            currency: "credits",
          },
        });
      }

      if (path === "/api/miniapp/billing" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const orderParams = new URLSearchParams(url.searchParams);
        const transactionParams = new URLSearchParams(url.searchParams);
        const auditParams = new URLSearchParams(url.searchParams);
        auditParams.set("userId", user.id);
        const [orders, creditTransactions, paymentEvents] = await Promise.all([
          store.listOrders(user.id, orderParams),
          store.listCreditTransactions(user.id, transactionParams),
          store.listPaymentAudit(auditParams),
        ]);
        return json({
          success: true,
          data: {
            user: publicAccountUser(user),
            balance: user.balance,
            currency: "credits",
            orders: orderService.serializeOrderPage(orders),
            creditTransactions: orderService.serializeCreditPage(creditTransactions),
            paymentEvents: orderService.serializePaymentPage(paymentEvents),
          },
        });
      }

      if (path === "/api/miniapp/orders" && request.method === "POST") {
        const { payload, user } = await getCurrentUser(request, authService);
        const body = await readJson(request);
        const productId = String(body.productId || "").trim();
        const product = findProduct(env, productId);
        if (!product) return json({ success: false, error: "Unknown productId" }, 400);
        const channel = String(body.channel || "wechat").trim() || "wechat";
        const idempotencyKey = String(
          request.headers.get("idempotency-key") || body.idempotencyKey || body.orderId || "",
        ).trim() || undefined;
        const draft = {
          id: appOrderId(),
          userId: user.id,
          idempotencyKey,
          productId: product.id,
          channel,
          status: "pending",
          amountCents: product.amountCents,
          currency: product.currency || "CNY",
          credits: product.credits,
          productSnapshot: orderService.cloneProduct(product),
        };
        if (idempotencyKey && store.getOrderByIdempotencyKey) {
          const existing = await store.getOrderByIdempotencyKey(user.id, idempotencyKey);
          if (existing) {
            if (existing.productId !== product.id || existing.channel !== channel || Number(existing.amountCents) !== Number(product.amountCents)) {
              const error = new Error("Order idempotency conflict");
              error.status = 409;
              throw error;
            }
            return json({
              success: true,
              data: {
                order: orderService.serializeOrder(existing),
                paymentParams: existing.paymentParams || null,
                payment: existing.paymentParams
                  ? { mode: existing.paymentMode, status: existing.paymentStatus }
                  : paymentInstructions(existing),
              },
            });
          }
        }
        const payment = await paymentProvider.createPayment({
          order: draft,
          product,
          openid: payload.openid,
        });
        const order = await store.createOrder({
          ...draft,
          paymentStatus: payment.paymentStatus,
          paymentMode: payment.paymentMode,
          paymentParams: payment.paymentParams,
          metadata: payment.providerOrderId ? { paymentProviderOrderId: payment.providerOrderId } : {},
        });
        if (order.created !== false) {
          await store.recordPaymentEvent({
            orderId: order.id,
            userId: user.id,
            type: "create",
            actorId: user.id,
            message: "Order created",
            metadata: { productId: product.id, channel },
          });
        }
        return json({
          success: true,
          data: {
            order: orderService.serializeOrder(order),
            paymentParams: order.paymentParams || null,
            payment: order.paymentParams ? { mode: order.paymentMode, status: order.paymentStatus } : paymentInstructions(order),
          },
        }, order.created === false ? 200 : 201);
      }

      if (path === "/api/miniapp/orders" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const data = await store.listOrders(user.id, url.searchParams);
        return json({ success: true, data: orderService.serializeOrderPage(data) });
      }

      const mockPayMatch = path.match(/^\/api\/miniapp\/orders\/([^/]+)\/mock-pay$/);
      if (mockPayMatch && request.method === "POST") {
        const { user } = await getCurrentUser(request, authService);
        const order = await store.getOrder(decodeURIComponent(mockPayMatch[1]));
        if (!order || order.userId !== user.id) return json({ success: false, error: "Order not found" }, 404);
        const production = ["production", "prod"].includes(String(getEnv(env, "NODE_ENV")).toLowerCase());
        if (production || paymentMode(env) !== "mock" || order.paymentMode !== "mock") {
          return json({ success: false, error: "Mock payment is disabled" }, 403);
        }
        const mockIdentity = `mock:${order.id}`;
        const result = await store.fulfillMockOrder(order.id, {
          fulfillmentKey: mockIdentity,
          provider: "mock",
          paymentMode: "mock",
          eventId: mockIdentity,
          providerTransactionId: mockIdentity,
          status: "FULFILLED",
          paymentVerified: true,
          paidAt: new Date().toISOString(),
          reason: `order:${order.id}`,
        });
        if (result && result.fulfilled) {
          await store.recordPaymentEvent({
            orderId: order.id,
            userId: user.id,
            type: "pay",
            actorId: user.id,
            message: "Mock payment completed",
            metadata: { mode: "mock" },
          });
          await store.recordPaymentEvent({
            orderId: order.id,
            userId: user.id,
            type: "fulfill",
            actorId: user.id,
            message: "Credits granted",
            metadata: { credits: result.order.creditsGranted },
          });
        }
        return json({ success: true, data: { order: orderService.serializeOrder(result ? result.order : await store.getOrder(order.id)), idempotent: !(result && result.fulfilled) } });
      }

      const orderMatch = path.match(/^\/api\/miniapp\/orders\/([^/]+)$/);
      if (orderMatch && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const order = await store.getOrder(decodeURIComponent(orderMatch[1]));
        if (!order || order.userId !== user.id) return json({ success: false, error: "Order not found" }, 404);
        return json({ success: true, data: { order: orderService.serializeOrder(order) } });
      }

      if (path === "/api/miniapp/admin/payment-audit" && request.method === "GET") {
        await requireAdmin(request, authService, env);
        return json({ success: true, data: await store.listPaymentAudit(url.searchParams) });
      }

      if (path === "/api/miniapp/admin/users" && request.method === "GET") {
        await requireAdmin(request, authService, env);
        return json({ success: true, data: await store.listUsers(url.searchParams) });
      }

      if (path === "/api/miniapp/admin/credits/add" && request.method === "POST") {
        const admin = await requireAdmin(request, authService, env);
        const body = await readJson(request);
        const userId = String(body.userId || body.targetUserId || "").trim();
        const amount = Number.parseInt(body.amount, 10);
        if (!userId) return json({ success: false, error: "Missing userId" }, 400);
        if (!Number.isFinite(amount) || amount <= 0) return json({ success: false, error: "Amount must be a positive integer" }, 400);
        const user = await store.addCredits(userId, amount, body.reason || `admin:${admin.user.id}`);
        return json({ success: true, data: { user } });
      }

      const adminUserCreditsMatch = path.match(/^\/api\/miniapp\/admin\/users\/([^/]+)\/credits$/);
      if (adminUserCreditsMatch && request.method === "POST") {
        const admin = await requireAdmin(request, authService, env);
        const userId = decodeURIComponent(adminUserCreditsMatch[1]);
        const body = await readJson(request);
        const amount = Number.parseInt(body.amount, 10);
        if (!Number.isFinite(amount) || amount <= 0) return json({ success: false, error: "Amount must be a positive integer" }, 400);
        const user = await store.addCredits(userId, amount, body.reason || `admin:${admin.user.id}`);
        return json({ success: true, data: { user } });
      }

      const adminUserMatch = path.match(/^\/api\/miniapp\/admin\/users\/([^/]+)$/);
      if (adminUserMatch && request.method === "GET") {
        await requireAdmin(request, authService, env);
        const userId = decodeURIComponent(adminUserMatch[1]);
        const user = await store.getUser(userId);
        if (!user) return json({ success: false, error: "User not found" }, 404);
        const [orders, creditTransactions] = await Promise.all([
          store.listOrders(user.id, new URLSearchParams({ page: "1", limit: "20" })),
          store.listCreditTransactions(user.id, new URLSearchParams({ page: "1", limit: "20" })),
        ]);
        return json({
          success: true,
          data: {
            user,
            orders,
            creditTransactions,
          },
        });
      }

      if (path === "/api/miniapp/admin/orders" && request.method === "GET") {
        await requireAdmin(request, authService, env);
        return json({ success: true, data: await store.listAllOrders(url.searchParams) });
      }

      const adminOrderActionMatch = path.match(/^\/api\/miniapp\/admin\/orders\/([^/]+)\/(refund|cancel)$/);
      if (adminOrderActionMatch && request.method === "POST") {
        const admin = await requireAdmin(request, authService, env);
        const orderId = decodeURIComponent(adminOrderActionMatch[1]);
        const action = adminOrderActionMatch[2];
        const body = await readJson(request);
        const reason = body.reason || `admin:${action}`;
        const currentOrder = action === "refund" ? await store.getOrder(orderId) : null;
        if (action === "refund" && currentOrder && currentOrder.paymentMode === "wechat" && !currentOrder.refundedAt) {
          if (paymentProvider.mode !== "wechat" || typeof paymentProvider.refund !== "function") {
            const error = new Error("WeChat refund provider is not configured");
            error.status = 503;
            error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
            throw error;
          }
          await paymentProvider.refund({
            order: currentOrder,
            providerTransactionId: currentOrder.externalPaymentId,
            refundAmountCents: currentOrder.amountCents,
            reason,
          });
        }
        const result = action === "refund"
          ? await store.refundOrder(orderId, { reason, revokeCredits: body.revokeCredits !== false })
          : await store.cancelOrder(orderId, { reason });
        if (!result) return json({ success: false, error: "Order not found" }, 404);
        if ((action === "refund" && result.refunded) || (action === "cancel" && result.canceled)) {
          await store.recordPaymentEvent({
            orderId,
            userId: result.order.userId,
            type: action === "refund" ? "refund" : "fail",
            actorId: admin.user.id,
            message: reason,
            metadata: action === "refund" ? { revokedCredits: result.revokedCredits } : { action: "cancel" },
          });
        }
        return json({ success: true, data: result });
      }

      if (path === "/api/miniapp/uploads/reference-image" && request.method === "POST") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          const error = new Error("Missing upload file");
          error.status = 400;
          throw error;
        }
        const asset = await assetService.createReferenceAsset({
          userId: user.id,
          body: Buffer.from(await file.arrayBuffer()),
          contentType: file.type,
          filename: file.name,
        });
        const url = await assetService.getDownloadUrl(user.id, asset.id, {
          baseUrl: publicBaseUrl(env, request),
          expiresInSeconds: 300,
        });
        return json({
          success: true,
          data: {
            assetId: asset.id,
            url,
            fileName: file.name || asset.id,
            size: asset.sizeBytes,
            contentType: asset.mimeType,
            width: asset.width,
            height: asset.height,
          },
        });
      }

      if (path === "/api/miniapp/templates" && request.method === "GET") {
        let data;
        if (store.listTemplates) {
          await ensureTemplatesSynced(request);
          data = await store.listTemplates(url.searchParams);
        } else {
          data = await fetchTemplateList({
            ...templateOptions(env, url.searchParams, request),
            fetch: fetchImpl,
          });
        }
        data = publicTemplateListAssets(data, env, request);
        return json({
          success: true,
          data: {
            catalogVersion: data.catalogVersion || (store.getActiveCatalogVersion ? (await store.getActiveCatalogVersion())?.id : ""),
            records: data.records,
            categories: data.categories || [],
            specialFilters: data.specialFilters || [],
            pagination: data.pagination,
          },
        });
      }

      const templateDetailMatch = path.match(/^\/api\/miniapp\/templates\/([^/]+)$/);
      if (templateDetailMatch && request.method === "GET") {
        const template = await getTemplate(decodeURIComponent(templateDetailMatch[1]), request);
        if (!template) return json({ success: false, error: "Template not found" }, 404);
        return json({ success: true, data: template });
      }

      const generateMatch = path.match(/^\/api\/miniapp\/templates\/([^/]+)\/generate$/);
      if (generateMatch && request.method === "POST") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        if (user.balance < 1) return json({ success: false, error: "Insufficient credits" }, 402);
        const body = await readJson(request);
        const templateId = decodeURIComponent(generateMatch[1]);
        const template = await getTemplate(templateId, request);
        if (!template) return json({ success: false, error: "Template not found" }, 404);

        const task = await createGenerationTask({
          user,
          template,
          body,
          reason: `template:${template.id}`,
          idempotencyKey: request.headers.get("idempotency-key") || body.idempotencyKey,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } }, 202);
      }

      if (path === "/api/miniapp/image-generations" && request.method === "GET") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const data = await store.listTasks(user.id, url.searchParams);
        return json({
          success: true,
          data: {
            records: await Promise.all(data.records.map((task) => serializeTask(task, request))),
            pagination: data.pagination,
          },
        });
      }

      if (path === "/api/miniapp/image-generations/estimate" && request.method === "POST") {
        await getAuthPayload(request, authService);
        const body = await readJson(request);
        const validation = validateGenerationBody(body);
        const model = modelRegistry.validate({
          model: body.model,
          capability: validation.capability,
          referenceAssetIds: validation.referenceAssetIds,
          referenceImages: validation.referenceImages,
          aspectRatio: body.aspectRatio || (validation.capability === "text-to-image" ? "1:1" : "3:4"),
          resolution: body.resolution || "1k",
          outputCount: validation.outputCount,
        });
        return json({
          success: true,
          data: {
            requestedCredits: model.requestedCredits,
            model: body.model || model.modelKey,
            capability: validation.capability,
            outputCount: model.outputCount,
          },
        });
      }

      if (path === "/api/miniapp/credit/history" && request.method === "GET") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const data = await store.listCreditTransactions(user.id, url.searchParams);
        return json({
          success: true,
          data: {
            records: data.records,
            pagination: data.pagination,
          },
        });
      }

      const imageAssetDownloadMatch = path.match(/^\/api\/miniapp\/image-assets\/([^/]+)\/download$/);
      if (imageAssetDownloadMatch && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const assetId = decodeURIComponent(imageAssetDownloadMatch[1]);
        const location = await assetService.getGeneratedDownloadUrl(user.id, assetId, {
          baseUrl: publicBaseUrl(env, request),
          expiresInSeconds: 300,
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: location,
            "Cache-Control": "private, max-age=60",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type, authorization",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
          },
        });
      }

      if (path === "/api/miniapp/image-generations" && request.method === "POST") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const body = await readJson(request);
        const validation = validateGenerationBody(body);
        modelRegistry.validate({
          model: body.model,
          capability: validation.capability,
          referenceAssetIds: validation.referenceAssetIds,
          referenceImages: validation.referenceImages,
          aspectRatio: body.aspectRatio || (validation.capability === "text-to-image" ? "1:1" : "3:4"),
          resolution: body.resolution || "1k",
          outputCount: validation.outputCount,
        });
        if (validation.referenceAssetIds.length) {
          await assetService.resolveReferenceUrls(user.id, validation.referenceAssetIds, {
            baseUrl: publicBaseUrl(env, request),
            expiresInSeconds: 300,
          });
        }
        const referenceImages = validation.referenceImages;
        const template = body.templateId ? await getTemplate(String(body.templateId), request) : {
          id: "custom",
          title: body.topic || "自定义生成",
          prompt: body.prompt || "",
          previewUrl: referenceImages[0] || "",
          referenceImages,
          seed: {
            source: body.source || "wechat-miniapp",
            model: body.model || "",
            capability: validation.capability,
            aspectRatio: body.aspectRatio || "",
            resolution: body.resolution || "",
          },
        };
        if (!template) return json({ success: false, error: "Template not found" }, 404);
        if (!body.prompt && !template.prompt) return json({ success: false, error: "Missing prompt" }, 400);
        const task = await createGenerationTask({
          user,
          template,
          body: {
            ...body,
            referenceImages,
            referenceAssetIds: validation.referenceAssetIds,
          },
          reason: body.templateId ? `template:${template.id}` : "custom:generation",
          idempotencyKey: request.headers.get("idempotency-key") || body.idempotencyKey,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } }, 202);
      }

      const regenerateMatch = path.match(/^\/api\/miniapp\/image-generations\/([^/]+)\/regenerate$/);
      if (regenerateMatch && request.method === "POST") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const original = await store.getTask(decodeURIComponent(regenerateMatch[1]));
        if (!original || original.ownerId !== user.id) {
          return json({ success: false, error: "Task not found" }, 404);
        }
        await readJson(request);
        const referenceImages = Array.isArray(original.referenceImages) ? original.referenceImages : [];
        const generationBody = {
          prompt: original.prompt,
          topic: original.topic,
          referenceImages,
          referenceAssetIds: Array.isArray(original.referenceAssetIds) ? original.referenceAssetIds : [],
          model: original.model,
          outputCount: original.outputCount || 1,
          aspectRatio: original.aspectRatio,
          resolution: original.resolution,
          sourceTaskId: original.id,
        };
        const requestedCredits = estimateCredits(generationBody);
        if (user.balance < requestedCredits) return json({ success: false, error: "Insufficient credits" }, 402);
        const template = {
          id: original.templateId || "custom",
          title: original.topic || "重新生成",
          prompt: original.prompt,
          previewUrl: referenceImages[0] || (Array.isArray(original.images) ? original.images[0] : ""),
          referenceImages,
          seed: {
            model: original.model,
            aspectRatio: original.aspectRatio,
            resolution: original.resolution,
          },
        };
        const task = await createGenerationTask({
          user,
          template,
          body: generationBody,
          reason: `regenerate:${original.id}`,
          idempotencyKey: request.headers.get("idempotency-key") || undefined,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } }, 202);
      }

      const taskMatch = path.match(/^\/api\/miniapp\/image-generations\/([^/]+)$/);
      if (taskMatch && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const task = await store.getTask(decodeURIComponent(taskMatch[1]));
        if (!task || task.ownerId !== user.id) {
          return json({ success: false, error: "Task not found" }, 404);
        }
        const publicTask = await serializeTask(task, request);
        return json({
          success: true,
          data: {
            ...publicTask,
          },
        });
      }

      return json({ success: false, error: "Not found" }, 404);
    } catch (error) {
      const body = {
        success: false,
        error: error.publicMessage || error.message || "Server error",
      };
      if (error.code) body.code = error.code;
      return json(body, error.status || 500);
    }
  }

  return {
    fetch: handle,
    initialize,
    worker: generationWorker,
    modelRegistry,
    assetService,
    close() {
      generationWorker.stop();
      if (store.close) return store.close();
    },
  };
}

module.exports = {
  createApp,
};
