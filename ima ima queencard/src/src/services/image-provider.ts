import { nanoid } from "nanoid";

import { calculateModelCredits } from "@/config/credits";
import { getImageGenerationModelMaxOutputCount } from "@/config/image-generation-models";
import { creditService } from "@/services/credit";
import {
  type GptProtoConfig,
  type GptProtoImageFile,
  createGptProtoV3ImagePrediction,
  createOpenAIImageEdit,
  getGptProtoConfigs,
  shouldFailOverGptProto,
} from "@/services/gptproto";

export interface NormalizedImage {
  url?: string;
  b64Json?: string;
  mimeType?: string;
}

export interface NormalizedImageGenerationResult {
  provider: "gptproto" | "gptproto-fallback";
  model: string;
  capability?: "image-edit" | "image-to-image" | "tool";
  images: NormalizedImage[];
  raw: unknown;
  resultUrl?: string;
  usage: {
    requestedCredits: number;
    settledCredits: number;
    providerCostUsd?: number;
  };
  holdKey?: string;
  providerWarnings?: Array<{ code: string; message: string }>;
}

export interface ImageGenerationInput {
  model: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  capability?: "image-edit" | "image-to-image" | "tool";
  outputNumber?: number;
  responseFormat?: "url" | "b64_json";
  images?: GptProtoImageFile[];
  referenceImageUrls?: string[];
  seed?: number;
}

export interface ImageGenerationWithCreditsInput extends ImageGenerationInput {
  userId: string;
  holdKey?: string;
}

type ImageProviderResult = Omit<
  NormalizedImageGenerationResult,
  "usage" | "holdKey"
> & {
  providerCostUsd?: number;
};

function getImageProvider() {
  return process.env.IMAGE_PROVIDER?.trim() || "gptproto";
}

function normalizeOutputNumber(outputNumber: number | undefined) {
  return Math.max(1, Math.floor(outputNumber ?? 1));
}

function clampOutputNumber(model: string, outputNumber: number | undefined) {
  return Math.min(
    normalizeOutputNumber(outputNumber),
    getImageGenerationModelMaxOutputCount(model)
  );
}

type ImageModelRoute = {
  providerModel: string;
  capability: "image-edit" | "image-to-image";
  mode: "openai-edit" | "gptproto-v3";
  endpoint?: string;
};

const GPTPROTO_PLATFORM_IMAGE_COST_USD = {
  gemini31: {
    "1k": 0.0402,
    "2k": 0.0606,
    "4k": 0.0906,
  },
  seedream5: 0.0298,
  viduq2ImageToImage: {
    "1080p": { upTo3: 0.032, over3: 0.04 },
    "2k": { upTo3: 0.048, over3: 0.08 },
    "4k": { upTo3: 0.056, over3: 0.12 },
  },
} as const;

