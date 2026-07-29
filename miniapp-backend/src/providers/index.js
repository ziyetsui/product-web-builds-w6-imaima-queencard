function configuredProvider(env) {
  return String(env.MINIAPP_IMAGE_PROVIDER || env.MINIAPP_GENERATION_MODE || "preview")
    .trim()
    .toLowerCase();
}

function serviceUnavailable(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function templateImage(template) {
  return template.previewUrl || template.thumbnailUrl || (template.referenceImages || [])[0] || "";
}

function normalizeImages(payload) {
  const result = [];
  const source = payload || {};
  const candidates = [];

  if (Array.isArray(source.data)) candidates.push(...source.data);
  if (Array.isArray(source.images)) candidates.push(...source.images);
  if (source.output) candidates.push(source.output);
  if (Array.isArray(source.outputs)) candidates.push(...source.outputs);
  if (source.result) candidates.push(source.result);

  candidates.flatMap((item) => Array.isArray(item) ? item : [item]).forEach((item) => {
    if (!item) return;
    if (typeof item === "string") {
      result.push(item);
      return;
    }
    if (item.url) result.push(item.url);
    else if (item.image) result.push(item.image);
    else if (item.uri) result.push(item.uri);
    else if (item.b64_json || item.b64Json) {
      result.push("data:image/png;base64," + (item.b64_json || item.b64Json));
    }
  });

  return result;
}

function requestedModel(input, fallback) {
  const request = input.request || {};
  const model = request.model || (input.template.seed && input.template.seed.model);
  return String(model || fallback || "").trim();
}

function createPreviewProvider() {
  return {
    name: "preview",
    async generate(input) {
      const image = templateImage(input.template);
      return {
        provider: "preview",
        status: "completed",
        images: image ? [image] : [],
        raw: {
          templateId: input.template.id,
          mode: "preview",
        },
      };
    },
  };
}

function createMockProvider(env) {
  return {
    name: "mock",
    async generate(input) {
      const image = env.MINIAPP_MOCK_IMAGE_URL || templateImage(input.template);
      return {
        provider: "mock",
        status: "completed",
        images: image ? [image] : [],
        raw: {
          templateId: input.template.id,
          mode: "mock",
        },
      };
    },
  };
}

function createOpenAiProvider(env, fetchImpl) {
  return {
    name: "openai",
    async generate(input) {
      const apiKey = String(env.OPENAI_IMAGE_API_KEY || "").trim();
      if (!apiKey) throw serviceUnavailable("OPENAI_IMAGE_API_KEY is not configured");

      const endpoint = String(env.OPENAI_IMAGE_BASE_URL || "https://api.openai.com/v1/images/generations").replace(/\/$/, "");
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: requestedModel(input, env.OPENAI_IMAGE_MODEL || "gpt-image-1"),
          prompt: input.prompt || input.template.prompt,
          size: env.OPENAI_IMAGE_SIZE || "1024x1536",
          n: Number(env.OPENAI_IMAGE_COUNT || input.outputNumber || 1),
        }),
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const message = payload.error && payload.error.message ? payload.error.message : text;
        throw new Error("OpenAI image generation failed: " + response.status + " " + message);
      }
      return {
        provider: "openai",
        status: "completed",
        images: normalizeImages(payload),
        raw: payload,
      };
    },
  };
}

function createGptProtoProvider(env, fetchImpl) {
  return {
    name: "gptproto",
    async generate(input) {
      const apiKey = String(env.GPTPROTO_API_KEY || "").trim();
      if (!apiKey) throw serviceUnavailable("GPTPROTO_API_KEY is not configured");

      const baseUrl = String(env.GPTPROTO_BASE_URL || "https://gptproto.com").replace(/\/$/, "");
      const endpoint = String(env.GPTPROTO_IMAGE_ENDPOINT || "/api/v1/images/generations");
      const response = await fetchImpl(baseUrl + endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: requestedModel(input, env.GPTPROTO_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || "gpt-image-2"),
          prompt: input.prompt || input.template.prompt,
          referenceImages: input.referenceImages || input.template.referenceImages || [],
          templateId: input.template.id,
          outputNumber: Number(input.outputNumber || 1),
        }),
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const message = payload.error || payload.message || text;
        throw new Error("GPTProto image generation failed: " + response.status + " " + message);
      }
      return {
        provider: "gptproto",
        status: "completed",
        images: normalizeImages(payload),
        raw: payload,
        providerTaskId: payload.id || payload.taskId || payload.task_id || "",
      };
    },
  };
}

function createImageProvider(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const provider = configuredProvider(env);

  if (provider === "mock") return createMockProvider(env);
  if (provider === "openai") return createOpenAiProvider(env, fetchImpl);
  if (provider === "gptproto") return createGptProtoProvider(env, fetchImpl);
  return createPreviewProvider(env);
}

module.exports = {
  createImageProvider,
  normalizeImages,
};
