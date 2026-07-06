import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { nanoid } from "nanoid";

import { calculateModelCredits, getModelConfig } from "@/config/credits";
import {
  db,
  generatedAssets,
  generationTasks,
  type GeneratedAsset,
  type GenerationTask,
} from "@/db";
import { ApiError } from "@/lib/api/error";
import { generateImageWithCredits } from "@/services/image-provider";
import { creditService } from "@/services/credit";
import { getImageGenerationModelMaxOutputCount } from "@/config/image-generation-models";

export type ImageGenerationCapability =
  | "image-edit"
  | "image-to-image"
  | "tool";

export type ImageGenerationSource = "manual" | "prompt-library" | "regenerate";

export interface ImageGenerationCreateInput {
  source?: ImageGenerationSource;
  sourceCaseId?: string | null;
  sourceCaseCategory?: string | null;
  sourceNoteUrl?: string | null;
  sourceAuthorUrl?: string | null;
  prompt?: string;
  referenceImages?: string[];
  model?: string;
  capability?: ImageGenerationCapability;
  aspectRatio?: string;
  outputCount?: number;
  resolution?: string;
  aiEnhance?: boolean;
  fastMode?: boolean;
}

export interface ImageGenerationListOptions {
  query?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

const MAX_PROMPT_LENGTH = 2000;
const MAX_REFERENCE_IMAGES = 3;
const DEFAULT_REFERENCE_IMAGE_MODEL = "gpt-image-2-edit";
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
]);

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:8080"
  );
}

function normalizeReferenceImage(image: string) {
  const value = image.trim();
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;
  try {
    const url = new URL(value, getAppUrl());
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new ApiError("Reference images must use HTTPS URLs", 400);
    }
    return url.toString();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Invalid reference image URL", 400, { image });
  }
}

function normalizeReferenceImages(images: unknown) {
  if (!Array.isArray(images)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const image of images) {
    if (typeof image !== "string") continue;
    const next = normalizeReferenceImage(image);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
    if (normalized.length >= MAX_REFERENCE_IMAGES) break;
  }

  return normalized;
}

function normalizeOutputCount(value: unknown, model: string) {
  const parsed = typeof value === "number" ? value : Number(value ?? 4);
  const requested = Math.min(
    4,
    Math.max(1, Math.floor(Number.isFinite(parsed) ? parsed : 4))
  );
  return Math.min(requested, getImageGenerationModelMaxOutputCount(model));
}

function normalizeAspectRatio(value: unknown, hasReferenceImages: boolean) {
  const aspectRatio = typeof value === "string" ? value : "";
  if (SUPPORTED_ASPECT_RATIOS.has(aspectRatio)) return aspectRatio;
  return hasReferenceImages ? "3:4" : "1:1";
}

function normalizeResolution(value: unknown) {
  const resolution = typeof value === "string" ? value.toLowerCase() : "auto";
  if (["auto", "1k", "2k", "4k"].includes(resolution)) return resolution;
  return "auto";
}

function inferCapability(
  capability: ImageGenerationCapability | undefined,
  model: string
): ImageGenerationCapability {
  if (model.endsWith("-i2i")) return "image-to-image";
  if (model.endsWith("-edit")) return "image-edit";
  if (capability) return capability;
  return "image-edit";
}

function providerModelFor(model: string) {
  switch (model) {
    case "nano-banana-2":
    case "nano-banana-2-edit":
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
    case "viduq2-i2i":
      return "viduq2";
    default:
      return model;
  }
}

function normalizeCreateInput(input: ImageGenerationCreateInput) {
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) {
    throw new ApiError("Prompt is required", 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ApiError("Prompt is too long", 400, {
      maxLength: MAX_PROMPT_LENGTH,
    });
  }

  const referenceImages = normalizeReferenceImages(input.referenceImages);
  const hasReferenceImages = referenceImages.length > 0;
  if (!hasReferenceImages) {
    throw new ApiError("请先上传至少 1 张参考图。", 400);
  }
  const model =
    typeof input.model === "string" && input.model.trim()
      ? input.model.trim()
      : DEFAULT_REFERENCE_IMAGE_MODEL;
  const modelConfig = getModelConfig(model);
  if (!modelConfig?.enabled) {
    throw new ApiError("Unsupported image model", 400, { model });
  }
  const capability = inferCapability(input.capability, model);

  return {
    source: input.source ?? "manual",
    sourceCaseId: input.sourceCaseId ?? null,
    sourceCaseCategory: input.sourceCaseCategory ?? null,
    sourceNoteUrl: input.sourceNoteUrl ?? null,
    sourceAuthorUrl: input.sourceAuthorUrl ?? null,
    prompt,
    referenceImages,
    model,
    providerModel: providerModelFor(model),
    capability,
    aspectRatio: normalizeAspectRatio(input.aspectRatio, hasReferenceImages),
    outputCount: normalizeOutputCount(input.outputCount, model),
    resolution: normalizeResolution(input.resolution),
    aiEnhance: Boolean(input.aiEnhance),
    fastMode: input.fastMode !== false,
  };
}

