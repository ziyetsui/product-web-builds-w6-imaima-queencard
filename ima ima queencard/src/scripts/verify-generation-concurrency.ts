import { randomUUID } from "node:crypto";

import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { calculateModelCredits } from "../src/config/credits";
import type { GenerationWorkerConfig } from "../src/config/generation-worker";
import {
  creditHolds,
  creditPackages,
  creditTransactions,
  generatedAssets,
  generationConcurrencyLeases,
  generationTasks,
} from "../src/db/schema";
import * as schema from "../src/db/schema";
import { createGenerationQueue } from "../src/services/generation-queue";
import { creditService } from "../src/services/credit";
import { createGenerationTaskExecutor } from "../src/services/generation-task-executor";
import { createGenerationObservability } from "../src/services/generation-observability";
import { createGenerationWorker } from "../src/workers/generation-worker";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "").toLowerCase();
if (
  !["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname) ||
  !databaseName.includes("test")
) {
  throw new Error("Verification requires a local disposable database containing 'test' in its name");
}

const taskCount = Number(process.env.GENERATION_VERIFY_TASK_COUNT ?? 1_000);
if (!Number.isSafeInteger(taskCount) || taskCount < 1 || taskCount > 10_000) {
  throw new Error("GENERATION_VERIFY_TASK_COUNT must be between 1 and 10000");
}

const client = postgres(databaseUrl, { max: 24, idle_timeout: 5 });
const database = drizzle(client, { schema });
const runId = `verify_${randomUUID().replaceAll("-", "")}`;
const userCount = 8;
const taskIds = Array.from({ length: taskCount }, (_, index) => `${runId}_task_${index}`);
const userIds = Array.from({ length: userCount }, (_, index) => `${runId}_user_${index}`);
const creditsPerTask = calculateModelCredits("gpt-image-2-edit", {
  outputNumber: 1,
  resolution: "1k",
  referenceImageCount: 1,
});
const config: GenerationWorkerConfig = {
  enabled: true,
  workerConcurrency: 4,
  globalConcurrency: 4,
  userConcurrency: 1,
  providerModelConcurrency: 2,
  maxAttempts: 3,
  leaseMs: 120_000,
  heartbeatMs: 30_000,
  providerTimeoutMs: 300_000,
  pollMinMs: 5,
  pollMaxMs: 25,
  candidateBatch: 50,
  rolloutPercent: 100,
  recoveryIntervalMs: 30_000,
};

let globalActive = 0;
let globalPeak = 0;
const userActive = new Map<string, number>();
const userPeaks = new Map<string, number>();
const providerActive = new Map<string, number>();
const providerPeaks = new Map<string, number>();
const submittedAt = Date.now();
const claimLatencies: number[] = [];
const runnableWaits: number[] = [];
const workers: ReturnType<typeof createGenerationWorker>[] = [];

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

try {
  const packageIds = new Map<string, number>();
  for (const userId of userIds) {
    const userTaskCount = taskIds.filter((_, index) => index % userCount === userIds.indexOf(userId)).length;
    const totalCredits = userTaskCount * creditsPerTask;
    const [creditPackage] = await database
      .insert(creditPackages)
      .values({
        userId,
        initialCredits: totalCredits,
        remainingCredits: 0,
        frozenCredits: totalCredits,
        transType: "SYSTEM_ADJUST",
        orderNo: runId,
        status: "ACTIVE",
        updatedAt: new Date(),
      })
      .returning({ id: creditPackages.id });
    packageIds.set(userId, creditPackage!.id);
  }

  for (let start = 0; start < taskCount; start += 250) {
    const slice = taskIds.slice(start, start + 250);
    await database.insert(generationTasks).values(
      slice.map((id, offset) => {
        const index = start + offset;
        const userId = userIds[index % userCount];
        return {
          id,
          userId,
          prompt: "verification fixture",
          referenceImages: ["https://example.com/reference.png"],
          model: "gpt-image-2-edit",
          provider: "gptproto",
          providerModel: index % 2 === 0 ? "gpt-image-2" : "seedream-5",
          capability: "image-edit",
          outputCount: 1,
          requestedCredits: creditsPerTask,
          creditHoldKey: id,
          status: "queued",
          nextAttemptAt: new Date(),
          maxAttempts: 3,
        };
      })
    );
    await database.insert(creditHolds).values(
      slice.map((id, offset) => {
        const index = start + offset;
        const userId = userIds[index % userCount];
        return {
          userId,
          videoUuid: id,
          credits: creditsPerTask,
          status: "HOLDING",
          packageAllocation: [{ packageId: packageIds.get(userId)!, credits: creditsPerTask }],
        };
      })
    );
  }

  const generate = async (input: { prompt: string }) => {
    const taskIndex = Number(input.prompt.split(":").at(-1));
    const userId = userIds[taskIndex % userCount];
    const providerKey = taskIndex % 2 === 0
      ? "gptproto:gpt-image-2"
      : "gptproto:seedream-5";
    globalActive += 1;
    globalPeak = Math.max(globalPeak, globalActive);
    userActive.set(userId, (userActive.get(userId) ?? 0) + 1);
    userPeaks.set(userId, Math.max(userPeaks.get(userId) ?? 0, userActive.get(userId)!));
    providerActive.set(providerKey, (providerActive.get(providerKey) ?? 0) + 1);
    providerPeaks.set(providerKey, Math.max(providerPeaks.get(providerKey) ?? 0, providerActive.get(providerKey)!));
    runnableWaits.push(Date.now() - submittedAt);
    await new Promise((resolve) => setTimeout(resolve, 2));
    globalActive -= 1;
    userActive.set(userId, userActive.get(userId)! - 1);
    providerActive.set(providerKey, providerActive.get(providerKey)! - 1);
    return {
      provider: "gptproto" as const,
      model: "gpt-image-2",
      images: [{ url: `https://example.com/${taskIndex}.png` }],
      raw: { id: `${runId}_provider_${taskIndex}` },
    };
  };

  // Give every task a stable index that the fake provider can use for independent measurements.
  await Promise.all(taskIds.map((id, index) =>
    database.update(generationTasks).set({ prompt: `verification:${index}` }).where(eq(generationTasks.id, id))
  ));

  for (let index = 0; index < 8; index += 1) {
    const durableQueue = createGenerationQueue(database, {
      onPermanentFailure(transaction, taskId) {
        return creditService.releaseInTx(transaction, taskId);
      },
    });
    const queue = {
      ...durableQueue,
      async claimNext(params: Parameters<typeof durableQueue.claimNext>[0]) {
        const started = performance.now();
        const claimed = await durableQueue.claimNext(params);
        if (claimed) claimLatencies.push(performance.now() - started);
        return claimed;
      },
    };
    const executor = createGenerationTaskExecutor({ queue, config, generate });
    const worker = createGenerationWorker({
      queue,
      executor,
      config,
      workerId: `${runId}_worker_${index}`,
      observability: createGenerationObservability(() => undefined),
    });
    workers.push(worker);
    await worker.start();
  }

  const deadline = Date.now() + 120_000;
  let terminalCount = 0;
  while (Date.now() < deadline) {
    const rows = await database
      .select({ status: generationTasks.status })
      .from(generationTasks)
      .where(inArray(generationTasks.id, taskIds));
    terminalCount = rows.filter((row) =>
      ["succeeded", "partially_succeeded", "permanently_failed"].includes(row.status)
    ).length;
    if (terminalCount === taskCount) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await Promise.all(workers.map((worker) => worker.drain()));

  const [tasks, assets, holds, transactions, permits] = await Promise.all([
    database.select().from(generationTasks).where(inArray(generationTasks.id, taskIds)),
    database.select().from(generatedAssets).where(inArray(generatedAssets.taskId, taskIds)),
    database.select().from(creditHolds).where(inArray(creditHolds.videoUuid, taskIds)),
    database.select().from(creditTransactions).where(inArray(creditTransactions.videoUuid, taskIds)),
    database.select().from(generationConcurrencyLeases).where(inArray(generationConcurrencyLeases.taskId, taskIds)),
  ]);
  const assetKeys = assets.map((asset) => `${asset.taskId}:${asset.outputIndex}`);
  const settledTransactions = transactions.filter((transaction) => transaction.credits < 0);
  const settledTaskIds = settledTransactions.map((transaction) => transaction.videoUuid);
  const result = {
    taskCount,
    workerCount: 8,
    globalPeak,
    userPeaks: Object.fromEntries(userPeaks),
    providerModelPeaks: Object.fromEntries(providerPeaks),
    duplicateAssetCount: assetKeys.length - new Set(assetKeys).size,
    duplicateSettlementCount: settledTaskIds.length - new Set(settledTaskIds).size,
    permanentlyStuckTaskCount: tasks.filter((task) =>
      !["succeeded", "partially_succeeded", "permanently_failed"].includes(task.status)
    ).length,
    inconsistentCreditCount: holds.filter((hold) => hold.status !== "SETTLED").length,
    livePermitCount: permits.length,
    oldestRunnableWaitMs: Math.max(0, ...runnableWaits),
    claimLatencyP95Ms: percentile(claimLatencies, 0.95),
  };
  console.log(JSON.stringify(result, null, 2));

  const invalid =
    result.globalPeak > 4 ||
    Object.values(result.userPeaks).some((peak) => peak > 1) ||
    Object.values(result.providerModelPeaks).some((peak) => peak > 2) ||
    result.duplicateAssetCount !== 0 ||
    result.duplicateSettlementCount !== 0 ||
    result.permanentlyStuckTaskCount !== 0 ||
    result.inconsistentCreditCount !== 0 ||
    result.livePermitCount !== 0 ||
    result.claimLatencyP95Ms >= 100;
  if (invalid) process.exitCode = 1;
} finally {
  for (const worker of workers) worker.abort();
  await database.delete(generationConcurrencyLeases).where(like(generationConcurrencyLeases.taskId, `${runId}%`));
  await database.delete(generatedAssets).where(like(generatedAssets.taskId, `${runId}%`));
  await database.delete(creditTransactions).where(like(creditTransactions.videoUuid, `${runId}%`));
  await database.delete(creditHolds).where(like(creditHolds.videoUuid, `${runId}%`));
  await database.delete(generationTasks).where(like(generationTasks.id, `${runId}%`));
  await database.delete(creditPackages).where(and(inArray(creditPackages.userId, userIds), eq(creditPackages.orderNo, runId)));
  await client.end({ timeout: 5 });
}
