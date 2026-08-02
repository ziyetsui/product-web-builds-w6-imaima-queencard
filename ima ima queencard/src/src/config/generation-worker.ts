export type GenerationWorkerConfig = Readonly<{
  enabled: boolean;
  workerConcurrency: number;
  globalConcurrency: number;
  userConcurrency: number;
  providerModelConcurrency: number;
  maxAttempts: number;
  leaseMs: number;
  heartbeatMs: number;
  providerTimeoutMs: number;
  pollMinMs: number;
  pollMaxMs: number;
  candidateBatch: number;
  rolloutPercent: number;
  recoveryIntervalMs: number;
}>;

const DEFAULTS = {
  enabled: false,
  workerConcurrency: 4,
  globalConcurrency: 4,
  userConcurrency: 1,
  providerModelConcurrency: 2,
  maxAttempts: 3,
  leaseMs: 120_000,
  heartbeatMs: 30_000,
  providerTimeoutMs: 300_000,
  pollMinMs: 1_000,
  pollMaxMs: 5_000,
  candidateBatch: 20,
  rolloutPercent: 0,
  recoveryIntervalMs: 30_000,
} as const;

function parseBoolean(value: string | undefined, field: string, fallback: boolean) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${field} must be true or false`);
}

function parseInteger(
  value: string | undefined,
  field: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} is outside its allowed range`);
  }
  return parsed;
}

export function loadGenerationWorkerConfig(
  env: Record<string, string | undefined> = process.env
): GenerationWorkerConfig {
  const config: GenerationWorkerConfig = {
    enabled: parseBoolean(
      env.GENERATION_WORKER_ENABLED,
      "enabled",
      DEFAULTS.enabled
    ),
    workerConcurrency: parseInteger(
      env.GENERATION_WORKER_CONCURRENCY,
      "workerConcurrency",
      DEFAULTS.workerConcurrency,
      1
    ),
    globalConcurrency: parseInteger(
      env.GENERATION_GLOBAL_CONCURRENCY,
      "globalConcurrency",
      DEFAULTS.globalConcurrency,
      1
    ),
    userConcurrency: parseInteger(
      env.GENERATION_USER_CONCURRENCY,
      "userConcurrency",
      DEFAULTS.userConcurrency,
      1
    ),
    providerModelConcurrency: parseInteger(
      env.GENERATION_PROVIDER_MODEL_CONCURRENCY,
      "providerModelConcurrency",
      DEFAULTS.providerModelConcurrency,
      1
    ),
    maxAttempts: parseInteger(
      env.GENERATION_TASK_MAX_ATTEMPTS,
      "maxAttempts",
      DEFAULTS.maxAttempts,
      1,
      3
    ),
    leaseMs: parseInteger(
      env.GENERATION_LEASE_MS,
      "leaseMs",
      DEFAULTS.leaseMs,
      1
    ),
    heartbeatMs: parseInteger(
      env.GENERATION_HEARTBEAT_MS,
      "heartbeatMs",
      DEFAULTS.heartbeatMs,
      1
    ),
    providerTimeoutMs: parseInteger(
      env.GENERATION_PROVIDER_TIMEOUT_MS,
      "providerTimeoutMs",
      DEFAULTS.providerTimeoutMs,
      1
    ),
    pollMinMs: parseInteger(
      env.GENERATION_QUEUE_POLL_MIN_MS,
      "pollMinMs",
      DEFAULTS.pollMinMs,
      1
    ),
    pollMaxMs: parseInteger(
      env.GENERATION_QUEUE_POLL_MAX_MS,
      "pollMaxMs",
      DEFAULTS.pollMaxMs,
      1
    ),
    candidateBatch: parseInteger(
      env.GENERATION_QUEUE_CANDIDATE_BATCH,
      "candidateBatch",
      DEFAULTS.candidateBatch,
      1
    ),
    rolloutPercent: parseInteger(
      env.GENERATION_ASYNC_ROLLOUT_PERCENT,
      "rolloutPercent",
      DEFAULTS.rolloutPercent,
      0,
      100
    ),
    recoveryIntervalMs: parseInteger(
      env.GENERATION_RECOVERY_INTERVAL_MS,
      "recoveryIntervalMs",
      DEFAULTS.recoveryIntervalMs,
      1
    ),
  };

  if (config.heartbeatMs > config.leaseMs / 3) {
    throw new Error("heartbeatMs must be at most one third of leaseMs");
  }
  if (config.pollMinMs > config.pollMaxMs) {
    throw new Error("pollMinMs must not exceed pollMaxMs");
  }
  if (config.userConcurrency > config.globalConcurrency) {
    throw new Error("userConcurrency must not exceed globalConcurrency");
  }
  if (config.providerModelConcurrency > config.globalConcurrency) {
    throw new Error(
      "providerModelConcurrency must not exceed globalConcurrency"
    );
  }

  return Object.freeze(config);
}
