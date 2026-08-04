const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { createApp } = require("../src/app");
const { createMemoryStore, createSqliteStore } = require("../src/store");

async function readJson(response) {
  return response.json();
}

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-app-db-")), "miniapp.sqlite");
}

function validPngBytes() {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 240, g: 220, b: 40, alpha: 1 },
    },
  }).png().toBuffer();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

async function waitForTask(app, taskId, auth, status = "completed") {
  let last = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${taskId}`, {
      headers: { Authorization: auth },
    })));
    if (last.data.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return last;
}

async function login(app) {
  const response = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "dev-code" }),
  })));
  assert.equal(response.success, true);
  return `Bearer ${response.data.token}`;
}

test("uses the configured WeChat login endpoint when dev login is disabled", async () => {
  let requestedUrl = "";
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "0",
      WECHAT_MINIAPP_APP_ID: "wx-real",
      WECHAT_MINIAPP_APP_SECRET: "secret-real",
      WECHAT_LOGIN_ENDPOINT: "https://wechat-gateway.example/code2session",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async (url) => {
      requestedUrl = String(url);
      return Response.json({
        openid: "real-openid-1",
        unionid: "real-unionid-1",
        session_key: "session-key",
      });
    },
  });

  const response = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "wx-code-1" }),
  })));

  assert.equal(response.success, true);
  assert.match(requestedUrl, /^https:\/\/wechat-gateway\.example\/code2session\?/);
  assert.match(requestedUrl, /appid=wx-real/);
  assert.match(requestedUrl, /js_code=wx-code-1/);
  assert.equal(response.data.user.id, "wechat:wx-real:real-openid-1");
  assert.equal(response.data.user.openid, "real-openid-1");
  assert.equal(response.data.user.unionid, "real-unionid-1");
  app.close();
});

test("production payment provider blocks legacy mock-pay without granting credits", async () => {
  const env = {
    NODE_ENV: "production",
    MINIAPP_DEV_LOGIN: "0",
    WECHAT_MINIAPP_APP_ID: "wx-production",
    WECHAT_MINIAPP_APP_SECRET: "production-test-secret",
    MINIAPP_PAYMENT_MODE: "mock",
  };
  const store = createMemoryStore({ initialCredits: 10 });
  const app = createApp({
    env,
    store,
    fetch: async () => Response.json({ openid: "payment-user", session_key: "session-key" }),
  });
  const loginResponse = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "production-test-code" }),
  })));
  const authorization = `Bearer ${loginResponse.data.token}`;

  const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/orders", {
    method: "POST",
    headers: { Authorization: authorization },
    body: JSON.stringify({ productId: "credits_20" }),
  })));
  const payment = await app.fetch(new Request(`http://local/api/miniapp/orders/${created.data.order.id}/mock-pay`, {
    method: "POST",
    headers: { Authorization: authorization },
  }));
  const paymentBody = await readJson(payment);

  assert.equal(payment.status, 403);
  assert.equal(paymentBody.error, "Mock payment is disabled");
  assert.equal(store.getUser("wechat:wx-production:payment-user").balance, 10);
  app.close();
});

for (const adapter of ["memory", "sqlite"]) {
  test(`${adapter} HTTP order retry returns 200 and writes one create audit`, async () => {
    const store = adapter === "memory"
      ? createMemoryStore({ environment: "test", initialCredits: 10 })
      : createSqliteStore({ environment: "test", initialCredits: 10, dbPath: tempDbPath() });
    const app = createApp({
      env: {
        NODE_ENV: "test",
        MINIAPP_DEV_LOGIN: "1",
        MINIAPP_PAYMENT_MODE: "mock",
        WECHAT_MINIAPP_APP_ID: "wx-order-http",
      },
      store,
    });
    try {
      const authorization = await login(app);
      async function createOrder(payload) {
        const response = await app.fetch(new Request("http://local/api/miniapp/orders", {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify(payload),
        }));
        return { response, payload: await readJson(response) };
      }

      const first = await createOrder({ orderId: `${adapter}-http-retry`, productId: "credits_20" });
      const replay = await createOrder({ orderId: `${adapter}-http-retry`, productId: "credits_20" });
      const mismatch = await createOrder({ orderId: `${adapter}-http-retry`, productId: "credits_60" });

      assert.equal(first.response.status, 201);
      assert.equal(replay.response.status, 200);
      assert.equal(replay.payload.data.order.id, first.payload.data.order.id);
      assert.equal(mismatch.response.status, 409);
      const audit = await store.listPaymentAudit(new URLSearchParams({ orderId: first.payload.data.order.id, type: "create" }));
      assert.equal(audit.pagination.total, 1);
    } finally {
      app.close();
    }
  });
}

