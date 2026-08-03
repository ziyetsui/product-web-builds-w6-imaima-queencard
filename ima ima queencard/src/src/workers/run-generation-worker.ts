import { createServer } from "node:http";

import { sql } from "drizzle-orm";

import { loadGenerationWorkerConfig } from "@/config/generation-worker";
import { db } from "@/db";
import { createGenerationQueue } from "@/services/generation-queue";
import { creditService } from "@/services/credit";
import { createGenerationTaskExecutor } from "@/services/generation-task-executor";
import { createGenerationObservability } from "@/services/generation-observability";
import { createGenerationWorker } from "./generation-worker";

const config = loadGenerationWorkerConfig(process.env);
if (!config.enabled) {
  throw new Error("GENERATION_WORKER_ENABLED must be true for the worker service");
}

await db.execute(sql`select 1`);

const observability = createGenerationObservability();
const queue = createGenerationQueue(db, {
  onPermitContention({ scopeKey }) {
    observability.increment("generation_permit_contention");
    observability.event("generation_permit_contention", { scopeKey });
  },
  onPermanentFailure(transaction, taskId) {
    return creditService.releaseInTx(transaction, taskId);
  },
});
const executor = createGenerationTaskExecutor({ queue, config });
const worker = createGenerationWorker({ queue, executor, config, observability });
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 8081);
if (!Number.isSafeInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
  throw new Error("WORKER_HEALTH_PORT must be a valid TCP port");
}

let databaseHealthy = true;
const health = createServer(async (request, response) => {
  if (request.url === "/health/live") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "live" }));
    return;
  }
  if (request.url === "/health/ready") {
    try {
      await db.execute(sql`select 1`);
      databaseHealthy = true;
    } catch {
      databaseHealthy = false;
    }
    const ready = worker.status().ready && databaseHealthy;
    response.writeHead(ready ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ status: ready ? "ready" : "not_ready" }));
    return;
  }
  response.writeHead(404).end();
});

health.listen(healthPort, "0.0.0.0");
await worker.start();
observability.event("generation_worker_started", {
  workerId: worker.status().workerId,
  healthPort,
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  observability.event("generation_worker_draining", { signal });
  const drained = await Promise.race([
    worker.drain().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 330_000)),
  ]);
  if (!drained) worker.abort();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  process.exitCode = drained ? 0 : 1;
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
