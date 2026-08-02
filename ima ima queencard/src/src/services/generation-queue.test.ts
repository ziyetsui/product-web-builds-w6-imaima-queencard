import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import {
  createGenerationQueue,
  type GenerationQueueDatabase,
} from "./generation-queue";

const NOW = new Date("2026-08-02T00:00:00.000Z");
const dialect = new PgDialect();

const approvedConfig: GenerationWorkerConfig = {
  enabled: true,
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
  rolloutPercent: 100,
  recoveryIntervalMs: 30_000,
};

type FakeTask = {
  id: string;
  userId: string;
  provider: string;
  providerModel: string;
  status: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  [key: string]: unknown;
};

type FakePermit = {
  scopeKey: string;
  slotNumber: number;
  taskId: string;
  taskVersion: number;
  leaseOwner: string;
  expiresAt: Date;
  heartbeatAt: Date;
  acquiredAt: Date;
};

function task(
  id: string,
  overrides: Partial<FakeTask> = {}
): FakeTask {
  const createdAt = new Date("2026-08-01T00:00:00.000Z");
  return {
    id,
    userId: "user_1",
    provider: "gptproto",
    providerModel: "gpt-image-2",
    status: "queued",
    priority: 0,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: new Date("2026-08-01T00:00:00.000Z"),
    version: 0,
    createdAt,
    updatedAt: createdAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    ...overrides,
  };
}

function permit(
  scopeKey: string,
  slotNumber: number,
  overrides: Partial<FakePermit> = {}
): FakePermit {
  return {
    scopeKey,
    slotNumber,
    taskId: `blocker_${scopeKey}_${slotNumber}`,
    taskVersion: 1,
    leaseOwner: "worker_blocker",
    expiresAt: new Date("2026-08-02T00:05:00.000Z"),
    heartbeatAt: NOW,
    acquiredAt: NOW,
    ...overrides,
  };
}

function compiledSql(fragment: SQL) {
  return dialect.sqlToQuery(sql`${fragment}`).sql;
}

function conditionTaskId(condition: SQL, tasks: FakeTask[]) {
  const query = dialect.sqlToQuery(condition);
  return query.params.find(
    (value) =>
      typeof value === "string" && tasks.some((task) => task.id === value)
  ) as string | undefined;
}

function compareCandidates(orderBy: SQL[], left: FakeTask, right: FakeTask) {
  for (const expression of orderBy) {
    const text = compiledSql(expression);
    const descending = /\sdesc$/i.test(text);
    const direction = descending ? -1 : 1;
    let comparison = 0;

    if (text.includes('"priority"')) {
      comparison = left.priority - right.priority;
    } else if (text.includes('"next_attempt_at"')) {
      comparison = left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime();
    } else if (text.includes('"created_at"')) {
      comparison = left.createdAt.getTime() - right.createdAt.getTime();
    }

    if (comparison !== 0) return comparison * direction;
  }
  return 0;
}

class FakeGenerationQueueDatabase {
  private tasksState: FakeTask[];
  private permitsState: FakePermit[];

  readonly candidateOrderBy: string[] = [];
  readonly lockAttempts: Array<{
    taskId: string;
    strength: string;
    skipLocked: boolean;
  }> = [];
  readonly permitAttempts: string[] = [];

  constructor(tasks: FakeTask[], permits: FakePermit[] = []) {
    this.tasksState = structuredClone(tasks);
    this.permitsState = structuredClone(permits);
  }

  select() {
    return {
      from: () => ({
        where: () => ({
          orderBy: (...orderBy: SQL[]) => ({
            limit: async (limit: number) => {
              this.candidateOrderBy.splice(
                0,
                this.candidateOrderBy.length,
                ...orderBy.map(compiledSql)
              );
              return this.tasksState
                .filter(
                  (candidate) =>
                    ["queued", "retry_scheduled"].includes(candidate.status) &&
                    candidate.nextAttemptAt <= NOW &&
                    candidate.attemptCount < candidate.maxAttempts
                )
                .sort((left, right) =>
                  compareCandidates(orderBy, left, right)
                )
                .slice(0, limit)
                .map(({ id }) => ({ id }));
            },
          }),
        }),
      }),
    };
  }

  async transaction<T>(callback: (transaction: any) => Promise<T>) {
    const stagedTasks = structuredClone(this.tasksState);
    const stagedPermits = structuredClone(this.permitsState);
    const transaction = {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => ({
            for: (strength: string, options: { skipLocked?: boolean }) => ({
              limit: async () => {
                const taskId = conditionTaskId(condition, stagedTasks);
                if (!taskId) return [];
                this.lockAttempts.push({
                  taskId,
                  strength,
                  skipLocked: options.skipLocked === true,
                });
                const candidate = stagedTasks.find(
                  (item) =>
                    item.id === taskId &&
                    ["queued", "retry_scheduled"].includes(item.status) &&
                    item.nextAttemptAt <= NOW &&
                    item.attemptCount < item.maxAttempts
                );
                return candidate ? [structuredClone(candidate)] : [];
              },
            }),
          }),
        }),
      }),
      insert: () => ({
        values: (values: FakePermit) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              this.permitAttempts.push(values.scopeKey);
              const existingIndex = stagedPermits.findIndex(
                (item) =>
                  item.scopeKey === values.scopeKey &&
                  item.slotNumber === values.slotNumber
              );
              const existing = stagedPermits[existingIndex];
              if (existing && existing.expiresAt > values.heartbeatAt) {
                return [];
              }

              if (existingIndex === -1) stagedPermits.push(structuredClone(values));
              else stagedPermits[existingIndex] = structuredClone(values);
              return [{ slotNumber: values.slotNumber }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (updates: Partial<FakeTask>) => ({
          where: (condition: SQL) => ({
            returning: async () => {
              const taskId = conditionTaskId(condition, stagedTasks);
              const existing = stagedTasks.find((item) => item.id === taskId);
              if (!existing) return [];
              Object.assign(existing, structuredClone(updates));
              return [structuredClone(existing)];
            },
          }),
        }),
      }),
    };

    const result = await callback(transaction);
    this.tasksState = stagedTasks;
    this.permitsState = stagedPermits;
    return result;
  }

  generationTask(taskId: string) {
    return structuredClone(this.tasksState.find((task) => task.id === taskId));
  }

  activeScopes(taskId: string) {
    return this.permitsState
      .filter((lease) => lease.taskId === taskId && lease.expiresAt > NOW)
      .map((lease) => lease.scopeKey)
      .sort();
  }

  activePermits(taskId: string) {
    return this.permitsState
      .filter((lease) => lease.taskId === taskId && lease.expiresAt > NOW)
      .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey));
  }
}

