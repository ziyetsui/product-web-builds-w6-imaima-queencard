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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("data:image/") || /^https?:\/\//i.test(value)) return value;
    return "";
  }
  if (!isRecord(value)) return "";
  if (value.url) return value.url;
  if (value.image) return value.image;
  if (value.uri) return value.uri;
  const b64Json = value.b64_json || value.b64Json;
  if (b64Json) return "data:image/png;base64," + b64Json;
  return "";
}

function normalizeImages(payload) {
  const result = [];
  const source = payload || {};
  const candidates = [];

  if (Array.isArray(source.data)) candidates.push(...source.data);
  else if (isRecord(source.data)) {
    candidates.push(
      source.data.output,
      source.data.outputs,
      source.data.images,
      source.data.result
    );
  }
  if (Array.isArray(source.images)) candidates.push(...source.images);
  if (source.output) candidates.push(source.output);
  if (Array.isArray(source.outputs)) candidates.push(...source.outputs);
  if (source.result) candidates.push(source.result);

  candidates.flatMap((item) => Array.isArray(item) ? item : [item]).forEach((item) => {
    const image = imageFromValue(item);
    if (image) result.push(image);
  });

  return result;
}

function parseJsonResponse(text, context) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${context.provider} image generation returned non-JSON from ${context.endpoint} (${context.status}, ${context.contentType || "unknown content-type"}): ${preview}`);
  }
}

function providerModelFor(model) {
  switch (model) {
    case "gemini-3.1-flash-edit":
      return "gemini-3.1-flash-image-preview";
    case "seedream-5-edit":
    case "seedream-5-0-260128-edit":
      return "seedream-5-0-260128";
    case "doubao-seedream-5-edit":
    case "doubao-seedream-5-0-260128-edit":
      return "doubao-seedream-5-0-260128";
    case "gpt-image":
    case "gpt-image-2-all":
    case "gpt-image-2-edit":
      return "gpt-image-2";
    default:
      return model;
  }
}

function requestedModelKey(input, fallback) {
  const request = input.request || {};
  const model = request.model || (input.template.seed && input.template.seed.model);
  return String(model || fallback || "").trim();
}

function requestedModel(input, fallback) {
  const model = requestedModelKey(input, fallback);
  return providerModelFor(String(model || fallback || "").trim());
}

function gptProtoRouteFor(model) {
  switch (model) {
    case "seedream-5-edit":
    case "seedream-5-0-260128":
    case "seedream-5-0-260128-edit":
      return {
        mode: "v3",
        providerModel: "seedream-5-0-260128",
        endpoint: "/api/v3/doubao/seedream-5-0-260128/image-edit",
      };
    case "doubao-seedream-5-edit":
    case "doubao-seedream-5-0-260128":
    case "doubao-seedream-5-0-260128-edit":
      return {
        mode: "v3",
        providerModel: "doubao-seedream-5-0-260128",
        endpoint: "/api/v3/doubao/doubao-seedream-5-0-260128/image-edit",
      };
    default:
      return {
        mode: "openai-compatible",
        providerModel: providerModelFor(model),
      };
  }
}

function gptProtoEndpoint(env) {
  const endpoint = String(env.GPTPROTO_IMAGE_ENDPOINT || "/v1/images/generations").trim() || "/v1/images/generations";
  if (endpoint === "/api/v1/images/generations") return "/v1/images/generations";
  return endpoint.startsWith("/") ? endpoint : "/" + endpoint;
}

function normalizeResolution(resolution) {
  const value = String(resolution || "").toLowerCase();
  return value === "2k" ? "2k" : "1k";
}

function roundToImageMultiple(value) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function sizeFromAspectRatio(aspectRatio, resolution) {
  const base = normalizeResolution(resolution) === "2k" ? 2048 : 1024;
  switch (aspectRatio) {
    case "3:4":
      return `${base}x${roundToImageMultiple((base * 4) / 3)}`;
    case "4:3":
      return `${roundToImageMultiple((base * 4) / 3)}x${base}`;
    case "16:9":
      return `${base * 2}x${roundToImageMultiple((base * 2 * 9) / 16)}`;
    case "9:16":
      return `${roundToImageMultiple((base * 2 * 9) / 16)}x${base * 2}`;
    case "2:3":
      return `${base}x${roundToImageMultiple((base * 3) / 2)}`;
    case "3:2":
      return `${roundToImageMultiple((base * 3) / 2)}x${base}`;
    case "21:9":
      return `${base * 2}x${roundToImageMultiple((base * 2 * 9) / 21)}`;
    case "1:1":
    default:
      return `${base}x${base}`;
  }
}

function parseSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function aspectRatioParts(aspectRatio, fallbackSize) {
  const match = String(aspectRatio || "").match(/^(\d+):(\d+)$/);
  if (match) {
    return {
      width: Number(match[1]),
      height: Number(match[2]),
    };
  }
  if (fallbackSize) return fallbackSize;
  return {
    width: 1,
    height: 1,
  };
}

function ensureMinimumPixels(size, aspectRatio, minimumPixels) {
  const parsed = parseSize(size);
  if (parsed && parsed.width * parsed.height >= minimumPixels) return size;

  const ratio = aspectRatioParts(aspectRatio, parsed);
  let width = roundToImageMultiple(Math.sqrt((minimumPixels * ratio.width) / ratio.height));
  let height = roundToImageMultiple((width * ratio.height) / ratio.width);
  while (width * height < minimumPixels) {
    height += 16;
  }
  return `${width}x${height}`;
}

function seedreamV3Size(input, env) {
  const request = input.request || {};
  const seed = input.template.seed || {};
  const aspectRatio = request.aspectRatio || seed.aspectRatio || "1:1";
  const candidate =
    env.GPTPROTO_SEEDREAM_IMAGE_SIZE ||
    request.size ||
    sizeFromAspectRatio(aspectRatio, request.resolution || seed.resolution) ||
    env.GPTPROTO_IMAGE_SIZE ||
    env.OPENAI_IMAGE_SIZE ||
    "1024x1024";

  return ensureMinimumPixels(candidate, aspectRatio, 3686400);
}

function absoluteUrl(baseUrl, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return baseUrl + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
}

function stringifyFailureDetail(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return String(value);
  }
}

function upstreamErrorMessage(payload, text) {
  if (!isRecord(payload)) return text;
  return stringifyFailureDetail(
    payload.error && payload.error.message ? payload.error.message :
      payload.message || payload.error_message || payload.error || text
  );
}

function taskIdFromPayload(payload) {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : null;
  return payload.id || payload.taskId || payload.task_id || (data && (data.id || data.taskId || data.task_id)) || "";
}

function taskStatus(payload) {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : null;
  return String((data && data.status) || payload.status || payload.state || "").toLowerCase();
}

function predictionResultEndpoint(payload) {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : null;
  const urls = data && data.urls;
  const getUrl = Array.isArray(urls) ? urls[0] && urls[0].get : urls && urls.get;
  if (getUrl) {
    try {
      const parsed = new URL(getUrl);
      return parsed.pathname + parsed.search;
    } catch {
      return getUrl;
    }
  }
  const taskId = taskIdFromPayload(payload);
  return taskId ? `/api/v3/predictions/${taskId}/result` : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const payload = parseJsonResponse(text, {
        provider: "OpenAI",
        endpoint,
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
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
      const route = gptProtoRouteFor(requestedModelKey(input, env.GPTPROTO_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || "gpt-image-2"));
      if (route.mode === "v3") {
        const referenceImages = input.referenceImages || input.template.referenceImages || [];
        const responseFormat = input.request && input.request.responseFormat;
        const size = seedreamV3Size(input, env);
        const response = await fetchImpl(absoluteUrl(baseUrl, route.endpoint), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: apiKey,
          },
          body: JSON.stringify({
            prompt: input.prompt || input.template.prompt,
            images: referenceImages,
            size,
            enable_base64_output: responseFormat === "b64_json",
            enable_sync_mode: false,
          }),
        });
        const text = await response.text();
        const payload = parseJsonResponse(text, {
          provider: "GPTProto",
          endpoint: route.endpoint,
          status: response.status,
          contentType: response.headers.get("content-type"),
        });
        if (!response.ok) {
          throw new Error("GPTProto image generation failed: " + response.status + " " + upstreamErrorMessage(payload, text));
        }

        let resultPayload = payload;
        const completedStatuses = ["succeeded", "success", "completed", "done"];
        if (!completedStatuses.includes(taskStatus(payload)) && normalizeImages(payload).length === 0) {
          const resultEndpoint = predictionResultEndpoint(payload);
          if (!resultEndpoint) throw new Error("GPTProto prediction result endpoint is missing");
          const pollIntervalMs = Number(env.GPTPROTO_POLL_INTERVAL_MS || 2000);
          const maxPollAttempts = Number(env.GPTPROTO_MAX_POLL_ATTEMPTS || 120);
          for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
            const pollResponse = await fetchImpl(absoluteUrl(baseUrl, resultEndpoint), {
              method: "GET",
              headers: {
                authorization: apiKey,
              },
            });
            const pollText = await pollResponse.text();
            const pollPayload = parseJsonResponse(pollText, {
              provider: "GPTProto",
              endpoint: resultEndpoint,
              status: pollResponse.status,
              contentType: pollResponse.headers.get("content-type"),
            });
            if (!pollResponse.ok) {
              throw new Error("GPTProto image generation failed: " + pollResponse.status + " " + upstreamErrorMessage(pollPayload, pollText));
            }
            const status = taskStatus(pollPayload);
            if (completedStatuses.includes(status) || normalizeImages(pollPayload).length > 0) {
              resultPayload = pollPayload;
              break;
            }
            if (["failed", "error", "cancelled", "canceled"].includes(status)) {
              throw new Error("GPTProto task failed with status: " + status + " " + upstreamErrorMessage(pollPayload, pollText));
            }
            if (attempt === maxPollAttempts) {
              throw new Error("GPTProto task polling timed out: " + taskIdFromPayload(payload));
            }
            await sleep(pollIntervalMs);
          }
        }

        return {
          provider: "gptproto",
          status: "completed",
          images: normalizeImages(resultPayload),
          raw: resultPayload,
          providerTaskId: taskIdFromPayload(payload),
        };
      }

      const endpoint = gptProtoEndpoint(env);
      const response = await fetchImpl(baseUrl + endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: apiKey,
        },
        body: JSON.stringify({
          model: route.providerModel,
          prompt: input.prompt || input.template.prompt,
          size: env.GPTPROTO_IMAGE_SIZE || env.OPENAI_IMAGE_SIZE || "1024x1536",
          referenceImages: input.referenceImages || input.template.referenceImages || [],
          templateId: input.template.id,
          outputNumber: Number(input.outputNumber || 1),
        }),
      });
      const text = await response.text();
      const payload = parseJsonResponse(text, {
        provider: "GPTProto",
        endpoint,
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
      if (!response.ok) {
        const message = upstreamErrorMessage(payload, text);
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
