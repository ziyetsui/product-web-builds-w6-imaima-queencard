import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { generationConcurrencyLeases, generationTasks } from "./schema";

describe("async generation schema", () => {
  it("exposes lease and retry columns", () => {
    expect(Object.keys(getTableColumns(generationTasks))).toEqual(
      expect.arrayContaining([
        "idempotencyKey",
        "parentTaskId",
        "priority",
        "attemptCount",
        "maxAttempts",
        "nextAttemptAt",
        "leaseOwner",
        "leaseExpiresAt",
        "heartbeatAt",
        "version",
        "failureCategory",
        "lastErrorAt",
      ])
    );
  });

  it("defines the permit table", () => {
    expect(getTableName(generationConcurrencyLeases)).toBe(
      "generation_concurrency_leases"
    );
    expect(Object.keys(getTableColumns(generationConcurrencyLeases))).toEqual([
      "scopeKey",
      "slotNumber",
      "taskId",
      "taskVersion",
      "leaseOwner",
      "expiresAt",
      "heartbeatAt",
      "acquiredAt",
    ]);
  });
});
