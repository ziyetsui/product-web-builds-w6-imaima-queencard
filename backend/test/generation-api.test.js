const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");

async function json(response) {
  return response.json();
}

test("generation API returns 202, is idempotent, exposes registry values, and never calls provider on invalid combinations", async () => {
  let providerCalls = 0;
  const app = createApp({
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-api-test",
      MINIAPP_IMAGE_PROVIDER: "test",
    },
    imageProvider: {
      name: "test-provider",
      async generate() {
        providerCalls += 1;
        return { status: "completed", images: [] };
      },
    },
  });
  const login = await json(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
    method: "POST",
    body: JSON.stringify({ code: "api-user" }),
  })));
  const authorization = `Bearer ${login.data.token}`;
  const models = await json(await app.fetch(new Request("http://local/api/miniapp/models")));
  assert.equal(models.data.defaultModel, "gpt-image-2");
  assert.equal(models.data.models.length, 5);

  const invalid = await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", capability: "text-to-image", referenceAssetIds: ["not-owned"], prompt: "invalid" }),
  }));
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).code, "MODEL_REFERENCES_UNSUPPORTED");
  assert.equal(providerCalls, 0);

  const body = JSON.stringify({ model: "gpt-image-2", capability: "text-to-image", prompt: "valid", outputCount: 1 });
  const first = await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { authorization, "content-type": "application/json", "idempotency-key": "api-submit-1" },
    body,
  }));
  const replay = await app.fetch(new Request("http://local/api/miniapp/image-generations", {
    method: "POST",
    headers: { authorization, "content-type": "application/json", "idempotency-key": "api-submit-1" },
    body,
  }));
  assert.equal(first.status, 202);
  assert.equal(replay.status, 202);
  assert.equal((await json(first)).data.taskId, (await json(replay)).data.taskId);
  await app.close();
});
