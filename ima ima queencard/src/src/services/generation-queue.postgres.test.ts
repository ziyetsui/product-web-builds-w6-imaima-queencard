// The shared Vitest setup dereferences window, so collection uses the project's
// default jsdom environment; the test body itself uses only Node PostgreSQL clients.

import { randomUUID } from "node:crypto";

import { and, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import {
  generationConcurrencyLeases,
  generationTasks,
} from "@/db/schema";
import * as schema from "@/db/schema";
import { createGenerationQueue } from "./generation-queue";

const explicitlySelected =
  process.env.RUN_GENERATION_QUEUE_POSTGRES_TESTS === "1" ||
  process.env.npm_lifecycle_event !== "test";
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function assertDisposableDatabaseUrl(value: string) {
  const parsed = new URL(value);
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!isLocal || !databaseName.includes("test")) {
    throw new Error(
      "Generation queue PostgreSQL tests require a local database whose name contains 'test'"
    );
  }
}

if (explicitlySelected && !testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required when generation-queue.postgres.test.ts is explicitly selected"
  );
}
if (explicitlySelected && testDatabaseUrl) {
  assertDisposableDatabaseUrl(testDatabaseUrl);
}

const describePostgres = explicitlySelected && testDatabaseUrl
  ? describe
  : describe.skip;
const NOW = new Date("2099-08-02T00:00:00.000Z");
const config: GenerationWorkerConfig = {
  enabled: true,
  workerConcurrency: 8,
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

describePostgres("generation queue PostgreSQL contention", () => {
  const clients: postgres.Sql[] = [];
  const taskIds = new Set<string>();
  const permitTaskIds = new Set<string>();
  let fixtureDatabase: ReturnType<typeof createDatabase>;

  function createDatabase() {
    const client = postgres(testDatabaseUrl!, {
      max: 1,
      idle_timeout: 5,
    });
    clients.push(client);
    return drizzle(client, { schema });
  }

  function nextId(label: string) {
    return `task4_${label}_${randomUUID()}`;
  }

  async function insertTask(
    label: string,
    overrides: Partial<typeof generationTasks.$inferInsert> = {}
  ) {
    const id = nextId(label);
    taskIds.add(id);
    await fixtureDatabase.insert(generationTasks).values({
      id,
      userId: `user_${label}`,
      prompt: `fixture ${label}`,
      model: "gpt-image-2-edit",
      provider: "gptproto",
      providerModel: "gpt-image-2",
      capability: "image-edit",
      status: "queued",
      priority: 0,
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date("2099-08-01T00:00:00.000Z"),
      createdAt: new Date("2099-08-01T00:00:00.000Z"),
      updatedAt: new Date("2099-08-01T00:00:00.000Z"),
      ...overrides,
    });
    return id;
  }

  beforeAll(() => {
    fixtureDatabase = createDatabase();
  });

  afterEach(async () => {
    const leaseIds = [...new Set([...taskIds, ...permitTaskIds])];
    if (leaseIds.length > 0) {
      await fixtureDatabase
        .delete(generationConcurrencyLeases)
        .where(inArray(generationConcurrencyLeases.taskId, leaseIds));
    }
    if (taskIds.size > 0) {
      await fixtureDatabase
        .delete(generationTasks)
        .where(inArray(generationTasks.id, [...taskIds]));
    }
    taskIds.clear();
    permitTaskIds.clear();
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
  });

  it("allows exactly one of eight independent clients to claim one queued task", async () => {
    const taskId = await insertTask("contended", { userId: "user_contended" });
    const claimDatabases = Array.from({ length: 8 }, () => createDatabase());

    const claims = await Promise.all(
      claimDatabases.map((database, index) =>
        createGenerationQueue(database).claimNext({
          workerId: `worker_${index + 1}`,
          now: NOW,
          config,
        })
      )
    );

    const successfulClaims = claims.filter((claim) => claim !== null);
    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]).toMatchObject({
      task: {
        id: taskId,
        status: "running",
        version: 1,
        attemptCount: 1,
      },
      lease: {
        taskId,
        taskVersion: 1,
      },
    });

    const activePermits = await fixtureDatabase
      .select()
      .from(generationConcurrencyLeases)
      .where(
        and(
          eq(generationConcurrencyLeases.taskId, taskId),
          gt(generationConcurrencyLeases.expiresAt, NOW)
        )
      );
    expect(activePermits).toHaveLength(3);
    expect(activePermits.map((permit) => permit.scopeKey).sort()).toEqual([
      "global",
      "provider:gptproto:gpt-image-2",
      "user:user_contended",
    ]);
  });

  it("skips a task whose user scope is full and claims a later user's task", async () => {
    const blockedUserId = "user_full";
    const availableUserId = "user_available";
    const blockedTaskId = await insertTask("blocked", {
      userId: blockedUserId,
      priority: 10,
    });
    const availableTaskId = await insertTask("available", {
      userId: availableUserId,
      priority: 5,
      createdAt: new Date("2099-08-01T00:01:00.000Z"),
    });
    const blockerTaskId = nextId("permit_blocker");
    permitTaskIds.add(blockerTaskId);
    await fixtureDatabase.insert(generationConcurrencyLeases).values({
      scopeKey: `user:${blockedUserId}`,
      slotNumber: 1,
      taskId: blockerTaskId,
      taskVersion: 1,
      leaseOwner: "worker_blocker",
      expiresAt: new Date("2099-08-02T00:05:00.000Z"),
      heartbeatAt: NOW,
      acquiredAt: NOW,
    });

    const claimed = await createGenerationQueue(createDatabase()).claimNext({
      workerId: "worker_available",
      now: NOW,
      config,
    });

    expect(claimed?.task.id).toBe(availableTaskId);
    const [blockedTask, availableTask] = await Promise.all([
      fixtureDatabase
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, blockedTaskId)),
      fixtureDatabase
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, availableTaskId)),
    ]);
    expect(blockedTask[0]).toMatchObject({
      status: "queued",
      version: 0,
      attemptCount: 0,
      leaseOwner: null,
    });
    expect(availableTask[0]).toMatchObject({
      status: "running",
      version: 1,
      attemptCount: 1,
      leaseOwner: "worker_available",
    });

    const blockedTaskPermits = await fixtureDatabase
      .select()
      .from(generationConcurrencyLeases)
      .where(eq(generationConcurrencyLeases.taskId, blockedTaskId));
    const availableTaskPermits = await fixtureDatabase
      .select()
      .from(generationConcurrencyLeases)
      .where(eq(generationConcurrencyLeases.taskId, availableTaskId));
    expect(blockedTaskPermits).toEqual([]);
    expect(availableTaskPermits).toHaveLength(3);
  });
});
