import {
  and,
  asc,
  desc,
  eq,
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
  type GenerationLeaseToken,
} from "@/services/generation-task-policy";

const RUNNABLE_STATUSES = ["queued", "retry_scheduled"] as const;

export type GenerationQueueDatabase = Pick<typeof db, "select" | "transaction">;

export type GenerationQueueOptions = Readonly<{
  onPermitContention?: (contention: {
    taskId: string;
    scopeKey: string;
  }) => void;
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
  };
}
