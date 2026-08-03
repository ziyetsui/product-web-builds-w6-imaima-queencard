import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
} from "drizzle-orm";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import {
  db,
  generationConcurrencyLeases,
  generationTasks,
  type GenerationTask,
} from "@/db";
import {
  buildGenerationScopes,
  type GenerationFailure,
  type GenerationLeaseToken,
} from "@/services/generation-task-policy";

const RUNNABLE_STATUSES = ["queued", "retry_scheduled"] as const;

export type GenerationQueueDatabase = Pick<typeof db, "select" | "transaction">;

export type GenerationQueueOptions = Readonly<{
  onPermitContention?: (contention: {
    taskId: string;
    scopeKey: string;
  }) => void;
  onPermanentFailure?: (
    transaction: GenerationQueueTransaction,
    taskId: string
  ) => Promise<void>;
}>;

export type ClaimedGenerationTask = Readonly<{
  task: GenerationTask;
  lease: GenerationLeaseToken;
}>;

export type ClaimNextParams = Readonly<{
  workerId: string;
  now: Date;
  config: GenerationWorkerConfig;
}>;

export type GenerationQueueTransaction = Parameters<
  Parameters<GenerationQueueDatabase["transaction"]>[0]
>[0];

export type FinalizeGenerationTask = (
  transaction: GenerationQueueTransaction,
  task: GenerationTask
) => Promise<void>;

class PermitCapacityMiss extends Error {
  constructor(
    readonly taskId: string,
    readonly scopeKey: string
  ) {
    super(`No generation permit available for ${scopeKey}`);
    this.name = "PermitCapacityMiss";
  }
}

function assertClaimParams({ workerId, now, config }: ClaimNextParams) {
  if (!workerId.trim()) {
    throw new Error("workerId must not be empty");
  }
  if (Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }
  if (!Number.isSafeInteger(config.candidateBatch) || config.candidateBatch < 1) {
    throw new Error("candidateBatch must be a positive integer");
  }
  if (!Number.isSafeInteger(config.leaseMs) || config.leaseMs < 1) {
    throw new Error("leaseMs must be a positive integer");
  }
}

function scopeCapacities(
  task: Pick<GenerationTask, "userId" | "provider" | "providerModel">,
  config: GenerationWorkerConfig
) {
  return new Map<string, number>([
    ["global", config.globalConcurrency],
    [
      `provider:${task.provider}:${task.providerModel}`,
      config.providerModelConcurrency,
    ],
    [`user:${task.userId}`, config.userConcurrency],
  ]);
}

