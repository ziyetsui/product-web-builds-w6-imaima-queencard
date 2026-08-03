import { nanoid } from "nanoid";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import type {
  ClaimedGenerationTask,
  GenerationQueue,
} from "@/services/generation-queue";
import type { GenerationTaskExecutor } from "@/services/generation-task-executor";
import {
  createGenerationObservability,
  type GenerationObservability,
} from "@/services/generation-observability";

export type GenerationWorkerPhase =
  | "stopped"
  | "running"
  | "draining";

export type GenerationWorkerDependencies = Readonly<{
  queue: Pick<GenerationQueue, "claimNext" | "renewLease" | "recoverExpired">;
  executor: Pick<GenerationTaskExecutor, "execute">;
  config: GenerationWorkerConfig;
  workerId?: string;
  now?: () => Date;
  random?: () => number;
  observability?: GenerationObservability;
}>;

export function createGenerationWorker({
  queue,
  executor,
  config,
  workerId = `${process.env.ZEABUR_SERVICE_ID ?? "local"}:${process.pid}:${nanoid(6)}`,
  now = () => new Date(),
  random = Math.random,
  observability = createGenerationObservability(),
}: GenerationWorkerDependencies) {
  let phase: GenerationWorkerPhase = "stopped";
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let emptyPollCount = 0;
  const inFlight = new Map<
    string,
    {
      claimed: ClaimedGenerationTask;
      controller: AbortController;
      heartbeat: ReturnType<typeof setInterval>;
      promise: Promise<void>;
    }
  >();
  const drainWaiters = new Set<() => void>();

  function resolveDrainIfIdle() {
    if (phase !== "draining" || inFlight.size !== 0) return;
    phase = "stopped";
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  function clearRuntimeTimers() {
    if (pollTimer) clearTimeout(pollTimer);
    if (recoveryTimer) clearInterval(recoveryTimer);
    pollTimer = undefined;
    recoveryTimer = undefined;
  }

  function nextPollDelay(foundWork: boolean) {
    if (foundWork) {
      emptyPollCount = 0;
      return 0;
    }
    emptyPollCount += 1;
    const exponential = Math.min(
      config.pollMaxMs,
      config.pollMinMs * 2 ** Math.min(emptyPollCount - 1, 10)
    );
    return Math.round(
      config.pollMinMs + random() * (exponential - config.pollMinMs)
    );
  }

  function schedulePoll(delay: number) {
    if (phase !== "running" || pollTimer) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void poll();
    }, delay);
  }

  function runClaimed(claimed: ClaimedGenerationTask) {
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      void queue
        .renewLease(claimed.lease, now(), config.leaseMs)
        .then((renewed) => {
          if (!renewed) controller.abort(new Error("Generation lease lost"));
        })
        .catch((error) => {
          observability.event("generation_heartbeat_failed", {
            taskId: claimed.task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, config.heartbeatMs);

    const startedAt = now().getTime();
    const promise = executor
      .execute(claimed, controller.signal)
      .then((result) => {
        observability.increment(`generation_result_${result}`);
        observability.event("generation_finished", {
          taskId: claimed.task.id,
          result,
        });
      })
      .catch((error) => {
        observability.increment("generation_executor_error");
        observability.event("generation_executor_error", {
          taskId: claimed.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        clearInterval(heartbeat);
        inFlight.delete(claimed.task.id);
        observability.observe(
          "generation_execution_duration_ms",
          Math.max(0, now().getTime() - startedAt)
        );
        resolveDrainIfIdle();
        schedulePoll(0);
      });

    inFlight.set(claimed.task.id, {
      claimed,
      controller,
      heartbeat,
      promise,
    });
  }

  async function poll() {
    if (phase !== "running" || polling) return;
    polling = true;
    let foundWork = false;
    try {
      while (phase === "running" && inFlight.size < config.workerConcurrency) {
        const claimed = await queue.claimNext({ workerId, now: now(), config });
        if (!claimed) break;
        foundWork = true;
        observability.increment("generation_claimed");
        runClaimed(claimed);
      }
    } catch (error) {
      observability.increment("generation_poll_error");
      observability.event("generation_poll_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      polling = false;
      schedulePoll(nextPollDelay(foundWork));
    }
  }

  async function recover() {
    try {
      const count = await queue.recoverExpired(now());
      if (count > 0) observability.increment("generation_recovered", count);
    } catch (error) {
      observability.increment("generation_recovery_error");
      observability.event("generation_recovery_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async start() {
      if (!config.enabled || phase !== "stopped") return;
      phase = "running";
      recoveryTimer = setInterval(() => void recover(), config.recoveryIntervalMs);
      await recover();
      schedulePoll(0);
    },

    async drain() {
      if (phase === "stopped") return;
      phase = "draining";
      clearRuntimeTimers();
      if (inFlight.size === 0) {
        phase = "stopped";
        return;
      }
      await new Promise<void>((resolve) => drainWaiters.add(resolve));
    },

    abort() {
      clearRuntimeTimers();
      phase = "stopped";
      for (const running of inFlight.values()) {
        clearInterval(running.heartbeat);
        running.controller.abort(new Error("Generation worker stopped"));
      }
    },

    status() {
      return {
        phase,
        workerId,
        enabled: config.enabled,
        ready: phase === "running",
        inFlight: inFlight.size,
      } as const;
    },
  };
}

export type GenerationWorker = ReturnType<typeof createGenerationWorker>;
