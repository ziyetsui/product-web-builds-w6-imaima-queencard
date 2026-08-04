export interface GptProtoConfig {
  route: "primary" | "fallback";
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

export class GptProtoRequestError extends Error {
  readonly code: string;

  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown
  ) {
    super(message);
    this.name = "GptProtoRequestError";
    this.code = isInsufficientBalanceResponse(status, responseBody)
      ? "GPTPROTO_INSUFFICIENT_BALANCE"
      : "GPTPROTO_REQUEST_FAILED";
  }
}

export interface GptProtoImageResult {
  id?: string;
  resultUrl?: string;
  images: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  raw: unknown;
  providerCostUsd?: number;
}

export interface OpenAIImageGenerationParams {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  user?: string;
}

export interface GptProtoImageFile {
  data: Blob | ArrayBuffer | Uint8Array | string;
  filename?: string;
  mimeType?: string;
}

export interface OpenAIImageEditParams {
  model: string;
  prompt: string;
  images: GptProtoImageFile[];
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  user?: string;
}

export interface GptProtoV3TaskParams {
  endpoint?: string;
  body: Record<string, unknown>;
}

export interface GptProtoPollParams {
  endpoint?: string;
  intervalMs?: number;
  maxAttempts?: number;
}

const DEFAULT_BASE_URL = "https://gptproto.com";
const GPT_IMAGE_2_INPUT_PRICE_PER_M_TOKENS = 6.4;
const GPT_IMAGE_2_OUTPUT_PRICE_PER_M_TOKENS = 24;

export function getGptProtoConfig(): GptProtoConfig {
  const apiKey = process.env.GPTPROTO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GPTPROTO_API_KEY is not configured");
  }

  return {
    route: "primary",
    apiKey,
    baseUrl: (process.env.GPTPROTO_BASE_URL || DEFAULT_BASE_URL).replace(
      /\/$/,
      ""
    ),
    timeoutMs: Number(process.env.GPTPROTO_IMAGE_TIMEOUT_MS || 300_000),
    pollIntervalMs: Number(process.env.GPTPROTO_POLL_INTERVAL_MS || 2_000),
    maxPollAttempts: Number(process.env.GPTPROTO_MAX_POLL_ATTEMPTS || 120),
  };
}

export function getGptProtoConfigs(): GptProtoConfig[] {
  const primary = getGptProtoConfig();
  const fallbackApiKey = process.env.GPTPROTO_FALLBACK_API_KEY?.trim();
  if (!fallbackApiKey) return [primary];

  return [
    primary,
    {
      ...primary,
      route: "fallback",
      apiKey: fallbackApiKey,
      baseUrl: (
        process.env.GPTPROTO_FALLBACK_BASE_URL || primary.baseUrl
      ).replace(/\/$/, ""),
    },
  ];
}

function responseMessage(body: unknown) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const value = body as {
    message?: unknown;
    error?: unknown;
    data?: { message?: unknown; error?: unknown };
  };
  const nested =
    value.message ??
    (typeof value.error === "object" && value.error
      ? (value.error as { message?: unknown }).message
      : value.error) ??
    value.data?.message ??
    value.data?.error;
  return typeof nested === "string" ? nested : JSON.stringify(nested ?? body);
}

function isInsufficientBalanceResponse(status: number, body: unknown) {
  return (
    status === 402 ||
    (status === 403 &&
      /insufficient\s+(balance|credit)|balance\s+is\s+not\s+enough|余额不足|餘額不足/i.test(
        responseMessage(body)
      ))
  );
}

export function isGptProtoInsufficientBalanceError(error: unknown) {
  return (
    error instanceof GptProtoRequestError &&
    error.code === "GPTPROTO_INSUFFICIENT_BALANCE"
  );
}

