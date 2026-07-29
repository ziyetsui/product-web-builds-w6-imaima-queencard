const assert = require("node:assert/strict");
const test = require("node:test");

const { createImageProvider } = require("../src/providers");

const template = {
  id: "tpl-1",
  title: "Template one",
  prompt: "Create a visual card",
  previewUrl: "https://cdn.example.com/preview.jpg",
  thumbnailUrl: "https://cdn.example.com/thumb.jpg",
  referenceImages: ["https://cdn.example.com/ref.jpg"],
};

test("preview provider returns the selected template preview without external calls", async () => {
  let fetchCalled = false;
  const provider = createImageProvider({
    env: { MINIAPP_IMAGE_PROVIDER: "preview" },
    fetch: async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    },
  });

  const result = await provider.generate({ template, prompt: template.prompt });

  assert.equal(result.provider, "preview");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.images, ["https://cdn.example.com/preview.jpg"]);
  assert.equal(fetchCalled, false);
});

test("mock provider returns configured mock image without external calls", async () => {
  const provider = createImageProvider({
    env: {
      MINIAPP_IMAGE_PROVIDER: "mock",
      MINIAPP_MOCK_IMAGE_URL: "https://cdn.example.com/mock-output.png",
    },
  });

  const result = await provider.generate({ template, prompt: template.prompt });

  assert.equal(result.provider, "mock");
  assert.deepEqual(result.images, ["https://cdn.example.com/mock-output.png"]);
});

test("openai provider requires OPENAI_IMAGE_API_KEY before it can run", async () => {
  const provider = createImageProvider({
    env: { MINIAPP_IMAGE_PROVIDER: "openai" },
  });

  await assert.rejects(
    () => provider.generate({ template, prompt: template.prompt }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /OPENAI_IMAGE_API_KEY/);
      return true;
    }
  );
});

test("gptproto provider requires GPTPROTO_API_KEY before it can run", async () => {
  const provider = createImageProvider({
    env: { MINIAPP_IMAGE_PROVIDER: "gptproto" },
  });

  await assert.rejects(
    () => provider.generate({ template, prompt: template.prompt }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /GPTPROTO_API_KEY/);
      return true;
    }
  );
});

test("gptproto provider forwards the requested model when present", async () => {
  let requestBody = null;
  const provider = createImageProvider({
    env: {
      MINIAPP_IMAGE_PROVIDER: "gptproto",
      GPTPROTO_API_KEY: "test-key",
      GPTPROTO_IMAGE_MODEL: "fallback-model",
    },
    fetch: async (url, options) => {
      assert.equal(String(url), "https://gptproto.com/api/v1/images/generations");
      requestBody = JSON.parse(options.body);
      return Response.json({
        images: ["https://cdn.example.com/generated.png"],
      });
    },
  });

  const result = await provider.generate({
    template,
    prompt: template.prompt,
    request: {
      model: "doubao-seedream-5-edit",
    },
  });

  assert.equal(requestBody.model, "doubao-seedream-5-edit");
  assert.deepEqual(result.images, ["https://cdn.example.com/generated.png"]);
});