const IMAGE_MODEL_ROUTES: Record<string, ImageModelRoute> = {
  "gpt-image": {
    providerModel: "gpt-image-2",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "gpt-image-2-all": {
    providerModel: "gpt-image-2",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "nano-banana-2": {
    providerModel: "gemini-3.1-flash-image-preview",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "gemini-3.1-flash-image-preview": {
    providerModel: "gemini-3.1-flash-image-preview",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "seedream-5-0-260128": {
    providerModel: "seedream-5-0-260128",
    capability: "image-edit",
    mode: "gptproto-v3",
    endpoint: "/api/v3/doubao/seedream-5-0-260128/image-edit",
  },
  "nano-banana-2-edit": {
    providerModel: "gemini-3.1-flash-image-preview",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "gemini-3.1-flash-edit": {
    providerModel: "gemini-3.1-flash-image-preview",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "seedream-5-edit": {
    providerModel: "seedream-5-0-260128",
    capability: "image-edit",
    mode: "gptproto-v3",
    endpoint: "/api/v3/doubao/seedream-5-0-260128/image-edit",
  },
  "seedream-5-0-260128-edit": {
    providerModel: "seedream-5-0-260128",
    capability: "image-edit",
    mode: "gptproto-v3",
    endpoint: "/api/v3/doubao/seedream-5-0-260128/image-edit",
  },
  "doubao-seedream-5-0-260128-edit": {
    providerModel: "doubao-seedream-5-0-260128",
    capability: "image-edit",
    mode: "gptproto-v3",
    endpoint: "/api/v3/doubao/doubao-seedream-5-0-260128/image-edit",
  },
  "doubao-seedream-5-edit": {
    providerModel: "doubao-seedream-5-0-260128",
    capability: "image-edit",
    mode: "gptproto-v3",
    endpoint: "/api/v3/doubao/doubao-seedream-5-0-260128/image-edit",
  },
  "gpt-image-2-edit": {
    providerModel: "gpt-image-2",
    capability: "image-edit",
    mode: "openai-edit",
  },
  "viduq2-i2i": {
    providerModel: "viduq2",
    capability: "image-to-image",
    mode: "gptproto-v3",
    endpoint: "/api/v3/vidu/viduq2/image-to-image",
  },
};

function getImageModelRoute(model: string): ImageModelRoute {
  const route = IMAGE_MODEL_ROUTES[model];
  if (route) return route;

  return {
    providerModel: model,
    capability: "image-edit",
    mode: "openai-edit",
  };
}

function normalizeResolution(
  resolution: string | undefined
): "1k" | "2k" | "4k" | "1080p" {
  const value = resolution?.toLowerCase();
  if (!value || value === "auto") return "1k";
  if (value === "4k") return "4k";
  if (value === "2k") return "2k";
  if (value === "1080p") return "1080p";
  return "1k";
}

function normalizeViduResolution(resolution: string | undefined): "1080p" | "2k" | "4k" {
  const value = normalizeResolution(resolution);
  return value === "1k" ? "1080p" : value;
}

function normalizeGeminiSize(resolution: string | undefined) {
  const value = normalizeResolution(resolution);
  if (value === "4k") return "4K";
  if (value === "2k") return "2K";
  return "1K";
}

function estimateViduq2Cost(resolution: string | undefined, referenceImageCount: number) {
  const key = normalizeViduResolution(resolution);
  const tier = GPTPROTO_PLATFORM_IMAGE_COST_USD.viduq2ImageToImage[key];
  return referenceImageCount > 3 ? tier.over3 : tier.upTo3;
}

function estimateProviderCostUsd(
  route: ImageModelRoute,
  input: ImageGenerationInput,
  outputNumber: number,
  referenceImageCount: number
) {
  if (route.providerModel === "gemini-3.1-flash-image-preview") {
    const key = normalizeResolution(input.resolution);
    if (key === "1080p") {
      return GPTPROTO_PLATFORM_IMAGE_COST_USD.gemini31["1k"] * outputNumber;
    }
    return GPTPROTO_PLATFORM_IMAGE_COST_USD.gemini31[key] * outputNumber;
  }

  if (
    route.providerModel === "seedream-5-0-260128" ||
    route.providerModel === "doubao-seedream-5-0-260128"
  ) {
    return GPTPROTO_PLATFORM_IMAGE_COST_USD.seedream5 * outputNumber;
  }

  if (route.providerModel === "viduq2") {
    return estimateViduq2Cost(input.resolution, referenceImageCount) * outputNumber;
  }

  return undefined;
}

function roundToImageMultiple(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function sizeFromAspectRatio(aspectRatio: string | undefined, resolution?: string) {
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

function openAIEditSize(route: ImageModelRoute, input: ImageGenerationInput) {
  if (route.providerModel === "gemini-3.1-flash-image-preview") {
    return input.size ?? input.aspectRatio ?? "auto";
  }

  return input.size ?? sizeFromAspectRatio(input.aspectRatio, input.resolution);
}

function dataUriToFile(dataUri: string, index: number): GptProtoImageFile {
  const [meta = "", data = ""] = dataUri.split(",", 2);
  const mimeType = meta.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  return {
    data: Buffer.from(data, "base64"),
    filename: `reference-${index + 1}.${mimeType.split("/")[1] ?? "png"}`,
    mimeType,
  };
}

async function imageUrlToFile(url: string, index: number): Promise<GptProtoImageFile> {
  if (url.startsWith("data:image/")) return dataUriToFile(url, index);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load reference image: ${url}`);
  }
  const mimeType = response.headers.get("content-type") ?? "image/png";
  const arrayBuffer = await response.arrayBuffer();
  const extension = mimeType.split("/")[1] ?? "png";
  return {
    data: new Uint8Array(arrayBuffer),
    filename: `reference-${index + 1}.${extension}`,
    mimeType,
  };
}

async function loadReferenceImageFiles(referenceImageUrls: string[]) {
  return Promise.all(referenceImageUrls.map(imageUrlToFile));
}

function buildV3Body(
  route: ImageModelRoute,
  input: ImageGenerationInput,
  referenceImageUrls: string[],
  outputNumber: number
) {
  const size = input.size ?? sizeFromAspectRatio(input.aspectRatio, input.resolution);
  const images = { images: referenceImageUrls };
  const base = {
    prompt: input.prompt,
    n: outputNumber,
  };

  if (route.providerModel === "gpt-image-2") {
    return {
      ...base,
      ...images,
      prompt: appendAspectRatioHint(input.prompt, input.aspectRatio),
      size: input.size ?? "auto",
      quality: "auto",
      enable_sync_mode: "false",
      response_format: input.responseFormat ?? "url",
    };
  }

  if (route.providerModel === "gemini-3.1-flash-image-preview") {
    return {
      prompt: input.prompt,
      ...images,
      size: input.size ?? normalizeGeminiSize(input.resolution),
      aspect_ratio: input.aspectRatio ?? "1:1",
      output_format: "jpeg",
      enable_sync_mode: false,
      enable_base64_output: input.responseFormat === "b64_json",
    };
  }

  if (
    route.providerModel === "seedream-5-0-260128" ||
    route.providerModel === "doubao-seedream-5-0-260128"
  ) {
    return {
      prompt: input.prompt,
      ...images,
      size,
      enable_base64_output: input.responseFormat === "b64_json",
      enable_sync_mode: false,
    };
  }

  if (route.providerModel === "viduq2") {
    return {
      prompt: input.prompt,
      ...images,
      aspect_ratio: input.aspectRatio ?? "1:1",
      resolution: normalizeViduResolution(input.resolution),
      seed: input.seed,
    };
  }

  return {
    ...base,
    ...images,
    size,
    enable_base64_output: false,
    enable_sync_mode: false,
  };
}

function appendAspectRatioHint(prompt: string, aspectRatio: string | undefined) {
  if (!aspectRatio) return prompt;
  if (/\s--ar\s+\d+:\d+\b/.test(prompt)) return prompt;
  return `${prompt.trim()} --ar ${aspectRatio}`.trim();
}

async function generateWithGptProtoConfig(
  input: ImageGenerationInput,
  config: GptProtoConfig
): Promise<ImageProviderResult> {
  const outputNumber = clampOutputNumber(input.model, input.outputNumber);
  const referenceImageUrls = input.referenceImageUrls ?? [];
  const hasReferenceImages =
    referenceImageUrls.length > 0 || Boolean(input.images?.length);
  if (!hasReferenceImages) {
    throw new Error("At least one reference image is required.");
  }
  const route = getImageModelRoute(input.model);
  const referenceImageCount = referenceImageUrls.length || input.images?.length || 0;
  const result =
    route.mode === "gptproto-v3"
      ? await createGptProtoV3ImagePrediction({
          endpoint: route.endpoint ?? "/api/v3/images/generations",
          body: buildV3Body(route, input, referenceImageUrls, outputNumber),
        }, config)
      : await createOpenAIImageEdit({
          model: route.providerModel,
          prompt: input.prompt,
          images:
            input.images ??
            (await loadReferenceImageFiles(referenceImageUrls)),
          size: openAIEditSize(route, input),
          n: outputNumber,
          responseFormat: input.responseFormat,
        }, config);

  return {
    provider: config.route === "fallback" ? "gptproto-fallback" : "gptproto",
    model: route.providerModel,
    capability: input.capability ?? route.capability,
    images: result.images,
    raw: result.raw,
    resultUrl: result.resultUrl,
    providerCostUsd:
      result.providerCostUsd ??
      estimateProviderCostUsd(route, input, outputNumber, referenceImageCount),
  };
}

export async function generateImage(
  input: ImageGenerationInput
): Promise<ImageProviderResult> {
  const provider = getImageProvider();
  if (provider !== "gptproto") {
    throw new Error(`Unsupported image provider: ${provider}`);
  }

  const configs = getGptProtoConfigs();
  let primaryError: unknown;
  for (const [index, config] of configs.entries()) {
    try {
      const result = await generateWithGptProtoConfig(input, config);
      if (index > 0) {
        result.providerWarnings = [
          {
            code:
              primaryError &&
              typeof primaryError === "object" &&
              "code" in primaryError &&
              typeof primaryError.code === "string"
                ? primaryError.code
                : "GPTPROTO_PRIMARY_UNAVAILABLE",
            message:
              primaryError instanceof Error
                ? primaryError.message
                : "GPTProto primary route unavailable",
          },
        ];
      }
      return result;
    } catch (error) {
      if (index === 0) primaryError = error;
      const hasFallback = index < configs.length - 1;
      if (!hasFallback || !shouldFailOverGptProto(error)) throw error;
    }
  }

  throw primaryError ?? new Error("No GPTProto route is configured");
}

/*
 * Kept for callers that still pass multipart-style image blobs directly.
 */
export async function generateImageFromFiles(
  input: ImageGenerationInput & { images: GptProtoImageFile[] }
): Promise<ImageProviderResult> {
  const outputNumber = clampOutputNumber(input.model, input.outputNumber);
  const route = getImageModelRoute(input.model);
  const result = await createOpenAIImageEdit({
    model: route.providerModel,
    prompt: input.prompt,
    images: input.images,
    size: openAIEditSize(route, input),
    n: outputNumber,
    responseFormat: input.responseFormat,
  });

  return {
    provider: "gptproto",
    model: route.providerModel,
    capability: route.capability,
    images: result.images,
    raw: result.raw,
    resultUrl: result.resultUrl,
    providerCostUsd: result.providerCostUsd,
  };
}

export async function generateImageWithCredits(
  input: ImageGenerationWithCreditsInput
): Promise<NormalizedImageGenerationResult> {
  const outputNumber = clampOutputNumber(input.model, input.outputNumber);
  const referenceImageCount =
    input.referenceImageUrls?.length ?? input.images?.length ?? 0;
  const requestedCredits = calculateModelCredits(input.model, {
    outputNumber,
    resolution: input.resolution,
    referenceImageCount,
  });
  const holdKey = input.holdKey ?? `image_${nanoid(16)}`;

  await creditService.freeze({
    userId: input.userId,
    credits: requestedCredits,
    videoUuid: holdKey,
  });

  try {
    const result = await generateImage(input);
    const successfulOutputs = result.images.length;

    if (successfulOutputs <= 0) {
      await creditService.release(holdKey);
      return {
        ...result,
        usage: {
          requestedCredits,
          settledCredits: 0,
        },
        holdKey,
      };
    }

    const settledCredits = calculateModelCredits(input.model, {
      outputNumber: successfulOutputs,
      resolution: input.resolution,
      referenceImageCount,
    });
    await creditService.settlePartial(holdKey, settledCredits);

    return {
      ...result,
      usage: {
        requestedCredits,
        settledCredits,
        providerCostUsd: result.providerCostUsd,
      },
      holdKey,
    };
  } catch (error) {
    await creditService.release(holdKey);
    throw error;
  }
}
