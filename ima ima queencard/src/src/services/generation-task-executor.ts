import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { calculateModelCredits } from "@/config/credits";
import type { GenerationWorkerConfig } from "@/config/generation-worker";
import { generatedAssets, generationTasks } from "@/db";
import { creditService } from "@/services/credit";
import type {
  ClaimedGenerationTask,
  GenerationQueue,
} from "@/services/generation-queue";
import {
  classifyGenerationFailure,
  nextGenerationAttemptAt,
} from "@/services/generation-task-policy";
import {
  GENERATION_MAINTENANCE_MESSAGE,
  recordGenerationProviderFailure,
  recordGenerationProviderSuccess,
} from "@/services/generation-provider-health";
import {
  isGptProtoInsufficientBalanceError,
  shouldFailOverGptProto,
} from "@/services/gptproto";
import {
  generateImage,
  type ImageGenerationInput,
  type NormalizedImage,
} from "@/services/image-provider";

export type GenerationExecutionResult =
  | "succeeded"
  | "partially_succeeded"
  | "retry_scheduled"
  | "permanently_failed"
  | "stale";

type ProviderResult = Awaited<ReturnType<typeof generateImage>>;

export type GenerationTaskExecutorDependencies = Readonly<{
  queue: Pick<
    GenerationQueue,
    "scheduleRetry" | "withValidLeaseForFinalize"
  >;
  config: GenerationWorkerConfig;
  generate?: (input: ImageGenerationInput) => Promise<ProviderResult>;
  credits?: Pick<typeof creditService, "settlePartialInTx" | "releaseInTx">;
  now?: () => Date;
  random?: () => number;
}>;

function taskReferenceImages(task: ClaimedGenerationTask["task"]) {
  return Array.isArray(task.referenceImages)
    ? task.referenceImages.filter(
        (image): image is string => typeof image === "string"
      )
    : [];
}

function assetUrlFor(image: NormalizedImage) {
  if (image.url) return image.url;
  if (image.b64Json) {
    return `data:${image.mimeType ?? "image/png"};base64,${image.b64Json}`;
  }
  return null;
}

function providerTaskId(raw: unknown) {
  const body = raw as { id?: string; data?: { id?: string } };
  return body?.id ?? body?.data?.id ?? null;
}

function providerResultUrl(result: ProviderResult) {
  if (result.resultUrl) return result.resultUrl;
  const body = result.raw as {
    data?: { urls?: { get?: string } | Array<{ get?: string }> };
  };
  const urls = body?.data?.urls;
  return (Array.isArray(urls) ? urls[0]?.get : urls?.get) ?? null;
}

function publicFailureMessage(error: unknown) {
  if (isGptProtoInsufficientBalanceError(error)) {
    return GENERATION_MAINTENANCE_MESSAGE;
  }
  if (!(error instanceof Error)) return "Image generation failed";
  return error.message.slice(0, 1_000);
}

function publicFailureCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === "string" && value.length <= 120) return value;
  }
  return error instanceof GenerationProviderTimeoutError
    ? "PROVIDER_TIMEOUT"
    : "PROVIDER_FAILED";
}

class GenerationProviderTimeoutError extends Error {
  readonly code = "PROVIDER_TIMEOUT";