test("supports standalone login, balance, templates, generation task and result", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_GENERATION_MODE: "preview",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async (url) => {
      assert.match(String(url), /\/api\/templates/);
      return Response.json({
        success: true,
        data: [
          {
            id: "tpl-1",
            category: "image",
            scenario_category: "Social Graphics",
            name: "Queen card template",
            condition_prompt: "Create a queen card",
            work_url: "https://cdn.example.com/template.png",
            request_payload: {
              input: "Create a queen card",
            },
            response_payload: {
              images: [
                {
                  url: "https://cdn.example.com/template.png",
                },
              ],
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 1,
          total: 1,
          totalPages: 1,
        },
      });
    },
  });

  const login = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "dev-code" }),
  })));
  assert.equal(login.success, true);
  assert.equal(login.data.user.provider, "wechat");

  const auth = `Bearer ${login.data.token}`;
  const balance = await readJson(await app.fetch(new Request("http://local/api/miniapp/credit/balance", {
    headers: { Authorization: auth },
  })));
  assert.equal(balance.data.balance, 10);

  const templates = await readJson(await app.fetch(new Request("http://local/api/miniapp/templates?page=1&limit=1")));
  assert.equal(templates.data.records[0].title, "Queen card template");

  const generated = await readJson(await app.fetch(new Request("http://local/api/miniapp/templates/tpl-1/generate", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({}),
  })));
  assert.equal(generated.success, true);
  assert.match(generated.data.taskId, /^task_/);

  const task = await waitForTask(app, generated.data.taskId, auth);
  assert.equal(task.data.status, "completed");
  assert.deepEqual(task.data.images, ["https://cdn.example.com/template.png"]);
  app.close();
});

test("template generation delegates image creation to the configured provider", async () => {
  let providerInput = null;
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    imageProvider: {
      generate: async (input) => {
        providerInput = input;
        return {
          provider: "test-provider",
          status: "completed",
          images: ["https://cdn.example.com/generated.png"],
          raw: { ok: true },
        };
      },
    },
    fetch: async () => Response.json({
      success: true,
      data: [
        {
          id: "tpl-provider",
          category: "image",
          scenario_category: "Social Graphics",
          name: "Provider template",
          condition_prompt: "Generate with provider",
          work_url: "https://cdn.example.com/template.png",
        },
      ],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    }),
  });

  const login = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "dev-code" }),
  })));
  const auth = `Bearer ${login.data.token}`;
  const generated = await readJson(await app.fetch(new Request("http://local/api/miniapp/templates/tpl-provider/generate", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({ prompt: "Override prompt" }),
  })));
  const task = await waitForTask(app, generated.data.taskId, auth);

  assert.equal(providerInput.template.id, "tpl-provider");
  assert.equal(providerInput.prompt, "Override prompt");
  assert.equal(task.data.provider, "test-provider");
  assert.deepEqual(task.data.images, ["https://cdn.example.com/generated.png"]);
  app.close();
});

test("generic generation returns a pending task before slow image creation completes", async () => {
  const generation = deferred();
  let providerStarted = false;
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    imageProvider: {
      name: "slow-provider",
      generate: async () => {
        providerStarted = true;
        return generation.promise;
      },
    },
  });

  const login = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "dev-code" }),
  })));
  const auth = `Bearer ${login.data.token}`;
  const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Generate slowly",
      referenceImages: ["https://cdn.example.com/reference.png"],
      outputCount: 1,
    }),
  })));

  assert.equal(created.success, true);
  assert.equal(created.data.status, "pending");
  assert.equal(providerStarted, false);

  const pendingTask = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${created.data.taskId}`, {
    headers: { Authorization: auth },
  })));
  assert.equal(pendingTask.data.status, "pending");

  generation.resolve({
    provider: "slow-provider",
    status: "completed",
    images: ["https://cdn.example.com/generated.png"],
    raw: { ok: true },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const completedTask = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${created.data.taskId}`, {
    headers: { Authorization: auth },
  })));
  assert.equal(providerStarted, true);
  assert.equal(completedTask.data.status, "completed");
  assert.deepEqual(completedTask.data.images, ["https://cdn.example.com/generated.png"]);
  app.close();
});

