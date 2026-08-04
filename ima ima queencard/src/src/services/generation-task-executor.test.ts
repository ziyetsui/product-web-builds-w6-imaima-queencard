import { describe, expect, it, vi } from "vitest";

import type { GenerationWorkerConfig } from "@/config/generation-worker";
import type { ClaimedGenerationTask } from "@/services/generation-queue";
import { createGenerationTaskExecutor } from "./generation-task-executor";

vi.mock("@/services/generation-provider-health", () => ({
  GENERATION_MAINTENANCE_MESSAGE:
    "图片生成服务正在补充额度，请稍后再试。此次请求未扣除积分。",
  recordGenerationProviderFailure: vi.fn(async () => undefined),
  recordGenerationProviderSuccess: vi.fn(async () => undefined),
}));

const NOW = new Date("2026-08-04T00:00:00.000Z");
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
  pollMinMs: 1_000,
  pollMaxMs: 5_000,
  candidateBatch: 20,
  rolloutPercent: 100,
  recoveryIntervalMs: 30_000,
};

function claimed(overrides: Record<string, unknown> = {}) {
  return {
    task: {
      id: "gen_1",
      userId: "user_1",
      model: "gpt-image-2-edit",
      providerModel: "gpt-image-2",
      provider: "gptproto",
      prompt: "draw",
      referenceImages: ["https://example.com/ref.png"],
      aspectRatio: "1:1",
      resolution: "1k",
      outputCount: 2,
      capability: "image-edit",
      attemptCount: 1,
      maxAttempts: 3,
      creditHoldKey: "gen_1",
      ...overrides,
    },
    lease: {
      taskId: "gen_1",
      taskVersion: 1,
      leaseOwner: "worker_1",
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
    },
  } as ClaimedGenerationTask;
}

function harness(options: {
  images?: Array<{ url?: string; b64Json?: string }>;
  providerError?: unknown;
  leaseValid?: boolean;
} = {}) {
  const persistedAssets = (options.images ?? [{ url: "https://a" }, { url: "https://b" }])
    .filter((image) => image.url || image.b64Json)
    .map((image, outputIndex) => ({
      outputIndex,
      creditsCharged: 1,
      storageUrl: image.url ?? "data:image/png;base64,x",
    }));
  const taskUpdates: Array<Record<string, unknown>> = [];
  const transaction = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => persistedAssets) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        taskUpdates.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const queue = {
    scheduleRetry: vi.fn(async () => true),
    withValidLeaseForFinalize: vi.fn(async (_lease, _now, finalize) => {
      if (options.leaseValid === false) return false;
      await finalize(transaction, claimed().task);
      return true;
    }),
  };
  const credits = {
    settlePartialInTx: vi.fn(async () => undefined),
    releaseInTx: vi.fn(async () => undefined),
  };
  const generate = options.providerError
    ? vi.fn(async () => { throw options.providerError; })
    : vi.fn(async () => ({
        provider: "gptproto" as const,
        model: "gpt-image-2",
        images: options.images ?? [{ url: "https://a" }, { url: "https://b" }],
        raw: { id: "provider_1" },
      }));
  const executor = createGenerationTaskExecutor({
    queue: queue as never,
    credits: credits as never,
    generate,
    config,
    now: () => NOW,
    random: () => 0.5,
  });
  return { executor, queue, credits, taskUpdates };
}

describe("generation task executor", () => {
  it("settles persisted outputs and marks full success", async () => {
    const { executor, credits, taskUpdates } = harness();
    await expect(executor.execute(claimed())).resolves.toBe("succeeded");
    expect(credits.settlePartialInTx).toHaveBeenCalledOnce();
    expect(taskUpdates.at(-1)).toMatchObject({ status: "succeeded" });
  });

  it("marks partial success from persisted output count", async () => {
    const { executor, taskUpdates } = harness({ images: [{ url: "https://a" }] });
    await expect(executor.execute(claimed())).resolves.toBe("partially_succeeded");
    expect(taskUpdates.at(-1)).toMatchObject({ status: "partially_succeeded" });
  });

  it("keeps the credit hold while scheduling transient retry", async () => {
    const error = Object.assign(new Error("rate limited"), { status: 429 });
    const { executor, queue, credits } = harness({ providerError: error });
    await expect(executor.execute(claimed())).resolves.toBe("retry_scheduled");
    expect(queue.scheduleRetry).toHaveBeenCalledOnce();
    expect(credits.releaseInTx).not.toHaveBeenCalled();
  });

  it("releases credits on a permanent provider failure", async () => {
    const error = Object.assign(new Error("invalid request"), { status: 400 });
    const { executor, credits, taskUpdates } = harness({ providerError: error });
    await expect(executor.execute(claimed())).resolves.toBe("permanently_failed");
    expect(credits.releaseInTx).toHaveBeenCalledOnce();
    expect(taskUpdates.at(-1)).toMatchObject({ status: "permanently_failed" });
  });

  it("immediately releases credits when GPTProto balance is insufficient", async () => {
    const error = Object.assign(new Error("insufficient balance"), {
      status: 403,
      code: "GPTPROTO_INSUFFICIENT_BALANCE",
    });
    const { executor, queue, credits, taskUpdates } = harness({ providerError: error });
    await expect(executor.execute(claimed())).resolves.toBe("permanently_failed");
    expect(queue.scheduleRetry).not.toHaveBeenCalled();
    expect(credits.releaseInTx).toHaveBeenCalledOnce();
    expect(taskUpdates.at(-1)).toMatchObject({ status: "permanently_failed" });
  });

  it("does not settle after losing the lease", async () => {
    const { executor, credits } = harness({ leaseValid: false });
    await expect(executor.execute(claimed())).resolves.toBe("stale");
    expect(credits.settlePartialInTx).not.toHaveBeenCalled();
    expect(credits.releaseInTx).not.toHaveBeenCalled();
  });
});