  constructor(timeoutMs: number) {
    super(`Image provider timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

async function withProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw signal.reason;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new GenerationProviderTimeoutError(timeoutMs)),
      timeoutMs
    );
    if (signal) {
      onAbort = () => reject(signal.reason ?? new Error("Generation aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createGenerationTaskExecutor({
  queue,
  config,
  generate = generateImage,
  credits = creditService,
  now = () => new Date(),
  random = Math.random,
}: GenerationTaskExecutorDependencies) {
  return {
    async execute(
      claimed: ClaimedGenerationTask,
      signal?: AbortSignal
    ): Promise<GenerationExecutionResult> {
      const { task, lease } = claimed;
      const referenceImages = taskReferenceImages(task);

      try {
        const result = await withProviderTimeout(
          generate({
            model: task.model,
            prompt: task.prompt,
            referenceImageUrls: referenceImages,
            aspectRatio: task.aspectRatio,
            resolution: task.resolution,
            outputNumber: task.outputCount,
            capability: task.capability as ImageGenerationInput["capability"],
            responseFormat: "url",
          }),
          config.providerTimeoutMs,
          signal
        );
        try {
          if (result.providerWarnings?.length) {
            await recordGenerationProviderFailure(
              new Error(result.providerWarnings[0]?.message),
              {
                degraded: true,
                errorCode: result.providerWarnings[0]?.code,
              }
            );
          } else {
            await recordGenerationProviderSuccess(
              result.provider === "gptproto-fallback" ? "fallback" : "primary"
            );
          }
        } catch (healthError) {
          console.error("Failed to update generation provider health:", healthError);
        }
        const finalizedAt = now();
        const rows = result.images.flatMap((image, outputIndex) => {
          const storageUrl = assetUrlFor(image);
          if (!storageUrl) return [];
          return [
            {
              id: `asset_${nanoid(16)}`,
              taskId: task.id,
              userId: task.userId,
              outputIndex,
              storageUrl,
              providerUrl: image.url,
              b64Json: image.b64Json,
              mimeType: image.mimeType ?? "image/png",
              creditsCharged: calculateModelCredits(task.model, {
                resolution: task.resolution,
                referenceImageCount: referenceImages.length,
              }),
            },
          ];
        });

        let terminalStatus: GenerationExecutionResult = "permanently_failed";
        const finalized = await queue.withValidLeaseForFinalize(
          lease,
          finalizedAt,
          async (transaction) => {
            if (rows.length > 0) {
              await transaction
                .insert(generatedAssets)
                .values(rows)
                .onConflictDoNothing({
                  target: [generatedAssets.taskId, generatedAssets.outputIndex],
                });
            }
            const persistedAssets = await transaction
              .select()
              .from(generatedAssets)
              .where(eq(generatedAssets.taskId, task.id));
            const settledCredits = persistedAssets.reduce(
              (sum, asset) => sum + asset.creditsCharged,
              0
            );

            if (persistedAssets.length === 0) {
              await credits.releaseInTx(transaction, task.creditHoldKey ?? task.id);
              terminalStatus = "permanently_failed";
            } else {
              await credits.settlePartialInTx(
                transaction,
                task.creditHoldKey ?? task.id,
                settledCredits
              );
              terminalStatus =
                persistedAssets.length < task.outputCount
                  ? "partially_succeeded"
                  : "succeeded";
            }

            await transaction
              .update(generationTasks)
              .set({
                status: terminalStatus,
                settledCredits,
                providerTaskId: providerTaskId(result.raw),
                providerResultUrl: providerResultUrl(result),
                providerRaw: result.raw,
                errorCode:
                  persistedAssets.length === 0 ? "NO_OUTPUT" : null,
                errorMessage:
                  persistedAssets.length === 0
                    ? "没有生成可计费图片，积分已释放。"
                    : null,
                failureCategory:
                  persistedAssets.length === 0 ? "permanent" : null,
                completedAt: finalizedAt,
                updatedAt: finalizedAt,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              })
              .where(
                and(
                  eq(generationTasks.id, task.id),
                  eq(generationTasks.version, lease.taskVersion),
                  eq(generationTasks.status, "running")
                )
              );
          }
        );
        return finalized ? terminalStatus : "stale";
      } catch (error) {
        if (shouldFailOverGptProto(error)) {
          try {
            await recordGenerationProviderFailure(error);
          } catch (healthError) {
            console.error("Failed to record generation provider failure:", healthError);
          }
        }
        const failure = classifyGenerationFailure(error);
        const failedAt = now();
        const retryable =
          failure.category !== "permanent" &&
          task.attemptCount < task.maxAttempts;

        if (retryable) {
          const scheduled = await queue.scheduleRetry(
            lease,
            failure,
            nextGenerationAttemptAt({
              attemptCount: task.attemptCount,
              now: failedAt,
              random,
              retryAfterMs: failure.retryAfterMs,
            }),
            failedAt,
            error
          );
          return scheduled ? "retry_scheduled" : "stale";
        }

        const finalized = await queue.withValidLeaseForFinalize(
          lease,
          failedAt,
          async (transaction) => {
            await credits.releaseInTx(
              transaction,
              task.creditHoldKey ?? task.id
            );
            await transaction
              .update(generationTasks)
              .set({
                status: "permanently_failed",
                failureCategory: failure.category,
                errorCode: publicFailureCode(error),
                errorMessage: publicFailureMessage(error),
                lastErrorAt: failedAt,
                completedAt: failedAt,
                updatedAt: failedAt,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              })
              .where(
                and(
                  eq(generationTasks.id, task.id),
                  eq(generationTasks.version, lease.taskVersion),
                  eq(generationTasks.status, "running")
                )
              );
          }
        );
        return finalized ? "permanently_failed" : "stale";
      }
    },
  };
}

export type GenerationTaskExecutor = ReturnType<
  typeof createGenerationTaskExecutor
>;