test("returns a synced template by id", async () => {
  const app = createApp({
    env: {
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async () => Response.json({
      success: true,
      data: [
        {
          id: "tpl-detail",
          category: "image",
          scenario_category: "Social Graphics",
          name: "Detail template",
          condition_prompt: "Generate detail",
          work_url: "https://cdn.example.com/detail.png",
        },
      ],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    }),
  });

  const detail = await readJson(await app.fetch(new Request("http://local/api/miniapp/templates/tpl-detail")));

  assert.equal(detail.success, true);
  assert.equal(detail.data.id, "tpl-detail");
  assert.equal(detail.data.title, "Detail template");
  app.close();
});

test("rewrites persisted local template assets to the request origin", async () => {
  const app = createApp({
    env: {
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async () => Response.json({
      success: true,
      data: [
        {
          id: "tpl-local-asset",
          category: "image",
          scenario_category: "Social Graphics",
          name: "Local asset template",
          condition_prompt: "Generate with local asset",
          work_url: "http://127.0.0.1:8080/xhs-cases/template.jpg",
        },
      ],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    }),
  });

  const list = await readJson(await app.fetch(new Request("https://mini.example/api/miniapp/templates?page=1&limit=1")));
  const detail = await readJson(await app.fetch(new Request("https://mini.example/api/miniapp/templates/tpl-local-asset")));

  assert.equal(list.data.records[0].thumbnailUrl, "https://mini.example/xhs-cases/template.jpg");
  assert.equal(list.data.records[0].previewUrl, "https://mini.example/xhs-cases/template.jpg");
  assert.deepEqual(list.data.records[0].referenceImages, ["https://mini.example/xhs-cases/template.jpg"]);
  assert.equal(detail.data.thumbnailUrl, "https://mini.example/xhs-cases/template.jpg");
  app.close();
});

test("upgrades public proxied asset origins to https", async () => {
  const app = createApp({
    env: {
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async () => Response.json({
      success: true,
      data: [
        {
          id: "tpl-proxy-origin",
          category: "image",
          name: "Proxy origin template",
          work_url: "http://127.0.0.1:8080/xhs-cases/proxy.jpg",
        },
      ],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    }),
  });

  const response = await readJson(await app.fetch(new Request("http://ima.example/api/miniapp/templates?page=1&limit=1", {
    headers: {
      Host: "ima.example",
    },
  })));

  assert.equal(response.data.records[0].thumbnailUrl, "https://ima.example/xhs-cases/proxy.jpg");
  app.close();
});

test("uploads a reference image and creates a generic generation task", async () => {
  let providerInput = null;
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
      MINIAPP_UPLOAD_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "ima-uploads-")),
      MINIAPP_PUBLIC_ASSET_BASE_URL: "http://local",
    },
    imageProvider: {
      generate: async (input) => {
        providerInput = input;
        return {
          provider: "test-provider",
          status: "completed",
          images: input.referenceImages,
        };
      },
    },
  });

  const login = await readJson(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "dev-code" }),
  })));
  const auth = `Bearer ${login.data.token}`;
  const form = new FormData();
  form.set("file", new Blob([await validPngBytes()], { type: "image/png" }), "reference.png");

  const uploaded = await readJson(await app.fetch(new Request("http://local/api/miniapp/uploads/reference-image", {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  })));
  assert.equal(uploaded.success, true);
  assert.match(uploaded.data.assetId, /^asset_/);
  assert.match(uploaded.data.url, /^http:\/\/local\/uploads\/reference\/.+\.png\?expires=\d+&signature=[A-Za-z0-9_-]+$/);

  const generated = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Generate with uploaded reference",
      referenceAssetIds: [uploaded.data.assetId],
      outputCount: 1,
    }),
  })));
  assert.equal(generated.success, true, JSON.stringify(generated));
  const task = await waitForTask(app, generated.data.taskId, auth);

  assert.equal(providerInput.prompt, "Generate with uploaded reference");
  assert.equal(providerInput.referenceImages.length, 1);
  assert.match(providerInput.referenceImages[0], /^http:\/\/local\/uploads\/reference\/.+\.png\?expires=\d+&signature=/);
  assert.equal(task.data.status, "completed");
  assert.deepEqual(task.data.images, [uploaded.data.url]);
  app.close();
});

test("serves GitHub public image assets for local miniapp templates", async () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-assets-"));
  fs.mkdirSync(path.join(assetRoot, "xhs-cases"), { recursive: true });
  fs.writeFileSync(path.join(assetRoot, "xhs-cases", "case.jpg"), Buffer.from("image-bytes"));
  const app = createApp({
    env: {
      MINIAPP_ASSET_ROOT: assetRoot,
      MINIAPP_DB_PATH: tempDbPath(),
    },
  });

  const response = await app.fetch(new Request("http://local/xhs-cases/case.jpg"));
  const body = Buffer.from(await response.arrayBuffer()).toString("utf8");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(body, "image-bytes");
  app.close();
});

