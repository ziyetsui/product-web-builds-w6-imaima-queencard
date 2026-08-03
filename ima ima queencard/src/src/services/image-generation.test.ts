/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  creditService: {
    freezeInTx: vi.fn(),
  },
  loadGenerationWorkerConfig: vi.fn(() => ({ maxAttempts: 3 })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  asc: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  })),
  ilike: vi.fn(),
  inArray: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/config/generation-worker", () => ({
  loadGenerationWorkerConfig: mocks.loadGenerationWorkerConfig,
}));

vi.mock("@/db", () => ({
  db: mocks.db,
  generatedAssets: {},
  generationTasks: {
    id: "generationTasks.id",
    userId: "generationTasks.userId",
    idempotencyKey: "generationTasks.idempotencyKey",
  },
}));

vi.mock("@/services/image-provider", () => ({
  generateImageWithCredits: vi.fn(),
}));

vi.mock("@/services/credit", () => ({
  creditService: mocks.creditService,
}));

import {
  createImageGenerationTask,
  estimateImageGeneration,
} from "./image-generation";

function validInput(idempotencyKey?: string, prompt = "make a poster") {
  return {
    idempotencyKey,
    prompt,
    model: "gpt-image-2-edit",
    referenceImages: ["https://example.com/reference.png"],
    outputCount: 1,
  };
}

function taskFromInsert(values: Record<string, unknown>) {
  return {
    settledCredits: 0,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    createdAt: new Date(),
    ...values,
  };
}

function comparisonValue(condition: any, column: string) {
  const comparisons = condition?.type === "and"
    ? condition.conditions
    : [condition];
  return comparisons.find((item: any) => item?.column === column)?.value;
}

function transactionalDb() {
  let committedTasks: any[] = [];
  let committedHolds: any[] = [];

  mocks.creditService.freezeInTx.mockImplementation(
    async (trx: any, params: Record<string, unknown>) => {
      trx.pendingHolds.push(params);
      return { success: true, holdId: trx.pendingHolds.length };
    }
  );

  mocks.db.transaction.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
    const trx = {
      pendingTasks: [...committedTasks],
      pendingHolds: [...committedHolds],
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => ({
            limit: vi.fn(async () => {
              const userId = comparisonValue(
                condition,
                "generationTasks.userId"
              );
              const idempotencyKey = comparisonValue(
                condition,
                "generationTasks.idempotencyKey"
              );
              const task = trx.pendingTasks.find(
                (candidate: any) =>
                  candidate.userId === userId &&
                  candidate.idempotencyKey === idempotencyKey
              );
              return task ? [task] : [];
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            const task = taskFromInsert(values);
            trx.pendingTasks.push(task);
            return [task];
          }),
        })),
      })),
    };

    const result = await callback(trx);
    committedTasks = trx.pendingTasks;
    committedHolds = trx.pendingHolds;
    return result;
  });

  return {
    tasks: () => committedTasks,
    holds: () => committedHolds,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function overlappingIdempotencyDb(concurrency: number) {
  const committedTasks: any[] = [];
  const committedHolds: any[] = [];
  let initialLookupCount = 0;
  let transactionId = 0;
  const allInitialLookups = deferred();
  const claims = new Map<
    string,
    { ownerId: number; committed: Promise<void>; resolve: () => void }
  >();

  mocks.creditService.freezeInTx.mockImplementation(
    async (trx: any, params: Record<string, unknown>) => {
      trx.pendingHolds.push(params);
      return { success: true, holdId: 1 };
    }
  );

  mocks.db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: unknown) => ({
        limit: vi.fn(async () => {
          const userId = comparisonValue(condition, "generationTasks.userId");
          const idempotencyKey = comparisonValue(
            condition,
            "generationTasks.idempotencyKey"
          );
          const task = committedTasks.find(
            (candidate) =>
              candidate.userId === userId &&
              candidate.idempotencyKey === idempotencyKey
          );
          return task ? [task] : [];
        }),
      })),
    })),
  }));

  mocks.db.transaction.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
    const id = transactionId++;
    let stagedTask: any = null;
    let ownedClaim: { committed: Promise<void>; resolve: () => void } | null = null;
    const trx = {
      pendingHolds: [] as any[],
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              initialLookupCount += 1;
              if (initialLookupCount === concurrency) allInitialLookups.resolve();
              await allInitialLookups.promise;
              return [];
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            const claimKey = `${values.userId}:${values.idempotencyKey}`;
            const existingClaim = claims.get(claimKey);
            if (existingClaim) {
              await existingClaim.committed;
              throw Object.assign(new Error("duplicate key"), {
                code: "23505",
                constraint: "generation_tasks_user_id_idempotency_key_idx",
              });
            }

            const claim = deferred();
            claims.set(claimKey, {
              ownerId: id,
              committed: claim.promise,
              resolve: claim.resolve,
            });
            ownedClaim = {
              committed: claim.promise,
              resolve: claim.resolve,
            };
            stagedTask = taskFromInsert(values);
            return [stagedTask];
          }),
        })),
      })),
    };

    try {
      const result = await callback(trx);
      if (stagedTask) committedTasks.push(stagedTask);
      committedHolds.push(...trx.pendingHolds);
      ownedClaim?.resolve();
      return result;
    } catch (error) {
      ownedClaim?.resolve();
      throw error;
    }
  });

  return {
    tasks: () => committedTasks,
    holds: () => committedHolds,
    initialLookups: () => initialLookupCount,
  };
}

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

