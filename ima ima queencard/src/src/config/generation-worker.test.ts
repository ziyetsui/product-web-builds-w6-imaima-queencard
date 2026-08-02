import { describe, expect, it } from "vitest";

import { loadGenerationWorkerConfig } from "./generation-worker";

describe("generation worker config", () => {
  it("loads the approved defaults", () => {
    expect(loadGenerationWorkerConfig({})).toMatchObject({
      enabled: false,
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
      rolloutPercent: 0,
    });
  });

  it.each([
    [{ GENERATION_GLOBAL_CONCURRENCY: "0" }, "globalConcurrency"],
    [
      {
        GENERATION_USER_CONCURRENCY: "5",
        GENERATION_GLOBAL_CONCURRENCY: "4",
      },
      "userConcurrency",
    ],
    [
      {
        GENERATION_HEARTBEAT_MS: "50000",
        GENERATION_LEASE_MS: "120000",
      },
      "heartbeatMs",
    ],
  ])("rejects unsafe configuration %o", (env, field) => {
    expect(() => loadGenerationWorkerConfig(env)).toThrow(field);
  });

  it("rejects non-integer values and invalid booleans", () => {
    expect(() =>
      loadGenerationWorkerConfig({ GENERATION_GLOBAL_CONCURRENCY: "1.5" })
    ).toThrow("globalConcurrency");
    expect(() =>
      loadGenerationWorkerConfig({ GENERATION_WORKER_ENABLED: "1" })
    ).toThrow("enabled");
  });
});
