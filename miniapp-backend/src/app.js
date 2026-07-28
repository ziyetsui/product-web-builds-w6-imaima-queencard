const fs = require("node:fs/promises");
const pathModule = require("node:path");

const { createMiniappToken, verifyMiniappToken } = require("./auth");
const { serveAsset } = require("./assets");
const { createImageProvider } = require("./providers");
const { createSqliteStore } = require("./store");
const { fetchTemplateById, fetchTemplateList } = require("./templates");

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

function getAuthPayload(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Login required");
    error.status = 401;
    throw error;
  }
  return verifyMiniappToken(match[1], {
    secret: getEnv(env, "MINIAPP_AUTH_TOKEN_SECRET"),
  });
}

async function loginWithWechatCode(input) {
  const { code, env, fetchImpl } = input;
  if (env.MINIAPP_DEV_LOGIN === "1") {
    return {
      openid: `dev_${code || "openid"}`,
      unionid: null,
    };
  }

  const appid = getEnv(env, "WECHAT_MINIAPP_APP_ID");
  const secret = getEnv(env, "WECHAT_MINIAPP_APP_SECRET");
  if (!appid || !secret) {
    const error = new Error("Missing WeChat miniapp credentials");
    error.status = 503;
    throw error;
  }

  const params = new URLSearchParams({
    appid,
    secret,
    js_code: code,
    grant_type: "authorization_code",
  });
  const response = await fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok || payload.errcode || !payload.openid) {
    const error = new Error(payload.errmsg || "WeChat code2Session failed");
    error.status = 401;
    throw error;
  }
  return payload;
}

function taskId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  return getEnv(env, "MINIAPP_PUBLIC_ASSET_BASE_URL", new URL(request.url).origin).replace(/\/$/, "");
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
    store.syncTemplates(data.records || []);
    templatesSynced = true;
  }

  async function getTemplate(templateId, request) {
    let template;
    if (store.getTemplate) {
      await ensureTemplatesSynced(request);
      template = store.getTemplate(templateId);
    } else {
      template = await fetchTemplateById({
        id: templateId,
        ...templateOptions(env, new URLSearchParams({ page: "1", limit: "50", category: "image", language: "zh" }), request),
        fetch: fetchImpl,
      });
    }
    return publicTemplateAssets(template, env, request);
  }

  async function generateAndCreateTask(input) {
    const generation = await imageProvider.generate({
      template: input.template,
      prompt: input.body.prompt || input.template.prompt,
      referenceImages: input.body.referenceImages || input.template.referenceImages || [],
      outputNumber: input.body.outputNumber || input.body.outputCount || 1,
      user: input.user,
      request: input.body,
    });
    store.charge(input.user.id, 1, input.reason);
    const id = taskId();
    return store.createTask({
      id,
      taskId: id,
      ownerId: input.user.id,
      status: generation.status || "completed",
      images: generation.images || [],
      templateId: input.template.id,
      provider: generation.provider || imageProvider.name || "unknown",
      providerTaskId: generation.providerTaskId || "",
      mode: getEnv(env, "MINIAPP_IMAGE_PROVIDER", getEnv(env, "MINIAPP_GENERATION_MODE", "preview")),
      rawProviderResult: generation.raw || null,
      createdAt: new Date().toISOString(),
    });
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

        const session = await loginWithWechatCode({ code, env, fetchImpl });
        const appid = getEnv(env, "WECHAT_MINIAPP_APP_ID", "wx-dev");
        const token = createMiniappToken({
          appid,
          openid: session.openid,
          unionid: session.unionid || undefined,
          secret: getEnv(env, "MINIAPP_AUTH_TOKEN_SECRET"),
        });
        const payload = verifyMiniappToken(token, {
          secret: getEnv(env, "MINIAPP_AUTH_TOKEN_SECRET"),
        });
        const user = store.ensureUser(payload);
        return json({ success: true, data: { token, user } });
      }

      if (path === "/api/miniapp/auth/me" && request.method === "GET") {
        const payload = getAuthPayload(request, env);
        const user = store.ensureUser(payload);
        return json({ success: true, data: { user } });
      }

      if (path === "/api/miniapp/auth/logout" && request.method === "POST") {
        return json({ success: true, data: null });
      }

      if (path === "/api/miniapp/credit/balance" && request.method === "GET") {
        const payload = getAuthPayload(request, env);
        const user = store.ensureUser(payload);
        return json({ success: true, data: { balance: user.balance, currency: "credits" } });
      }

      if (path === "/api/miniapp/uploads/reference-image" && request.method === "POST") {
        const payload = getAuthPayload(request, env);
        store.ensureUser(payload);
        const upload = await saveReferenceImage(request, env);
        return json({ success: true, data: upload });
      }

      if (path === "/api/miniapp/templates" && request.method === "GET") {
        let data;
        if (store.listTemplates) {
          await ensureTemplatesSynced(request);
          data = store.listTemplates(url.searchParams);
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
        const payload = getAuthPayload(request, env);
        const user = store.ensureUser(payload);
        if (user.balance < 1) return json({ success: false, error: "Insufficient credits" }, 402);
        const body = await readJson(request);
        const templateId = decodeURIComponent(generateMatch[1]);
        const template = await getTemplate(templateId, request);
        if (!template) return json({ success: false, error: "Template not found" }, 404);

        const task = await generateAndCreateTask({
          user,
          template,
          body,
          reason: `template:${template.id}`,
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } });
      }

      if (path === "/api/miniapp/image-generations" && request.method === "POST") {
        const payload = getAuthPayload(request, env);
        const user = store.ensureUser(payload);
        if (user.balance < 1) return json({ success: false, error: "Insufficient credits" }, 402);
        const body = await readJson(request);
        const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : [];
        const template = body.templateId ? await getTemplate(String(body.templateId), request) : {
          id: "custom",
          title: body.topic || "自定义生成",
          prompt: body.prompt || "",
          previewUrl: referenceImages[0] || "",
          referenceImages,
          seed: {
            source: body.source || "wechat-miniapp",
            model: body.model || "",
            capability: body.capability || "",
            aspectRatio: body.aspectRatio || "",
            resolution: body.resolution || "",
          },
        };
        if (!template) return json({ success: false, error: "Template not found" }, 404);
        if (!body.prompt && !template.prompt) return json({ success: false, error: "Missing prompt" }, 400);
        const task = await generateAndCreateTask({
          user,
          template,
          body: {
            ...body,
            referenceImages,
          },
          reason: body.templateId ? `template:${template.id}` : "custom:generation",
        });
        return json({ success: true, data: { taskId: task.id, status: task.status } });
      }

      const taskMatch = path.match(/^\/api\/miniapp\/image-generations\/([^/]+)$/);
      if (taskMatch && request.method === "GET") {
        const payload = getAuthPayload(request, env);
        const task = store.getTask(decodeURIComponent(taskMatch[1]));
        if (!task || task.ownerId !== payload.sub) {
          return json({ success: false, error: "Task not found" }, 404);
        }
        return json({ success: true, data: task });
      }

      return json({ success: false, error: "Not found" }, 404);
    } catch (error) {
      return json({
        success: false,
        error: error.message || "Server error",
      }, error.status || 500);
    }
  }

  return {
    fetch: handle,
    close() {
      if (store.close) store.close();
    },
  };
}

module.exports = {
  createApp,
};