export function shouldFailOverGptProto(error: unknown) {
  if (isGptProtoInsufficientBalanceError(error)) return true;
  if (error instanceof GptProtoRequestError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  return error instanceof Error &&
    (/timeout|timed out|fetch failed|connection|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error.message) ||
      error.name === "AbortError" ||
      error.name === "TimeoutError");
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  config = getGptProtoConfig()
): Promise<T> {
  const { controller, timeout } = withTimeout(config.timeoutMs);

  try {
    const requestWithAuth = async (authorization: string) => {
      const response = await fetch(`${config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: authorization,
          ...init.headers,
        },
      });
      const text = await response.text();
      const body = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          })()
        : null;
      return { response, text, body };
    };

    const first = await requestWithAuth(`Bearer ${config.apiKey}`);
    if (first.response.ok) return first.body as T;

    // GPTProto docs show both "Bearer sk-..." and raw "Authorization: sk-..."
    // examples across endpoints. Retry once with the raw key for v3 model pages.
    if (
      (first.response.status === 401 || first.response.status === 403) &&
      !isInsufficientBalanceResponse(first.response.status, first.body)
    ) {
      const second = await requestWithAuth(config.apiKey);
      if (second.response.ok) return second.body as T;
      throw new GptProtoRequestError(
        `GPTProto request failed: ${second.response.status} ${second.response.statusText}`,
        second.response.status,
        second.body
      );
    }

    throw new GptProtoRequestError(
      `GPTProto request failed: ${first.response.status} ${first.response.statusText}`,
      first.response.status,
      first.body
    );
  } finally {
    clearTimeout(timeout);
  }
}

function imageFromValue(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      const [, b64Json = ""] = value.split(",", 2);
      const mimeType = value.slice(5, value.indexOf(";")) || "image/png";
      return { b64Json, mimeType };
    }
    if (/^https?:\/\//i.test(value)) {
      return { url: value };
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const item = value as {
    url?: string;
    image?: string;
    uri?: string;
    b64Json?: string;
    b64_json?: string;
    mimeType?: string;
    mime_type?: string;
    width?: number;
    height?: number;
  };
  const url = item.url ?? item.image ?? item.uri;
  const b64Json = item.b64_json ?? item.b64Json;
  if (!url && !b64Json) return null;
  return {
    url,
    b64Json,
    mimeType: item.mime_type ?? item.mimeType,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectImageResults(raw: unknown) {
  const body = raw as {
    data?: unknown;
    output?: unknown;
    outputs?: unknown;
    images?: unknown;
  };

  const candidates: unknown[] = [];
  if (Array.isArray(body.data)) candidates.push(...body.data);
  else if (isRecord(body.data)) {
    candidates.push(
      body.data.output,
      body.data.outputs,
      body.data.images,
      body.data.result
    );
  }
  candidates.push(body.output, body.outputs, body.images);

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map(imageFromValue)
    .filter((image): image is NonNullable<ReturnType<typeof imageFromValue>> =>
      Boolean(image)
    );
}

function toImageResult(raw: unknown): GptProtoImageResult {
  const body = raw as {
    id?: string;
    data?:
      | Array<{ url?: string; b64_json?: string; mime_type?: string }>
      | {
          id?: string;
          outputs?: unknown[];
          output?: unknown;
          images?: unknown[];
          status?: string;
        };
    images?: Array<{ url?: string; b64Json?: string; b64_json?: string; mimeType?: string }>;
    usage?: {
      providerCostUsd?: number;
      provider_cost_usd?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  const images = collectImageResults(raw);
  const dataRecord: Record<string, unknown> | null = isRecord(body.data)
    ? body.data
    : null;
  const dataUsage = dataRecord?.usage as
    | {
        providerCostUsd?: number;
        provider_cost_usd?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined;
  const usage = body.usage ?? dataUsage;

  return {
    id:
      body.id ??
      (typeof dataRecord?.id === "string" ? dataRecord.id : undefined),
    images,
    raw,
    providerCostUsd: usage?.providerCostUsd ?? usage?.provider_cost_usd ?? estimateGptImage2TokenCost(usage),
  };
}

function estimateGptImage2TokenCost(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined
) {
  if (!usage) return undefined;
  const inputTokens = Math.max(0, usage.input_tokens ?? 0);
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  if (inputTokens === 0 && outputTokens === 0) return undefined;

  return (
    (inputTokens / 1_000_000) * GPT_IMAGE_2_INPUT_PRICE_PER_M_TOKENS +
    (outputTokens / 1_000_000) * GPT_IMAGE_2_OUTPUT_PRICE_PER_M_TOKENS
  );
}

export async function createOpenAIImageGeneration(
  params: OpenAIImageGenerationParams
): Promise<GptProtoImageResult> {
  const raw = await requestJson("/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      n: params.n,
      response_format: params.responseFormat,
      user: params.user,
    }),
  });

  return toImageResult(raw);
}

function toBlob(file: GptProtoImageFile) {
  if (file.data instanceof Blob) return file.data;
  if (typeof file.data === "string") {
    return new Blob([file.data], {
      type: file.mimeType ?? "application/octet-stream",
    });
  }
  if (file.data instanceof Uint8Array) {
    const buffer = file.data.buffer.slice(
      file.data.byteOffset,
      file.data.byteOffset + file.data.byteLength
    ) as ArrayBuffer;
    return new Blob([buffer], {
      type: file.mimeType ?? "application/octet-stream",
    });
  }
  return new Blob([file.data], {
    type: file.mimeType ?? "application/octet-stream",
  });
}

export async function createOpenAIImageEdit(
  params: OpenAIImageEditParams,
  config = getGptProtoConfig()
): Promise<GptProtoImageResult> {
  const form = new FormData();
  form.set("model", params.model);
  form.set("prompt", params.prompt);
  if (params.size) form.set("size", params.size);
  if (params.n) form.set("n", String(params.n));
  if (params.responseFormat) {
    form.set("response_format", params.responseFormat);
  }
  if (params.user) form.set("user", params.user);

  params.images.forEach((image, index) => {
    form.append(
      index === 0 ? "image" : "image[]",
      toBlob(image),
      image.filename ?? `image-${index + 1}.png`
    );
  });

  const raw = await requestJson("/v1/images/edits", {
    method: "POST",
    body: form,
  }, config);

  return toImageResult(raw);
}

export async function createGptProtoV3Task(params: GptProtoV3TaskParams) {
  return requestJson<{ id?: string; taskId?: string; data?: { id?: string } }>(
    params.endpoint ?? "/v3/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
    }
  );
}

function getTaskId(task: { id?: string; taskId?: string; data?: { id?: string } }) {
  return task.id ?? task.taskId ?? task.data?.id ?? null;
}

function stringifyFailureDetail(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return String(value);
  }
}

function getTaskFailureDetail(result: Record<string, unknown>) {
  const data = isRecord(result.data) ? result.data : null;
  const error = isRecord(result.error) ? result.error : null;
  const dataError = isRecord(data?.error) ? data.error : null;
  const message =
    data?.message ??
    data?.error_message ??
    data?.fail_reason ??
    data?.reason ??
    dataError?.message ??
    error?.message ??
    result.message ??
    result.error_message;

  return stringifyFailureDetail(message || data?.error || result.error || result);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollGptProtoV3Task(
  task: { id?: string; taskId?: string; data?: { id?: string } },
  params: GptProtoPollParams = {},
  config = getGptProtoConfig()
) {
  const taskId = getTaskId(task);
  if (!taskId) {
    throw new Error("GPTProto task id is missing");
  }

  const endpoint = params.endpoint ?? `/v3/tasks/${taskId}`;
  const intervalMs = params.intervalMs ?? config.pollIntervalMs;
  const maxAttempts = params.maxAttempts ?? config.maxPollAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await requestJson<Record<string, unknown>>(endpoint, {
      method: "GET",
    }, config);
    const data = isRecord(result.data) ? result.data : null;
    const status = String(
      data?.status ?? result.status ?? result.state ?? ""
    ).toLowerCase();

    if (
      ["succeeded", "success", "completed", "done"].includes(status) ||
      collectImageResults(result).length > 0
    ) {
      return result;
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      const detail = getTaskFailureDetail(result);
      throw new Error(
        `GPTProto task failed with status: ${status}${
          detail ? `: ${detail}` : ""
        }`
      );
    }

    await sleep(intervalMs);
  }

  throw new Error(`GPTProto task polling timed out: ${taskId}`);
}

function getPredictionResultEndpoint(
  task: {
    id?: string;
    taskId?: string;
    data?: { id?: string; urls?: { get?: string } | Array<{ get?: string }> };
  },
  fallbackEndpoint?: string
) {
  const urls = task.data?.urls;
  const getUrl = Array.isArray(urls) ? urls[0]?.get : urls?.get;
  if (getUrl) {
    try {
      return new URL(getUrl).pathname;
    } catch {
      return getUrl;
    }
  }
  if (fallbackEndpoint) return fallbackEndpoint;
  const taskId = getTaskId(task);
  if (!taskId) return null;
  return `/api/v3/predictions/${taskId}/result`;
}

function getPredictionResultUrl(
  task: {
    data?: { urls?: { get?: string } | Array<{ get?: string }> };
  }
) {
  const urls = task.data?.urls;
  return Array.isArray(urls) ? urls[0]?.get : urls?.get;
}

function isCompletedPrediction(raw: unknown) {
  const body = raw as { status?: string; data?: { status?: string } };
  const status = String(body.data?.status ?? body.status ?? "").toLowerCase();
  return ["succeeded", "success", "completed", "done"].includes(status);
}

export async function createGptProtoV3ImagePrediction(params: {
  endpoint: string;
  body: Record<string, unknown>;
  resultEndpoint?: string;
}, config = getGptProtoConfig()): Promise<GptProtoImageResult> {
  const task = await requestJson<{
    id?: string;
    taskId?: string;
    data?: {
      id?: string;
      status?: string;
      urls?: { get?: string } | Array<{ get?: string }>;
      outputs?: unknown[];
      output?: unknown;
      images?: unknown[];
    };
  }>(params.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.body),
  }, config);

  const endpoint = getPredictionResultEndpoint(task, params.resultEndpoint);
  const resultUrl = getPredictionResultUrl(task);
  if (isCompletedPrediction(task) && collectImageResults(task).length > 0) {
    return {
      ...toImageResult(task),
      resultUrl,
    };
  }

  if (!endpoint) {
    throw new Error("GPTProto prediction result endpoint is missing");
  }

  const result = await pollGptProtoV3Task(
    {
      id: task.id,
      taskId: task.taskId,
      data: { id: task.data?.id },
    },
    { endpoint },
    config
  );

  return {
    ...toImageResult(result),
    resultUrl,
  };
}