describe("image generation validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadGenerationWorkerConfig.mockReturnValue({ maxAttempts: 3 });
  });

  it("rejects disabled legacy image models", () => {
    expect(() =>
      estimateImageGeneration({
        prompt: "make a poster",
        model: "kling-image-o1-i2i",
        referenceImages: ["https://example.com/reference.png"],
      })
    ).toThrow(ApiError);
  });

  it("estimates enabled Vidu Q2 resolution tiers", () => {
    expect(
      estimateImageGeneration({
        prompt: "make a poster",
        model: "viduq2-i2i",
        referenceImages: ["https://example.com/reference.png"],
        resolution: "4k",
        outputCount: 2,
      })
    ).toMatchObject({
      estimatedCredits: 7,
      modelCreditsPerImage: 7,
      model: "viduq2-i2i",
      capability: "image-to-image",
    });
  });

  it("rejects no-reference image generation", () => {
    expect(() =>
      estimateImageGeneration({
        prompt: "make a poster",
        model: "doubao-seedream-5-edit",
        outputCount: 4,
      })
    ).toThrow(ApiError);
  });
});

describe("idempotent image generation enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadGenerationWorkerConfig.mockReturnValue({ maxAttempts: 3 });
  });

  it("converges ten concurrent same-user requests to one task and one hold", async () => {
    const state = overlappingIdempotencyDb(10);

    const tasks = await Promise.all(
      Array.from({ length: 10 }, () =>
        createImageGenerationTask("user_1", validInput("request_123"))
      )
    );

    expect(new Set(tasks.map((task) => task.taskId))).toEqual(
      new Set([tasks[0].taskId])
    );
    expect(mocks.creditService.freezeInTx).toHaveBeenCalledTimes(1);
    expect(state.initialLookups()).toBe(10);
    expect(state.tasks()).toHaveLength(1);
    expect(state.holds()).toHaveLength(1);
    expect(state.tasks()[0].creditHoldKey).toBe(state.tasks()[0].id);
    expect(state.holds()[0].videoUuid).toBe(state.tasks()[0].id);
  });

  it("rolls back the claimed task when credit freezing fails", async () => {
    const state = transactionalDb();
    mocks.creditService.freezeInTx.mockRejectedValue(new Error("freeze failed"));

    await expect(
      createImageGenerationTask("user_1", validInput("request_123"))
    ).rejects.toThrow("freeze failed");

    expect(mocks.creditService.freezeInTx).toHaveBeenCalledTimes(1);
    expect(state.tasks()).toEqual([]);
    expect(state.holds()).toEqual([]);
  });

  it("normalizes keys, validates their length, and isolates them by user", async () => {
    const state = transactionalDb();

    await expect(
      createImageGenerationTask("user_1", validInput("  request_123  "))
    ).resolves.toBeDefined();
    await expect(
      createImageGenerationTask("user_2", validInput("request_123"))
    ).resolves.toBeDefined();

    expect(state.tasks()).toHaveLength(2);
    expect(state.tasks().map((task) => task.idempotencyKey)).toEqual([
      "request_123",
      "request_123",
    ]);
    expect(mocks.creditService.freezeInTx).toHaveBeenCalledTimes(2);
    await expect(
      createImageGenerationTask("user_1", validInput("1234567"))
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      createImageGenerationTask("user_1", validInput("x".repeat(121)))
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("reuses an existing task without comparing prompt text", async () => {
    transactionalDb();

    const first = await createImageGenerationTask(
      "user_1",
      validInput("request_123", "first prompt")
    );
    const second = await createImageGenerationTask(
      "user_1",
      validInput("request_123", "completely different prompt")
    );

    expect(second.taskId).toBe(first.taskId);
    expect(second.prompt).toBe("first prompt");
    expect(mocks.creditService.freezeInTx).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the idempotency constraint loses a unique-key race", async () => {
    const existing = taskFromInsert({
      ...validInput("request_123"),
      id: "gen_existing",
      userId: "user_1",
      status: "queued",
      source: "manual",
      sourceCaseId: null,
      sourceCaseCategory: null,
      providerModel: "gpt-image-2",
      capability: "image-edit",
      aspectRatio: "3:4",
      resolution: "auto",
      requestedCredits: 1,
      creditHoldKey: "gen_existing",
    });
    const conflict = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "generation_tasks_user_id_idempotency_key_idx",
    });
    mocks.db.transaction.mockRejectedValue(conflict);
    mocks.db.select.mockReturnValue(selectRows([existing]));

    await expect(
      createImageGenerationTask("user_1", validInput("request_123"))
    ).resolves.toMatchObject({ taskId: "gen_existing" });
  });

  it("does not swallow unrelated database errors", async () => {
    const unrelated = Object.assign(new Error("duplicate task id"), {
      code: "23505",
      constraint: "generation_tasks_pkey",
    });
    mocks.db.transaction.mockRejectedValue(unrelated);

    await expect(
      createImageGenerationTask("user_1", validInput("request_123"))
    ).rejects.toBe(unrelated);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("stores the configured maximum attempts and initial schedule", async () => {
    const state = transactionalDb();
    mocks.loadGenerationWorkerConfig.mockReturnValue({ maxAttempts: 2 });

    await createImageGenerationTask("user_1", validInput("request_123"));

    expect(state.tasks()[0]).toMatchObject({
      maxAttempts: 2,
      creditHoldKey: state.tasks()[0].id,
    });
    expect(state.tasks()[0].nextAttemptAt).toBeInstanceOf(Date);
  });

  it("creates independent atomic tasks when no idempotency key is supplied", async () => {
    const state = transactionalDb();

    const first = await createImageGenerationTask("user_1", validInput());
    const second = await createImageGenerationTask("user_1", validInput());

    expect(first.taskId).not.toBe(second.taskId);
    expect(state.tasks()).toHaveLength(2);
    expect(state.tasks().map((task) => task.idempotencyKey)).toEqual([
      null,
      null,
    ]);
    expect(mocks.creditService.freezeInTx).toHaveBeenCalledTimes(2);
  });
});
