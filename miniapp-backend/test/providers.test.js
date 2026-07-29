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

test("gptproto provider calls the OpenAI-compatible image endpoint with the requested model", async () => {
  let requestBody = null;
  let requestHeaders = null;
  const provider = createImageProvider({
    env: {
      MINIAPP_IMAGE_PROVIDER: "gptproto",
      GPTPROTO_API_KEY: "test-key",
      GPTPROTO_IMAGE_ENDPOINT: "/api/v1/images/generations",
      GPTPROTO_IMAGE_MODEL: "fallback-model",
      GPTPROTO_IMAGE_SIZE: "1024x1536",
    },
    fetch: async (url, options) => {
      assert.equal(String(url), "https://gptproto.com/v1/images/generations");
      requestHeaders = options.headers;
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
      model: "gpt-image-2-edit",
    },
  });

  assert.equal(requestHeaders.authorization, "test-key");
  assert.equal(requestBody.model, "gpt-image-2");
  assert.equal(requestBody.size, "1024x1536");
  assert.deepEqual(result.images, ["https://cdn.example.com/generated.png"]);
});

test("gptproto provider reports non-json upstream responses with endpoint context", async () => {
  const provider = createImageProvider({
    env: {
      MINIAPP_IMAGE_PROVIDER: "gptproto",
      GPTPROTO_API_KEY: "test-key",
    },
    fetch: async () => new Response("<!DOCTYPE html><html></html>", {
      status: 404,
      headers: {
        "content-type": "text/html",
      },
    }),
  });

  await assert.rejects(
    () => provider.generate({ template, prompt: template.prompt }),
    (error) => {
      assert.match(error.message, /GPTProto image generation returned non-JSON/);
      assert.match(error.message, /\/v1\/images\/generations/);
      assert.match(error.message, /404/);
      return true;
    }
  );
});