export function createGenerationQueue(
  database: GenerationQueueDatabase,
  options: GenerationQueueOptions = {}
) {
  return {
    async claimNext(
      params: ClaimNextParams
    ): Promise<ClaimedGenerationTask | null> {
      assertClaimParams(params);
      const { workerId, now, config } = params;
      const candidateRows = await database
        .select({ id: generationTasks.id })
        .from(generationTasks)
        .where(
          and(
            inArray(generationTasks.status, [...RUNNABLE_STATUSES]),
            lte(generationTasks.nextAttemptAt, now),
            lt(generationTasks.attemptCount, generationTasks.maxAttempts)
          )
        )
        .orderBy(
          desc(generationTasks.priority),
          asc(generationTasks.nextAttemptAt),
          asc(generationTasks.createdAt)
        )
        .limit(config.candidateBatch);

      for (const candidate of candidateRows) {
        try {
          const claimed = await database.transaction(async (transaction) => {
            const [task] = await transaction
              .select()
              .from(generationTasks)
              .where(
                and(
                  eq(generationTasks.id, candidate.id),
                  inArray(generationTasks.status, [...RUNNABLE_STATUSES]),
                  lte(generationTasks.nextAttemptAt, now),
                  lt(generationTasks.attemptCount, generationTasks.maxAttempts)
                )
              )
              .for("update", { skipLocked: true })
              .limit(1);

            if (!task) return null;

            const taskVersion = task.version + 1;
            const leaseExpiresAt = new Date(now.getTime() + config.leaseMs);
            const capacities = scopeCapacities(task, config);
            const scopes = buildGenerationScopes(task);

            for (const scopeKey of scopes) {
              const capacity = capacities.get(scopeKey);
              if (!capacity) {
                throw new Error(`Missing generation capacity for ${scopeKey}`);
              }

              let acquired = false;
              for (let slotNumber = 1; slotNumber <= capacity; slotNumber += 1) {
                const [permit] = await transaction
                  .insert(generationConcurrencyLeases)
                  .values({
                    scopeKey,
                    slotNumber,
                    taskId: task.id,
                    taskVersion,
                    leaseOwner: workerId,
                    expiresAt: leaseExpiresAt,
                    heartbeatAt: now,
                    acquiredAt: now,
                  })
                  .onConflictDoUpdate({
                    target: [
                      generationConcurrencyLeases.scopeKey,
                      generationConcurrencyLeases.slotNumber,
                    ],
                    set: {
                      taskId: task.id,
                      taskVersion,
                      leaseOwner: workerId,
                      expiresAt: leaseExpiresAt,
                      heartbeatAt: now,
                      acquiredAt: now,
                    },
                    setWhere: lte(generationConcurrencyLeases.expiresAt, now),
                  })
                  .returning({
                    slotNumber: generationConcurrencyLeases.slotNumber,
                  });

                if (permit) {
                  acquired = true;
                  break;
                }
              }

              if (!acquired) {
                throw new PermitCapacityMiss(task.id, scopeKey);
              }
            }

            const [claimedTask] = await transaction
              .update(generationTasks)
              .set({
                status: "running",
                version: taskVersion,
                attemptCount: task.attemptCount + 1,
                leaseOwner: workerId,
                leaseExpiresAt,
                heartbeatAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(generationTasks.id, task.id),
                  eq(generationTasks.version, task.version),
                  eq(generationTasks.status, task.status)
                )
              )
              .returning();

            if (!claimedTask) {
              throw new Error(`Locked generation task ${task.id} was not updated`);
            }

            return {
              task: claimedTask,
              lease: {
                taskId: claimedTask.id,
                taskVersion: claimedTask.version,
                leaseOwner: workerId,
                leaseExpiresAt,
              },
            } satisfies ClaimedGenerationTask;
          });

          if (claimed) return claimed;
        } catch (error) {
          if (!(error instanceof PermitCapacityMiss)) throw error;
          options.onPermitContention?.({
            taskId: error.taskId,
            scopeKey: error.scopeKey,
          });
        }
      }

      return null;
    },

    async renewLease(
      lease: GenerationLeaseToken,
      now: Date,
      leaseMs: number
    ): Promise<boolean> {
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return database.transaction(async (transaction) => {
        const [task] = await transaction
          .update(generationTasks)
          .set({ leaseExpiresAt, heartbeatAt: now, updatedAt: now })
          .where(validLeaseWhere(lease, now))
          .returning({ id: generationTasks.id });
        if (!task) return false;

        const permits = await transaction
          .update(generationConcurrencyLeases)
          .set({ expiresAt: leaseExpiresAt, heartbeatAt: now })
          .where(permitLeaseWhere(lease))
          .returning({ scopeKey: generationConcurrencyLeases.scopeKey });
        if (permits.length !== 3) {
          throw new Error(
            `Generation task ${lease.taskId} must hold exactly three permits`
          );
        }
        return true;
      });
    },

    async scheduleRetry(
      lease: GenerationLeaseToken,
      failure: GenerationFailure,
      nextAttemptAt: Date,
      now: Date,
      error?: unknown
    ): Promise<boolean> {
      return transitionFromRunning(database, lease, now, {
        status: "retry_scheduled",
        nextAttemptAt,
        failureCategory: failure.category,
        errorCode: errorCode(error),
        errorMessage: safeErrorMessage(error),
        lastErrorAt: now,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      });
    },

    async markPermanentFailure(
      lease: GenerationLeaseToken,
      failure: GenerationFailure,
      now: Date,
      error?: unknown
    ): Promise<boolean> {
      return transitionFromRunning(database, lease, now, {
        status: "permanently_failed",
        failureCategory: failure.category,
        errorCode: errorCode(error),
        errorMessage: safeErrorMessage(error),
        lastErrorAt: now,
        completedAt: now,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      }, options.onPermanentFailure
        ? (transaction) => options.onPermanentFailure!(transaction, lease.taskId)
        : undefined);
    },

    async withValidLeaseForFinalize(
      lease: GenerationLeaseToken,
      now: Date,
      finalize: FinalizeGenerationTask
    ): Promise<boolean> {
      return database.transaction(async (transaction) => {
        const [task] = await transaction
          .select()
          .from(generationTasks)
          .where(validLeaseWhere(lease, now))
          .for("update")
          .limit(1);
        if (!task) return false;

        await finalize(transaction, task);
        await transaction
          .delete(generationConcurrencyLeases)
          .where(permitLeaseWhere(lease));
        return true;
      });
    },

    async releasePermits(lease: GenerationLeaseToken): Promise<void> {
      await database.transaction(async (transaction) => {
        await transaction
          .delete(generationConcurrencyLeases)
          .where(permitLeaseWhere(lease));
      });
    },

    async recoverExpired(now: Date): Promise<number> {
      const expired = await database
        .select({ id: generationTasks.id })
        .from(generationTasks)
        .where(
          and(
            eq(generationTasks.status, "running"),
            lte(generationTasks.leaseExpiresAt, now)
          )
        )
        .orderBy(asc(generationTasks.leaseExpiresAt))
        .limit(100);

      let recovered = 0;
      for (const candidate of expired) {
        const didRecover = await database.transaction(async (transaction) => {
          const [task] = await transaction
            .select()
            .from(generationTasks)
            .where(
              and(
                eq(generationTasks.id, candidate.id),
                eq(generationTasks.status, "running"),
                lte(generationTasks.leaseExpiresAt, now)
              )
            )
            .for("update", { skipLocked: true })
            .limit(1);
          if (!task) return false;

          const exhausted = task.attemptCount >= task.maxAttempts;
          if (exhausted) {
            await options.onPermanentFailure?.(transaction, task.id);
          }
          await transaction
            .update(generationTasks)
            .set({
              status: exhausted ? "permanently_failed" : "retry_scheduled",
              version: task.version + 1,
              nextAttemptAt: now,
              failureCategory: "transient",
              errorCode: "LEASE_EXPIRED",
              errorMessage: "Generation worker lease expired",
              lastErrorAt: now,
              completedAt: exhausted ? now : null,
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(generationTasks.id, task.id),
                eq(generationTasks.version, task.version),
                eq(generationTasks.status, "running")
              )
            );
          await transaction
            .delete(generationConcurrencyLeases)
            .where(eq(generationConcurrencyLeases.taskId, task.id));
          return true;
        });
        if (didRecover) recovered += 1;
      }
      return recovered;
    },
  };
}

