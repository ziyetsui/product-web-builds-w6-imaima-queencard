const fs = require("node:fs/promises");
const pathModule = require("node:path");
const crypto = require("node:crypto");

const { AuthService } = require("./services/auth-service");
const { serveAsset } = require("./assets");
const { createImageProvider } = require("./providers");
const { createSqliteStore } = require("./store");
const { fetchTemplateById, fetchTemplateList } = require("./templates");

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

function taskId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function generationCapability(body = {}, referenceImages = []) {
  return body.capability || (referenceImages.length > 0 ? "image-edit" : "text-to-image");
}

function validateGenerationBody(body = {}) {
  const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : [];
  const capability = generationCapability(body, referenceImages);
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

  if (capability === "text-to-image" && referenceImages.length > 0) {
    const error = new Error("Text-to-image generation must not include reference images");
    error.status = 400;
    throw error;
  }

  if (capability !== "text-to-image" && (referenceImages.length < 1 || referenceImages.length > 3)) {
    const error = new Error("Image reference generation requires 1 to 3 reference images");
    error.status = 400;
    throw error;
  }

  return {
    capability,
    referenceImages,
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
    model: body.model || seed.model || (capability === "text-to-image" ? "gpt-image" : "gpt-image-2-edit"),
    outputCount: estimateCredits(body),
    aspectRatio: body.aspectRatio || seed.aspectRatio || "",
    resolution: body.resolution || seed.resolution || "",
  };
}