export function estimateImageGeneration(input: ImageGenerationCreateInput) {
  const normalized = normalizeCreateInput({
    ...input,
    prompt: input.prompt || "estimate",
  });
  const estimatedCredits = calculateModelCredits(normalized.model, {
    outputNumber: normalized.outputCount,
    resolution: normalized.resolution,
    referenceImageCount: normalized.referenceImages.length,
  });
  return {
    estimatedCredits,
    modelCreditsPerImage: calculateModelCredits(normalized.model, {
      resolution: normalized.resolution,
      referenceImageCount: normalized.referenceImages.length,
    }),
    model: normalized.model,
    capability: normalized.capability,
  };
}

function getProviderTaskId(raw: unknown) {
  const body = raw as { id?: string; data?: { id?: string } };
  return body.id ?? body.data?.id ?? null;
}

function getProviderResultUrl(result: { resultUrl?: string; raw: unknown }) {
  if (result.resultUrl) return result.resultUrl;
  const body = result.raw as {
    data?: { urls?: { get?: string } | Array<{ get?: string }> };
  };
  const urls = body.data?.urls;
  return (Array.isArray(urls) ? urls[0]?.get : urls?.get) ?? null;
}

function assetUrlFor(image: { url?: string; b64Json?: string; mimeType?: string }) {
  if (image.url) return image.url;
  if (image.b64Json) {
    return `data:${image.mimeType ?? "image/png"};base64,${image.b64Json}`;
  }
  return null;
}

function publicAsset(asset: GeneratedAsset) {
  return {
    id: asset.id,
    url: asset.storageUrl,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    creditsCharged: asset.creditsCharged,
    createdAt: asset.createdAt,
  };
}

function publicTask(task: GenerationTask, assets: GeneratedAsset[] = []) {
  return {
    taskId: task.id,
    status: task.status,
    source: task.source,
    sourceCaseId: task.sourceCaseId,
    sourceCaseCategory: task.sourceCaseCategory,
    prompt: task.prompt,
    referenceImages: (task.referenceImages as string[]) ?? [],
    model: task.model,
    providerModel: task.providerModel,
    capability: task.capability,
    aspectRatio: task.aspectRatio,
    resolution: task.resolution,
    outputCount: task.outputCount,
    requestedCredits: task.requestedCredits,
    settledCredits: task.settledCredits,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    assets: assets.map(publicAsset),
  };
}

function normalizeListLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 24;
  return Math.min(60, Math.max(1, Math.floor(value ?? 24)));
}

function normalizeListOffset(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function assetsByTaskId(assets: GeneratedAsset[]) {
  return assets.reduce<Record<string, GeneratedAsset[]>>((groups, asset) => {
    groups[asset.taskId] = [...(groups[asset.taskId] ?? []), asset];
    return groups;
  }, {});
}

function taskReferenceImages(task: GenerationTask) {
  return Array.isArray(task.referenceImages)
    ? task.referenceImages.filter((image): image is string => typeof image === "string")
    : [];
}

export async function createImageGenerationTask(
  userId: string,
  input: ImageGenerationCreateInput
) {
  const normalized = normalizeCreateInput(input);
  const requestedCredits = calculateModelCredits(normalized.model, {
    outputNumber: normalized.outputCount,
    resolution: normalized.resolution,
    referenceImageCount: normalized.referenceImages.length,
  });
  const balance = await creditService.getBalance(userId);
  if (balance.availableCredits < requestedCredits) {
    throw new ApiError("Insufficient credits", 402, {
      requiredCredits: requestedCredits,
      availableCredits: balance.availableCredits,
    });
  }

  const taskId = `gen_${nanoid(16)}`;
  const [task] = await db.insert(generationTasks).values({
    id: taskId,
    userId,
    source: normalized.source,
    sourceCaseId: normalized.sourceCaseId,
    sourceCaseCategory: normalized.sourceCaseCategory,
    sourceNoteUrl: normalized.sourceNoteUrl,
    sourceAuthorUrl: normalized.sourceAuthorUrl,
    prompt: normalized.prompt,
    originalPrompt: normalized.aiEnhance ? normalized.prompt : null,
    referenceImages: normalized.referenceImages,
    model: normalized.model,
    providerModel: normalized.providerModel,
    capability: normalized.capability,
    aspectRatio: normalized.aspectRatio,
    resolution: normalized.resolution,
    outputCount: normalized.outputCount,
    status: "queued",
    requestedCredits,
    creditHoldKey: taskId,
    updatedAt: new Date(),
  }).returning();

  return publicTask(task!);
}

export async function runImageGenerationTask(userId: string, taskId: string) {
  const [task] = await db
    .update(generationTasks)
    .set({
      status: "generating",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(generationTasks.id, taskId),
        eq(generationTasks.userId, userId),
        eq(generationTasks.status, "queued")
      )
    )
    .returning();

  if (!task) {
    return getImageGenerationTask(userId, taskId);
  }

  try {
    const result = await generateImageWithCredits({
      userId,
      holdKey: taskId,
      model: task.model,
      prompt: task.prompt,
      referenceImageUrls: taskReferenceImages(task),
      aspectRatio: task.aspectRatio,
      resolution: task.resolution,
      outputNumber: task.outputCount,
      capability: task.capability as ImageGenerationCapability,
      responseFormat: "url",
    });

    const creditsPerImage = calculateModelCredits(task.model, {
      resolution: task.resolution,
      referenceImageCount: taskReferenceImages(task).length,
    });
    const assetRows = result.images.flatMap((image, index) => {
      const storageUrl = assetUrlFor(image);
      if (!storageUrl) return [];
      return [{
        id: `asset_${nanoid(16)}`,
        taskId,
        userId,
        outputIndex: index,
        storageUrl,
        providerUrl: image.url,
        b64Json: image.b64Json,
        mimeType: image.mimeType ?? "image/png",
        creditsCharged: creditsPerImage,
      }];
    });

    const assets = assetRows.length
      ? await db.insert(generatedAssets).values(assetRows).returning()
      : [];
    const status =
      assets.length === 0
        ? "failed"
        : assets.length < task.outputCount
        ? "partial_success"
        : "completed";

    const [completedTask] = await db
      .update(generationTasks)
      .set({
        status,
        settledCredits: result.usage.settledCredits,
        providerTaskId: getProviderTaskId(result.raw),
        providerResultUrl: getProviderResultUrl(result),
        providerRaw: result.raw,
        errorCode: assets.length === 0 ? "NO_OUTPUT" : null,
        errorMessage: assets.length === 0 ? "没有生成可计费图片，积分已释放。" : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationTasks.id, taskId))
      .returning();

    return publicTask(completedTask!, assets);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed";
    const [failedTask] = await db
      .update(generationTasks)
      .set({
        status: "failed",
        errorCode: "PROVIDER_FAILED",
        errorMessage: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationTasks.id, taskId))
      .returning();

    return publicTask(failedTask!);
  }
}

export async function getImageGenerationTask(userId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(generationTasks)
    .where(and(eq(generationTasks.id, taskId), eq(generationTasks.userId, userId)))
    .limit(1);
  if (!task) throw new ApiError("Image generation task not found", 404);

  const assets = await db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.taskId, taskId),
        eq(generatedAssets.userId, userId),
        eq(generatedAssets.isDeleted, false)
      )
    );

  return publicTask(task, assets);
}