export type GenerationQueue = ReturnType<typeof createGenerationQueue>;

function validLeaseWhere(lease: GenerationLeaseToken, now: Date) {
  return and(
    eq(generationTasks.id, lease.taskId),
    eq(generationTasks.version, lease.taskVersion),
    eq(generationTasks.leaseOwner, lease.leaseOwner),
    eq(generationTasks.status, "running"),
    gt(generationTasks.leaseExpiresAt, now)
  );
}

function permitLeaseWhere(lease: GenerationLeaseToken) {
  return and(
    eq(generationConcurrencyLeases.taskId, lease.taskId),
    eq(generationConcurrencyLeases.taskVersion, lease.taskVersion),
    eq(generationConcurrencyLeases.leaseOwner, lease.leaseOwner)
  );
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Image generation failed";
  return error.message.slice(0, 1_000);
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length <= 120) return code;
  }
  return "PROVIDER_FAILED";
}

async function transitionFromRunning(
  database: GenerationQueueDatabase,
  lease: GenerationLeaseToken,
  now: Date,
  values: Partial<typeof generationTasks.$inferInsert>,
  beforeTransition?: (transaction: GenerationQueueTransaction) => Promise<void>
) {
  return database.transaction(async (transaction) => {
    const [task] = await transaction
      .update(generationTasks)
      .set(values)
      .where(validLeaseWhere(lease, now))
      .returning({ id: generationTasks.id });
    if (!task) return false;
    await beforeTransition?.(transaction);
    await transaction
      .delete(generationConcurrencyLeases)
      .where(permitLeaseWhere(lease));
    return true;
  });
}