function mimeExt(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function uploadId(fileName, mimeType) {
  const ext = pathModule.extname(fileName || "") || mimeExt(mimeType);
  return `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${ext}`;
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
  return {
    ...template,
    thumbnailUrl: publicAssetUrl(template.thumbnailUrl, env, request),
    previewUrl: publicAssetUrl(template.previewUrl, env, request),
    referenceImages,
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

function wxPaymentParams(env, order, product) {
  const configured = parseEnvJson(env, "MINIAPP_WECHAT_PAYMENT_PARAMS_JSON", null);
  if (!configured) return null;
  return {
    ...configured,
    package: configured.package || configured.packageValue || `prepay_id=${order.id}`,
    nonceStr: configured.nonceStr || crypto.randomBytes(12).toString("hex"),
    timeStamp: configured.timeStamp || Math.floor(Date.now() / 1000).toString(),
    productId: product.id,
    orderId: order.id,
  };
}

function paymentCreatePayload(env, order, product) {
  const mode = paymentMode(env);
  if (mode === "wechat") {
    const params = wxPaymentParams(env, order, product);
    if (params) return { paymentStatus: "created", paymentParams: params, paymentMode: "wechat" };
  }
  if (mode === "mock") return { paymentStatus: "mock_pending", paymentParams: null, paymentMode: "mock" };
  return { paymentStatus: "manual_pending", paymentParams: null, paymentMode: "manual" };
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

async function saveReferenceImage(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    const error = new Error("Missing upload file");
    error.status = 400;
    throw error;
  }

  const root = pathModule.resolve(getEnv(env, "MINIAPP_UPLOAD_ROOT", pathModule.resolve(__dirname, "../data/uploads")));
  const dir = pathModule.join(root, "reference");
  const fileName = uploadId(file.name, file.type);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pathModule.join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  return {
    url: `${publicBaseUrl(env, request)}/uploads/reference/${encodeURIComponent(fileName)}`,
    fileName,
    size: file.size || 0,
    contentType: file.type || "application/octet-stream",
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
  const imageProvider = options.imageProvider || createImageProvider({
    env,
    fetch: fetchImpl,
  });
  let templatesSynced = false;

  async function ensureTemplatesSynced(request) {
    if (templatesSynced || !store.syncTemplates) return;
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
    templatesSynced = true;
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

  async function runGenerationTask(input, id) {
    const metadata = taskMetadata(input.template, input.body);
    try {
      const generation = await imageProvider.generate({
        template: input.template,
        prompt: metadata.prompt,
        referenceImages: metadata.referenceImages,
        outputNumber: metadata.outputCount,
        user: input.user,
        request: input.body,
      });
      await store.createTask({
        id,
        taskId: id,
        ownerId: input.user.id,
        status: generation.status || "completed",
        images: generation.images || [],
        templateId: input.template.id,
        provider: generation.provider || imageProvider.name || "unknown",
        providerTaskId: generation.providerTaskId || "",
        mode: getEnv(env, "MINIAPP_IMAGE_PROVIDER", getEnv(env, "MINIAPP_GENERATION_MODE", "preview")),
        ...metadata,
        rawProviderResult: generation.raw || null,
        createdAt: input.createdAt,
      });
    } catch (error) {
      await store.createTask({
        id,
        taskId: id,
        ownerId: input.user.id,
        status: "failed",
        images: [],
        templateId: input.template.id,
        provider: imageProvider.name || "unknown",
        providerTaskId: "",
        mode: getEnv(env, "MINIAPP_IMAGE_PROVIDER", getEnv(env, "MINIAPP_GENERATION_MODE", "preview")),
        ...metadata,
        rawProviderResult: {
          error: error.message || "Image generation failed",
        },
        createdAt: input.createdAt,
      });
    }
  }

  async function createGenerationTask(input) {
    const metadata = taskMetadata(input.template, input.body);
    const requestedCredits = input.requestedCredits || metadata.outputCount;
    await store.charge(input.user.id, requestedCredits, input.reason);
    const id = taskId();
    const createdAt = new Date().toISOString();
    const task = await store.createTask({
      id,
      taskId: id,
      ownerId: input.user.id,
      status: "pending",
      images: [],
      templateId: input.template.id,
      provider: imageProvider.name || "unknown",
      providerTaskId: "",
      mode: getEnv(env, "MINIAPP_IMAGE_PROVIDER", getEnv(env, "MINIAPP_GENERATION_MODE", "preview")),
      ...metadata,
      rawProviderResult: {
        request: input.body,
      },
      createdAt,
    });
    setTimeout(() => {
      void runGenerationTask({
        ...input,
        createdAt,
      }, id).catch(() => {});
    }, 0);
    return task;
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

      const assetResponse = await serveAsset(path, env);
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

      if (path === "/api/miniapp/pricing" && request.method === "GET") {
        return json({ success: true, data: pricingProducts(env) });
      }

      if (path === "/api/miniapp/account/me" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        return json({ success: true, data: { user } });
      }

      if (path === "/api/miniapp/account/me" && request.method === "PATCH") {
        const { user } = await getCurrentUser(request, authService);
        const body = await readJson(request);
        const name = String(body.name || "").trim();
        if (!name || name.length > 40) return json({ success: false, error: "Name must be 1 to 40 characters" }, 400);
        return json({ success: true, data: { user: await store.updateUserProfile(user.id, { name }) } });
      }

      if (path === "/api/miniapp/credit/balance" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        return json({ success: true, data: { balance: user.balance, currency: "credits" } });
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
            user,
            balance: user.balance,
            currency: "credits",
            orders,
            creditTransactions,
            paymentEvents,
          },
        });
      }

      if (path === "/api/miniapp/orders" && request.method === "POST") {
        const { user } = await getCurrentUser(request, authService);
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
          productSnapshot: product,
        };
        const payment = paymentCreatePayload(env, draft, product);
        const order = await store.createOrder({
          ...draft,
          paymentStatus: payment.paymentStatus,
          paymentMode: payment.paymentMode,
          paymentParams: payment.paymentParams,
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
            order,
            paymentParams: order.paymentParams || null,
            payment: order.paymentParams ? { mode: order.paymentMode, status: order.paymentStatus } : paymentInstructions(order),
          },
        }, order.created === false ? 200 : 201);
      }

      if (path === "/api/miniapp/orders" && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const data = await store.listOrders(user.id, url.searchParams);
        return json({ success: true, data });
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
        return json({ success: true, data: { order: result ? result.order : await store.getOrder(order.id), idempotent: !(result && result.fulfilled) } });
      }

      const orderMatch = path.match(/^\/api\/miniapp\/orders\/([^/]+)$/);
      if (orderMatch && request.method === "GET") {
        const { user } = await getCurrentUser(request, authService);
        const order = await store.getOrder(decodeURIComponent(orderMatch[1]));
        if (!order || order.userId !== user.id) return json({ success: false, error: "Order not found" }, 404);
        return json({ success: true, data: { order } });
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
        await store.ensureUser(payload);
        const upload = await saveReferenceImage(request, env);
        return json({ success: true, data: upload });
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
            records: data.records,
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
          requestedCredits: estimateCredits(body),
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } });
      }

      if (path === "/api/miniapp/image-generations" && request.method === "GET") {
        const payload = await getAuthPayload(request, authService);
        const user = await store.ensureUser(payload);
        const data = await store.listTasks(user.id, url.searchParams);
        return json({
          success: true,
          data: {
            records: data.records,
            pagination: data.pagination,
          },
        });
      }

      if (path === "/api/miniapp/image-generations/estimate" && request.method === "POST") {
        await getAuthPayload(request, authService);
        const body = await readJson(request);
        const validation = validateGenerationBody(body);
        const outputCount = estimateCredits(body);
        return json({
          success: true,
          data: {
            requestedCredits: outputCount,
            model: body.model || (validation.capability === "text-to-image" ? "gpt-image" : "gpt-image-2-edit"),
            capability: validation.capability,
            outputCount,
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
        const asset = await store.findOwnedImageAsset(user.id, assetId);
        if (!asset) return json({ success: false, error: "Image asset not found" }, 404);
        return new Response(null, {
          status: 302,
          headers: {
            Location: asset.url,
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
        const requestedCredits = estimateCredits(body);
        if (user.balance < requestedCredits) return json({ success: false, error: "Insufficient credits" }, 402);
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
          },
          reason: body.templateId ? `template:${template.id}` : "custom:generation",
          requestedCredits,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } });
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
          requestedCredits,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } });
      }

      const taskMatch = path.match(/^\/api\/miniapp\/image-generations\/([^/]+)$/);
      if (taskMatch && request.method === "GET") {
        const payload = await getAuthPayload(request, authService);
        const task = await store.getTask(decodeURIComponent(taskMatch[1]));
        if (!task || task.ownerId !== payload.sub) {
          return json({ success: false, error: "Task not found" }, 404);
        }
        return json({
          success: true,
          data: {
            ...task,
            error: task.rawProviderResult && task.rawProviderResult.error ? task.rawProviderResult.error : "",
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
    close() {
      if (store.close) return store.close();
    },
  };
}

module.exports = {
  createApp,
};