test("serves synced BO landing case assets for local miniapp templates", async () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-assets-"));
  fs.mkdirSync(path.join(assetRoot, "landing", "wechat-covers"), { recursive: true });
  fs.writeFileSync(path.join(assetRoot, "landing", "wechat-covers", "cover.jpg"), Buffer.from("landing-image"));
  const app = createApp({
    env: {
      MINIAPP_ASSET_ROOT: assetRoot,
      MINIAPP_DB_PATH: tempDbPath(),
    },
  });

  const response = await app.fetch(new Request("http://local/landing/wechat-covers/cover.jpg"));
  const body = Buffer.from(await response.arrayBuffer()).toString("utf8");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(body, "landing-image");
  app.close();
});

test("serves miniapp landing assets from backend public assets", async () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-miniapp-assets-"));
  fs.mkdirSync(path.join(assetRoot, "miniapp-assets", "cases"), { recursive: true });
  fs.writeFileSync(path.join(assetRoot, "miniapp-assets", "cases", "proof.jpg"), Buffer.from("miniapp-image"));
  const app = createApp({
    env: {
      MINIAPP_MINIAPP_ASSET_ROOT: assetRoot,
      MINIAPP_DB_PATH: tempDbPath(),
    },
  });

  const response = await app.fetch(new Request("http://local/miniapp-assets/cases/proof.jpg"));
  const body = Buffer.from(await response.arrayBuffer()).toString("utf8");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(body, "miniapp-image");
  app.close();
});

test("lists completed image generations with reusable request metadata", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    imageProvider: {
      name: "test-provider",
      generate: async () => ({
        provider: "test-provider",
        status: "completed",
        images: ["https://cdn.example.com/generated-history.png"],
        raw: { ok: true },
      }),
    },
  });
  const auth = await login(app);

  const created = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Create a royal lemon profile card",
      topic: "Royal lemon",
      referenceImages: ["https://cdn.example.com/reference.png"],
      model: "gpt-image-2-edit",
      outputCount: 2,
      aspectRatio: "1:1",
      resolution: "1k",
    }),
  })));
  const completed = await waitForTask(app, created.data.taskId, auth);
  assert.equal(completed.data.status, "completed");

  const list = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations?page=1&limit=10&status=completed", {
    headers: { Authorization: auth },
  })));

  assert.equal(list.success, true);
  assert.equal(list.data.pagination.total, 1);
  assert.equal(list.data.records[0].taskId, created.data.taskId);
  assert.equal(list.data.records[0].prompt, "Create a royal lemon profile card");
  assert.equal(list.data.records[0].topic, "Royal lemon");
  assert.deepEqual(list.data.records[0].referenceImages, ["https://cdn.example.com/reference.png"]);
  assert.equal(list.data.records[0].model, "gpt-image-2-edit");
  assert.equal(list.data.records[0].outputCount, 2);
  assert.equal(list.data.records[0].aspectRatio, "1:1");
  assert.equal(list.data.records[0].resolution, "1k");
  app.close();
});

test("filters image generation history by prompt, model, and template id", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_TEMPLATE_API_BASE_URL: "https://templates.example",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    fetch: async () => Response.json({
      success: true,
      data: [
        {
          id: "tpl-filter",
          category: "image",
          scenario_category: "Social Graphics",
          name: "Filter template",
          condition_prompt: "Template prompt",
          work_url: "https://cdn.example.com/template.png",
        },
      ],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    }),
  });
  const auth = await login(app);

  const custom = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Searchable rose prompt",
      model: "seedream-5.0",
      outputCount: 1,
    }),
  })));
  const templated = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      templateId: "tpl-filter",
      prompt: "Template override",
      model: "gpt-image-2-edit",
      outputCount: 1,
    }),
  })));
  await waitForTask(app, custom.data.taskId, auth);
  await waitForTask(app, templated.data.taskId, auth);

  const promptMatches = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations?q=rose", {
    headers: { Authorization: auth },
  })));
  const modelMatches = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations?q=seedream-5.0", {
    headers: { Authorization: auth },
  })));
  const templateMatches = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations?q=tpl-filter", {
    headers: { Authorization: auth },
  })));

  assert.deepEqual(promptMatches.data.records.map((task) => task.taskId), [custom.data.taskId]);
  assert.deepEqual(modelMatches.data.records.map((task) => task.taskId), [custom.data.taskId]);
  assert.deepEqual(templateMatches.data.records.map((task) => task.taskId), [templated.data.taskId]);
  app.close();
});

