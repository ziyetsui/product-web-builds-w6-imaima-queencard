const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../src/app");

async function readJson(response) {
  return response.json();
}

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-app-db-")), "miniapp.sqlite");
}

test("supports standalone login, balance, templates, generation task and result", async () => {
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_AUTH_TOKEN_SECRET: "test-secret",
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

  const task = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${generated.data.taskId}`, {
    headers: { Authorization: auth },
  })));
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
      MINIAPP_AUTH_TOKEN_SECRET: "test-secret",
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
  const task = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${generated.data.taskId}`, {
    headers: { Authorization: auth },
  })));

  assert.equal(providerInput.template.id, "tpl-provider");
  assert.equal(providerInput.prompt, "Override prompt");
  assert.equal(task.data.provider, "test-provider");
  assert.deepEqual(task.data.images, ["https://cdn.example.com/generated.png"]);
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

test("uploads a reference image and creates a generic generation task", async () => {
  let providerInput = null;
  const app = createApp({
    env: {
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-test",
      MINIAPP_AUTH_TOKEN_SECRET: "test-secret",
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
  form.set("file", new Blob(["image-bytes"], { type: "image/png" }), "reference.png");

  const uploaded = await readJson(await app.fetch(new Request("http://local/api/miniapp/uploads/reference-image", {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  })));
  assert.equal(uploaded.success, true);
  assert.match(uploaded.data.url, /^http:\/\/local\/uploads\/reference\/.+\.png$/);

  const generated = await readJson(await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify({
      prompt: "Generate with uploaded reference",
      referenceImages: [uploaded.data.url],
      outputCount: 1,
    }),
  })));
  const task = await readJson(await app.fetch(new Request(`http://local/api/miniapp/image-generations/${generated.data.taskId}`, {
    headers: { Authorization: auth },
  })));

  assert.equal(providerInput.prompt, "Generate with uploaded reference");
  assert.deepEqual(providerInput.referenceImages, [uploaded.data.url]);
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