function queueFor(fake: FakeGenerationQueueDatabase) {
  return createGenerationQueue(fake as unknown as GenerationQueueDatabase);
}

describe("generation queue claim", () => {
  it("orders candidates by priority DESC, next attempt ASC, then creation ASC", async () => {
    const fake = new FakeGenerationQueueDatabase([
      task("gen_low", { priority: 1 }),
      task("gen_later_attempt", {
        priority: 5,
        nextAttemptAt: new Date("2026-08-01T12:00:00.000Z"),
      }),
      task("gen_newer", {
        priority: 5,
        createdAt: new Date("2026-08-01T01:00:00.000Z"),
      }),
      task("gen_expected", { priority: 5 }),
    ]);

    const claimed = await queueFor(fake).claimNext({
      workerId: "worker_a",
      now: NOW,
      config: approvedConfig,
    });

    expect(claimed?.task.id).toBe("gen_expected");
    expect(fake.candidateOrderBy).toEqual([
      '"generation_tasks"."priority" desc',
      '"generation_tasks"."next_attempt_at" asc',
      '"generation_tasks"."created_at" asc',
    ]);
  });

  it("builds the exact three sorted scopes and uses each configured capacity", async () => {
    const fake = new FakeGenerationQueueDatabase(
      [task("gen_1")],
      [
        permit("global", 1),
        permit("provider:gptproto:gpt-image-2", 1),
        permit("user:user_1", 1),
      ]
    );
    const config = {
      ...approvedConfig,
      globalConcurrency: 2,
      providerModelConcurrency: 2,
      userConcurrency: 2,
    };

    const claimed = await queueFor(fake).claimNext({
      workerId: "worker_a",
      now: NOW,
      config,
    });

    expect(claimed?.task.id).toBe("gen_1");
    expect(fake.activeScopes("gen_1")).toEqual([
      "global",
      "provider:gptproto:gpt-image-2",
      "user:user_1",
    ]);
    expect(fake.activePermits("gen_1").map((lease) => lease.slotNumber)).toEqual([
      2,
      2,
      2,
    ]);
    expect(fake.permitAttempts).toEqual([
      "global",
      "global",
      "provider:gptproto:gpt-image-2",
      "provider:gptproto:gpt-image-2",
      "user:user_1",
      "user:user_1",
    ]);
  });

  it("rolls back the first permit and task mutation when the second scope is full", async () => {
    const fake = new FakeGenerationQueueDatabase(
      [task("gen_1")],
      [permit("provider:gptproto:gpt-image-2", 1)]
    );
    const config = {
      ...approvedConfig,
      globalConcurrency: 1,
      providerModelConcurrency: 1,
      userConcurrency: 1,
    };

    await expect(
      queueFor(fake).claimNext({
        workerId: "worker_a",
        now: NOW,
        config,
      })
    ).resolves.toBeNull();

    expect(fake.activeScopes("gen_1")).toEqual([]);
    expect(fake.generationTask("gen_1")).toMatchObject({
      status: "queued",
      version: 0,
      attemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    });
  });

  it("claims a task with version one, attempt one, and three matching permits", async () => {
    const fake = new FakeGenerationQueueDatabase([task("gen_1")]);

    const claimed = await queueFor(fake).claimNext({
      workerId: "worker_a",
      now: NOW,
      config: approvedConfig,
    });

    expect(claimed).toMatchObject({
      task: {
        id: "gen_1",
        status: "running",
        version: 1,
        attemptCount: 1,
        leaseOwner: "worker_a",
        heartbeatAt: NOW,
      },
      lease: {
        taskId: "gen_1",
        taskVersion: 1,
        leaseOwner: "worker_a",
        leaseExpiresAt: new Date("2026-08-02T00:02:00.000Z"),
      },
    });
    expect(fake.activeScopes("gen_1")).toEqual([
      "global",
      "provider:gptproto:gpt-image-2",
      "user:user_1",
    ]);
    expect(fake.activePermits("gen_1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskVersion: 1,
          leaseOwner: "worker_a",
          expiresAt: new Date("2026-08-02T00:02:00.000Z"),
          heartbeatAt: NOW,
          acquiredAt: NOW,
        }),
      ])
    );
    expect(fake.lockAttempts).toEqual([
      { taskId: "gen_1", strength: "update", skipLocked: true },
    ]);
  });
});