test("estimates requested credits for image generation", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_DB_PATH: tempDbPath(),
    },
  });
  const auth = await login(app);

  const estimate = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations/estimate", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      model: "gpt-image-2-edit",
      outputCount: 3,
    }),
  })));

  assert.equal(estimate.success, true);
  assert.equal(estimate.data.requestedCredits, 3);
  assert.equal(estimate.data.model, "gpt-image-2-edit");
  assert.equal(estimate.data.outputCount, 3);
  app.close();
});

test("validates text and reference image generation modes", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
    },
  });
  const auth = await login(app);

  const textTask = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      capability: "text-to-image",
      prompt: "A clean text-only poster",
      model: "gpt-image",
      outputCount: 1,
    }),
  })));
  assert.equal(textTask.success, true);
  await waitForTask(app, textTask.data.taskId, auth);

  const invalidText = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      capability: "text-to-image",
      prompt: "Should not carry references",
      referenceImages: ["https://cdn.example.com/ref.png"],
    }),
  })));
  assert.equal(invalidText.success, false);
  assert.match(invalidText.error, /must not include reference images/);

  const invalidReference = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      capability: "image-edit",
      prompt: "Missing references",
      referenceImages: [],
    }),
  })));
  assert.equal(invalidReference.success, false);
  assert.match(invalidReference.error, /requires 1 to 3 reference images/);
  app.close();
});

test("regenerates a task from the original prompt, references, and model", async () => {
  const providerInputs = [];
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    imageProvider: {
      name: "test-provider",
      generate: async (input) => {
        providerInputs.push(input);
        return {
          provider: "test-provider",
          status: "completed",
          images: ["https://cdn.example.com/regenerated.png"],
        };
      },
    },
  });
  const auth = await login(app);

  const original = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Regenerate this card",
      topic: "Regeneration topic",
      referenceImages: ["https://cdn.example.com/original-reference.png"],
      model: "gpt-image-2-edit",
      outputCount: 2,
      aspectRatio: "3:4",
      resolution: "1k",
    }),
  })));
  await waitForTask(app, original.data.taskId, auth);

  const regenerated = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${original.data.taskId}/regenerate`, {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({}),
  })));
  assert.equal(regenerated.success, true);
  assert.notEqual(regenerated.data.taskId, original.data.taskId);
  assert.equal(regenerated.data.status, "pending");

  const pending = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${regenerated.data.taskId}`, {
    headers: { Authorization: auth },
  })));
  assert.equal(pending.data.prompt, "Regenerate this card");
  assert.deepEqual(pending.data.referenceImages, ["https://cdn.example.com/original-reference.png"]);
  assert.equal(pending.data.model, "gpt-image-2-edit");
  assert.equal(pending.data.outputCount, 2);

  await waitForTask(app, regenerated.data.taskId, auth);
  assert.equal(providerInputs.at(-1).prompt, "Regenerate this card");
  assert.deepEqual(providerInputs.at(-1).referenceImages, ["https://cdn.example.com/original-reference.png"]);
  app.close();
});

test("returns credit transaction history with pagination", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_INITIAL_CREDITS: "10",
      MINIAPP_DB_PATH: tempDbPath(),
    },
    imageProvider: {
      name: "test-provider",
      generate: async () => ({
        provider: "test-provider",
        status: "completed",
        images: ["https://cdn.example.com/credit-history.png"],
      }),
    },
  });
  const auth = await login(app);

  const first = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({ prompt: "First credit charge", outputCount: 1 }),
  })));
  const second = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({ prompt: "Second credit charge", outputCount: 1 }),
  })));
  await waitForTask(app, first.data.taskId, auth);
  await waitForTask(app, second.data.taskId, auth);

  const history = await readJson(await app.fetch(new Request("http://local/api/miniapp/credit/history?page=1&limit=1", {
    headers: { Authorization: auth },
  })));

  assert.equal(history.success, true);
  assert.equal(history.data.records.length, 1);
  assert.equal(history.data.records[0].amount, -1);
  assert.equal(history.data.pagination.page, 1);
  assert.equal(history.data.pagination.limit, 1);
  assert.equal(history.data.pagination.total, 2);
  assert.equal(history.data.pagination.totalPages, 2);
  app.close();
});
