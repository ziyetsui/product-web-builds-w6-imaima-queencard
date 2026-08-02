import { ApiError } from "@/lib/api/error";

const BASE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const MAX_RETRY_AFTER_MS = 15 * 60 * 1_000;

export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "partially_succeeded"
  | "permanently_failed";

export type GenerationLeaseToken = Readonly<{
  taskId: string;
  taskVersion: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
}>;

export type GenerationFailureCategory = "transient" | "permanent" | "unknown";

export type GenerationFailure = Readonly<{
  category: GenerationFailureCategory;
  retryAfterMs?: number;
}>;

type GenerationScopeTask = Readonly<{
  userId: string;
  provider: string;
  providerModel: string;
}>;

type RetryScheduleParams = Readonly<{
  attemptCount: number;
  now: Date;
  random: () => number;
  retryAfterMs?: number;
}>;

type ErrorDetails = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  retryAfterMs?: unknown;
  retryAfter?: unknown;
  headers?: unknown;
};

export function buildGenerationScopes(task: GenerationScopeTask) {
  return [
    "global",
    `provider:${task.provider}:${task.providerModel}`,
    `user:${task.userId}`,
  ].sort();
}

function errorDetails(error: unknown): ErrorDetails {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error) {
    return error as ErrorDetails;
  }
  return typeof error === "object" && error !== null ? error as ErrorDetails : {};
}

function parseMilliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.floor(value), MAX_RETRY_AFTER_MS);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Math.min(Number(value), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

function parseRetryAfterSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.floor(value * 1_000), MAX_RETRY_AFTER_MS);
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.min(Math.floor(seconds * 1_000), MAX_RETRY_AFTER_MS)
    : undefined;
}

function providerRetryAfterMs(details: ErrorDetails) {
  const explicitDelay = parseMilliseconds(details.retryAfterMs);
  if (explicitDelay !== undefined) return explicitDelay;

  const retryAfter = parseRetryAfterSeconds(details.retryAfter);
  if (retryAfter !== undefined) return retryAfter;

  const headers = details.headers;
  const fromHeaders =
    typeof headers === "object" && headers !== null && "get" in headers &&
    typeof headers.get === "function"
      ? headers.get("retry-after")
      : typeof headers === "object" && headers !== null
        ? (headers as Record<string, unknown>)["retry-after"] ??
          (headers as Record<string, unknown>)["Retry-After"]
        : undefined;
  return parseRetryAfterSeconds(fromHeaders);
}

function isTransientNetworkFailure(details: ErrorDetails) {
  const code = typeof details.code === "string" ? details.code : "";
  if (
    [
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "EAI_AGAIN",
      "ENOTFOUND",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
    ].includes(code)
  ) {
    return true;
  }

  const name = typeof details.name === "string" ? details.name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;

  const message = typeof details.message === "string" ? details.message : "";
  return /connection reset|temporary dns|timed out|timeout/i.test(message);
}

export function classifyGenerationFailure(error: unknown): GenerationFailure {
  const details = errorDetails(error);
  const status = typeof details.status === "number" ? details.status : undefined;

  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) {
    const retryAfterMs = providerRetryAfterMs(details);
    return retryAfterMs === undefined
      ? { category: "transient" }
      : { category: "transient", retryAfterMs };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { category: "permanent" };
  }
  if (isTransientNetworkFailure(details)) {
    return { category: "transient" };
  }
  return { category: "unknown" };
}

export function nextGenerationAttemptAt({
  attemptCount,
  now,
  random,
  retryAfterMs,
}: RetryScheduleParams) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error("attemptCount must be a positive integer");
  }
  if (Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }

  const baseDelayMs = BASE_RETRY_DELAYS_MS[
    Math.min(attemptCount - 1, BASE_RETRY_DELAYS_MS.length - 1)
  ];
  const randomValue = random();
  if (!Number.isFinite(randomValue)) {
    throw new Error("random must return a finite number");
  }
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitteredDelayMs = Math.round(
    baseDelayMs * (0.8 + boundedRandom * 0.4)
  );
  const boundedRetryAfterMs = parseMilliseconds(retryAfterMs);
  const delayMs = Math.min(
    MAX_RETRY_AFTER_MS,
    Math.max(jitteredDelayMs, boundedRetryAfterMs ?? 0)
  );

  return new Date(now.getTime() + delayMs);
}
