import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import { createGenerationObservability } from "@/services/generation-observability";
import { createGenerationWorker } from "./generation-worker";

const config: GenerationWorkerConfig = {
  enabled: true,
  workerConcurrency: 1,
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

afterEach(() => vi.useRealTimers());

describe("generation worker", () => {
  it("does not poll when disabled", async () => {
    const queue = { claimNext: vi.fn(), renewLease: vi.fn(), recoverExpired: vi.fn() };
    const worker = createGenerationWorker({
      queue: queue as never,
      executor: { execute: vi.fn() },
      config: { ...config, enabled: false },
    });
    await worker.start();
    expect(worker.status().phase).toBe("stopped");
    expect(queue.claimNext).not.toHaveBeenCalled();
  });

  it("claims, heartbeats, and drains without accepting more work", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const execution = new Promise<void>((resolve) => { finish = resolve; });
    const claimed = {
      task: { id: "gen_1" },
      lease: { taskId: "gen_1", taskVersion: 1, leaseOwner: "w", leaseExpiresAt: new Date() },
    };
    const queue = {
      claimNext: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValue(null),
      renewLease: vi.fn().mockResolvedValue(true),
      recoverExpired: vi.fn().mockResolvedValue(0),
    };
    const executor = { execute: vi.fn(async () => { await execution; return "succeeded" as const; }) };
    const worker = createGenerationWorker({
      queue: queue as never,
      executor,
      config,
      workerId: "worker_1",
      observability: createGenerationObservability(vi.fn()),
    });
    await worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.status().inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(queue.renewLease).toHaveBeenCalled();

    const claimsBeforeDrain = queue.claimNext.mock.calls.length;
    const draining = worker.drain();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queue.claimNext).toHaveBeenCalledTimes(claimsBeforeDrain);
    finish();
    await draining;
    expect(worker.status().phase).toBe("stopped");
  });

  it("runs expired-lease recovery on startup and interval", async () => {
    vi.useFakeTimers();
    const queue = {
      claimNext: vi.fn().mockResolvedValue(null),
      renewLease: vi.fn(),
      recoverExpired: vi.fn().mockResolvedValue(0),
    };
    const worker = createGenerationWorker({
      queue: queue as never,
      executor: { execute: vi.fn() },
      config,
      observability: createGenerationObservability(vi.fn()),
    });
    await worker.start();
    expect(queue.recoverExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(queue.recoverExpired).toHaveBeenCalledTimes(2);
    await worker.drain();
  });
});