export async function listImageGenerationTasks(
  userId: string,
  options: ImageGenerationListOptions = {}
) {
  const limit = normalizeListLimit(options.limit);
  const offset = normalizeListOffset(options.offset);
  const filters: SQL[] = [eq(generationTasks.userId, userId)];
  const query = options.query?.trim();
  const status = options.status?.trim();

  if (query) {
    const pattern = `%${query}%`;
    const searchFilter = or(
      ilike(generationTasks.prompt, pattern),
      ilike(generationTasks.sourceCaseCategory, pattern),
      ilike(generationTasks.model, pattern),
      ilike(generationTasks.providerModel, pattern),
      ilike(generationTasks.status, pattern)
    );
    if (searchFilter) filters.push(searchFilter);
  }

  if (status) {
    filters.push(eq(generationTasks.status, status));
  }

  const where = and(...filters);
  const tasks = await db
    .select()
    .from(generationTasks)
    .where(where)
    .orderBy(desc(generationTasks.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(generationTasks)
    .where(where);
  const total = Number(countResult?.count ?? 0);

  if (tasks.length === 0) {
    return { records: [], total, limit, offset, query: query ?? "" };
  }

  const taskIds = tasks.map((task) => task.id);
  const assets = await db
    .select()
    .from(generatedAssets)
    .where(
      and(
        inArray(generatedAssets.taskId, taskIds),
        eq(generatedAssets.userId, userId),
        eq(generatedAssets.isDeleted, false)
      )
    )
    .orderBy(asc(generatedAssets.outputIndex));
  const groupedAssets = assetsByTaskId(assets);

  return {
    records: tasks.map((task) => publicTask(task, groupedAssets[task.id] ?? [])),
    total,
    limit,
    offset,
    query: query ?? "",
  };
}

export async function regenerateImageTask(userId: string, taskId: string) {
  const existing = await getImageGenerationTask(userId, taskId);
  return createImageGenerationTask(userId, {
    source: "regenerate",
    sourceCaseId: existing.sourceCaseId,
    sourceCaseCategory: existing.sourceCaseCategory,
    prompt: existing.prompt,
    referenceImages: existing.referenceImages,
    model: existing.model,
    capability: existing.capability as ImageGenerationCapability,
    aspectRatio: existing.aspectRatio,
    outputCount: existing.outputCount,
    resolution: existing.resolution,
  });
}

export async function getGeneratedAssetForDownload(userId: string, assetId: string) {
  const [asset] = await db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.id, assetId),
        eq(generatedAssets.userId, userId),
        eq(generatedAssets.isDeleted, false)
      )
    )
    .limit(1);

  if (!asset) throw new ApiError("Generated asset not found", 404);
  return asset;
}
