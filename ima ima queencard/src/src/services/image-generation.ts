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
import { loadGenerationWorkerConfig } from "@/config/generation-worker";
import {
  db,
  generatedAssets,
  generationTasks,
  type GeneratedAsset,
  type GenerationTask,
} from "@/db";
import { ApiError } from "@/lib/api/error";
import { creditService } from "@/services/credit";
import { getImageGenerationModelMaxOutputCount } from "@/config/image-generation-models";

export type ImageGenerationCapability =
  | "image-edit"
  | "image-to-image"
  | "tool";

export type ImageGenerationSource = "manual" | "prompt-library" | "regenerate";

export interface ImageGenerationCreateInput {
  idempotencyKey?: string;
  source?: ImageGenerationSource;
  sourceCaseId?: string | null;
  sourceCaseCategory?: string | null;
  sourceNoteUrl?: string | null;
  sourceAuthorUrl?: string | null;
  parentTaskId?: string | null;
  prompt?: string;
  patternId?: string;
  patternVersion?: number;
  patternValues?: Record<string, string | number>;
  displayPrompt?: string;
  referenceImages?: string[];
  model?: string;
  capability?: ImageGenerationCapability;
  aspectRatio?: string;
  outputCount?: number;
  resolution?: string;
  aiEnhance?: boolean;
  fastMode?: boolean;
}

type GenerationPatternContext = {
  patternId: string;
  patternVersion: number;
  patternValues: Record<string, string | number>;
  displayPrompt: string;
};

export interface ImageGenerationListOptions {
  query?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

const MAX_PROMPT_LENGTH = 2000;
const MAX_REFERENCE_IMAGES = 3;
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 120;
const IDEMPOTENCY_UNIQUE_CONSTRAINT =
  "generation_tasks_user_id_idempotency_key_idx";
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

function normalizeIdempotencyKey(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("Idempotency key must be a string", 400);
  }

  const idempotencyKey = value.trim();
  if (
    idempotencyKey.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new ApiError("Idempotency key must be 8 to 120 characters", 400, {
      minLength: MIN_IDEMPOTENCY_KEY_LENGTH,
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    });
  }

  return idempotencyKey;
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

function normalizePatternContext(input: ImageGenerationCreateInput): GenerationPatternContext | null {
  const patternId = typeof input.patternId === "string" ? input.patternId.trim() : "";
  const patternVersion = Number(input.patternVersion);
  const displayPrompt = typeof input.displayPrompt === "string"
    ? input.displayPrompt.trim().slice(0, 500)
    : "";
  if (!patternId || !Number.isInteger(patternVersion) || patternVersion < 1 || !displayPrompt) {
    return null;
  }

  const patternValues: Record<string, string | number> = {};
  if (input.patternValues && typeof input.patternValues === "object") {
    for (const [key, value] of Object.entries(input.patternValues)) {
      if (!/^[a-z][a-z0-9_]{1,31}$/.test(key)) continue;
      if (typeof value === "string") patternValues[key] = value.slice(0, 300);
      if (typeof value === "number" && Number.isFinite(value)) patternValues[key] = value;
    }
  }
  if (Object.keys(patternValues).length === 0) return null;

  return { patternId, patternVersion, patternValues, displayPrompt };
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
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    source: input.source ?? "manual",
    sourceCaseId: input.sourceCaseId ?? null,
    sourceCaseCategory: input.sourceCaseCategory ?? null,
    sourceNoteUrl: input.sourceNoteUrl ?? null,
    sourceAuthorUrl: input.sourceAuthorUrl ?? null,
    parentTaskId: input.parentTaskId ?? null,
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
    patternContext: normalizePatternContext(input),
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
  const patternContext = task.patternContext as GenerationPatternContext | null;
  return {
    taskId: task.id,
    status: task.status,
    source: task.source,
    sourceCaseId: task.sourceCaseId,
    sourceCaseCategory: task.sourceCaseCategory,
    prompt: task.prompt,
    patternId: patternContext?.patternId,
    patternVersion: patternContext?.patternVersion,
    patternValues: patternContext?.patternValues,
    displayPrompt: patternContext?.displayPrompt,
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

async function findTaskByIdempotencyKey(
  queryDb: Pick<typeof db, "select">,
  userId: string,
  idempotencyKey: string
) {
  const [task] = await queryDb
    .select()
    .from(generationTasks)
    .where(
      and(
        eq(generationTasks.userId, userId),
        eq(generationTasks.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);

  return task ?? null;
}

function isIdempotencyUniqueConflict(error: unknown) {
  let current: unknown = error;

  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") return false;
    const databaseError = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    const constraint =
      databaseError.constraint ?? databaseError.constraint_name;
    if (
      databaseError.code === "23505" &&
      constraint === IDEMPOTENCY_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = databaseError.cause;
  }

  return false;
}

function asInsufficientCreditApiError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(
    /^Insufficient credits\. Required: (\d+), Available: (\d+)$/
  );
  if (!match) return null;

  return new ApiError("Insufficient credits", 402, {
    requiredCredits: Number(match[1]),
    availableCredits: Number(match[2]),
  });
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
  const taskId = `gen_${nanoid(16)}`;
  const workerConfig = loadGenerationWorkerConfig(process.env);

  try {
    return await db.transaction(async (trx) => {
      if (normalized.idempotencyKey) {
        const existing = await findTaskByIdempotencyKey(
          trx,
          userId,
          normalized.idempotencyKey
        );
        if (existing) return publicTask(existing);
      }

      const now = new Date();
      const [task] = await trx
        .insert(generationTasks)
        .values({
          id: taskId,
          userId,
          idempotencyKey: normalized.idempotencyKey,
          source: normalized.source,
          sourceCaseId: normalized.sourceCaseId,
          sourceCaseCategory: normalized.sourceCaseCategory,
          sourceNoteUrl: normalized.sourceNoteUrl,
          sourceAuthorUrl: normalized.sourceAuthorUrl,
          parentTaskId: normalized.parentTaskId,
          prompt: normalized.prompt,
          originalPrompt: normalized.aiEnhance ? normalized.prompt : null,
          patternContext: normalized.patternContext,
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
          maxAttempts: workerConfig.maxAttempts,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .returning();

      if (!task) {
        throw new Error("Failed to create image generation task");
      }

      await creditService.freezeInTx(trx, {
        userId,
        credits: requestedCredits,
        videoUuid: taskId,
      });

      return publicTask(task);
    });
  } catch (error) {
    if (normalized.idempotencyKey && isIdempotencyUniqueConflict(error)) {
      const existing = await findTaskByIdempotencyKey(
        db,
        userId,
        normalized.idempotencyKey
      );
      if (existing) return publicTask(existing);
    }

    const insufficientCredits = asInsufficientCreditApiError(error);
    if (insufficientCredits) throw insufficientCredits;
    throw error;
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
      sql`${generationTasks.patternContext} ->> 'displayPrompt' ILIKE ${pattern}`,
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
    parentTaskId: taskId,
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
