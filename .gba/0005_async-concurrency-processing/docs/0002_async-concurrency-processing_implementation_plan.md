# Async Generation Worker and Concurrency Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace request-process image generation with a durable PostgreSQL-backed worker that enforces global, per-user, and per-provider/model concurrency limits without duplicate assets or credit settlement.

**Architecture:** Next.js routes atomically freeze credits and enqueue tasks, then return HTTP 202. A separately deployed TypeScript worker claims tasks and three PostgreSQL permits in one transaction, renews 120-second leases every 30 seconds, calls the provider outside database transactions, and finalizes assets, credits, and task state idempotently. PostgreSQL is the first queue and coordination backend; Redis/BullMQ and FastAPI remain out of scope.

**Tech Stack:** Next.js 16, TypeScript 5.9, Node.js, Drizzle ORM 0.45, postgres.js 3.4, PostgreSQL, Vitest 4, pnpm, Zeabur.

## Global Constraints

- Work only on `feat/async-concurrency-processing`; do not include unrelated dirty files in commits.
- Active runtime code for this feature is `ima ima queencard/src/`; run commands from that directory.
- Use PostgreSQL as the queue and permit coordinator; do not add Redis, BullMQ, Kafka, or FastAPI.
- Default limits are global `4`, per-user `1`, per-provider/model `2`, and local worker concurrency `4`.
- Maximum attempts are `3`; retry bases are `5s`, `30s`, and `120s`, each with ±20% jitter.
- Lease duration is `120s`; heartbeat interval is `30s`; provider timeout is `300s`.
- Provider calls must never run inside a database transaction.
- A running task must own global, user, and provider/model permits atomically.
- `taskId` is the credit hold key; retries must not create a second hold.
- `(task_id, output_index)` is the asset idempotency key and already has a unique index.
- Routes must not import the worker loop or call the provider after the async cutover.
- Do not log secrets, `DATABASE_URL`, complete reference-image URLs, or full provider payloads.
- Each task below ends with focused tests and a commit; push after every successful commit.

---

## File Structure

### Create

| File | Responsibility |
| --- | --- |
| `ima ima queencard/src/src/config/generation-worker.ts` | Parse and validate worker, lease, retry, polling, and rollout configuration. |
| `ima ima queencard/src/src/config/generation-worker.test.ts` | Configuration defaults and fail-fast validation. |
| `ima ima queencard/src/src/services/generation-task-policy.ts` | Canonical statuses, failure classification, retry delay, scope construction, and lease token types. |
| `ima ima queencard/src/src/services/generation-task-policy.test.ts` | Pure policy tests with deterministic clock and random input. |
| `ima ima queencard/src/src/db/migrations/0006_async_generation_worker.sql` | Queue fields, permit table, constraints, and indexes. |
| `ima ima queencard/src/src/services/credit.test.ts` | Credit transaction-wrapper and hold idempotency regression tests. |
| `ima ima queencard/src/src/services/generation-queue.ts` | PostgreSQL enqueue lookup, candidate claim, permit acquisition, heartbeat, retry, finalization guard, and recovery. |
| `ima ima queencard/src/src/services/generation-queue.test.ts` | Repository behavior with deterministic database doubles. |
| `ima ima queencard/src/src/services/generation-queue.postgres.test.ts` | Real PostgreSQL contention, atomicity, and expired-lease integration tests. |
| `ima ima queencard/src/src/services/generation-task-executor.ts` | Execute one claimed task and persist an idempotent terminal/retry outcome. |
| `ima ima queencard/src/src/services/generation-task-executor.test.ts` | Success, partial success, retry, permanent failure, stale lease, and credit idempotency tests. |
| `ima ima queencard/src/src/workers/generation-worker.ts` | Polling loop, local backpressure, heartbeat scheduling, recovery scan, and graceful drain. |
| `ima ima queencard/src/src/workers/generation-worker.test.ts` | Worker lifecycle and fake-clock tests. |
| `ima ima queencard/src/src/workers/run-generation-worker.ts` | Zeabur process entrypoint, signal handlers, and health server. |
| `ima ima queencard/src/src/services/generation-observability.ts` | Structured event and in-process metric interfaces without high-cardinality labels. |
| `ima ima queencard/src/src/services/generation-observability.test.ts` | Redaction and metric-label tests. |
| `ima ima queencard/src/scripts/verify-generation-concurrency.ts` | Real-Postgres 8-worker/1,000-task verification and JSON evidence writer. |

### Modify

| File | Change |
| --- | --- |
| `ima ima queencard/src/src/db/schema.ts` | Add queue fields and `generationConcurrencyLeases`. |
| `ima ima queencard/src/src/db/migrations/meta/_journal.json` | Register migration `0006_async_generation_worker`. |
| `ima ima queencard/src/src/services/credit.ts` | Expose transaction-aware freeze, partial settle, and release primitives. |
| `ima ima queencard/src/src/services/image-provider.ts` | Keep raw provider generation separate from credit lifecycle; preserve legacy wrapper for non-worker callers. |
| `ima ima queencard/src/src/services/image-generation.ts` | Enqueue idempotently, expose public async state, and delegate execution to the new executor. |
| `ima ima queencard/src/src/services/image-generation.test.ts` | Enqueue, idempotency, hold, and public-state tests. |
| `ima ima queencard/src/src/app/api/v1/image-generations/route.ts` | Remove `after()` execution and return HTTP 202. |
| `ima ima queencard/src/src/app/api/v1/image-generations/route.test.ts` | Assert route/provider isolation and 202 response. |
| `ima ima queencard/src/src/app/api/v1/image-generations/[taskId]/regenerate/route.ts` | Remove `after()` execution and return HTTP 202. |
| `ima ima queencard/src/package.json` | Add worker and concurrency verification scripts. |
| `ima ima queencard/src/.env.example` | Document server-only worker configuration. |
| `.gba/0005_async-concurrency-processing/docs/0001_async-concurrency-processing_impl_notes.md` | Record commits, migration, commands, and evidence. |

---

### Task 1: Worker Configuration and Pure Task Policy

**Files:**
- Create: `ima ima queencard/src/src/config/generation-worker.ts`
- Create: `ima ima queencard/src/src/config/generation-worker.test.ts`
- Create: `ima ima queencard/src/src/services/generation-task-policy.ts`
- Create: `ima ima queencard/src/src/services/generation-task-policy.test.ts`

**Interfaces:**
- Produces: `GenerationWorkerConfig`, `loadGenerationWorkerConfig(env)`, `GenerationTaskStatus`, `GenerationLeaseToken`, `buildGenerationScopes(task)`, `classifyGenerationFailure(error)`, and `nextGenerationAttemptAt(params)`.
- Consumes: only plain values, `ApiError`, and standard `Date`; no database or provider dependency.

- [ ] **Step 1: Write failing configuration tests**

```ts
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
    [{ GENERATION_USER_CONCURRENCY: "5", GENERATION_GLOBAL_CONCURRENCY: "4" }, "userConcurrency"],
    [{ GENERATION_HEARTBEAT_MS: "50000", GENERATION_LEASE_MS: "120000" }, "heartbeatMs"],
  ])("rejects unsafe configuration %o", (env, field) => {
    expect(() => loadGenerationWorkerConfig(env)).toThrow(field);
  });
});
```

- [ ] **Step 2: Run the configuration test and confirm RED**

Run: `pnpm vitest run src/config/generation-worker.test.ts`

Expected: FAIL because `generation-worker.ts` does not exist.

- [ ] **Step 3: Implement strict parsing and cross-field validation**

```ts
export type GenerationWorkerConfig = Readonly<{
  enabled: boolean;
  workerConcurrency: number;
  globalConcurrency: number;
  userConcurrency: number;
  providerModelConcurrency: number;
  maxAttempts: number;
  leaseMs: number;
  heartbeatMs: number;
  providerTimeoutMs: number;
  pollMinMs: number;
  pollMaxMs: number;
  candidateBatch: number;
  rolloutPercent: number;
  recoveryIntervalMs: number;
}>;

export function loadGenerationWorkerConfig(
  env: Record<string, string | undefined> = process.env
): GenerationWorkerConfig {
  // Parse every numeric field as an integer, enforce documented ranges,
  // then enforce heartbeatMs <= leaseMs / 3, pollMinMs <= pollMaxMs,
  // and user/provider limits <= globalConcurrency. Throw a field-named Error.
}
```

- [ ] **Step 4: Write failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildGenerationScopes,
  classifyGenerationFailure,
  nextGenerationAttemptAt,
} from "./generation-task-policy";

describe("generation task policy", () => {
  it("builds three sorted scopes", () => {
    expect(buildGenerationScopes({
      userId: "user_1",
      provider: "gptproto",
      providerModel: "gpt-image-2",
    })).toEqual([
      "global",
      "provider:gptproto:gpt-image-2",
      "user:user_1",
    ]);
  });

  it("classifies 429 as transient and invalid input as permanent", () => {
    expect(classifyGenerationFailure(Object.assign(new Error("rate limit"), { status: 429 })).category).toBe("transient");
    expect(classifyGenerationFailure(Object.assign(new Error("invalid model"), { status: 400 })).category).toBe("permanent");
  });

  it("uses deterministic jitter for the second retry", () => {
    const now = new Date("2026-08-02T00:00:00Z");
    expect(nextGenerationAttemptAt({ attemptCount: 2, now, random: () => 0.5 }))
      .toEqual(new Date("2026-08-02T00:00:30Z"));
  });
});
```

- [ ] **Step 5: Implement the pure policy and run both test files**

Define statuses exactly as `queued | running | retry_scheduled | succeeded | partially_succeeded | permanently_failed`. Define `GenerationLeaseToken` with `taskId`, `taskVersion`, `leaseOwner`, and `leaseExpiresAt`. Clamp provider `Retry-After` to 15 minutes and use base delays `[5_000, 30_000, 120_000]` with ±20% jitter.

Run: `pnpm vitest run src/config/generation-worker.test.ts src/services/generation-task-policy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add src/config/generation-worker.ts src/config/generation-worker.test.ts src/services/generation-task-policy.ts src/services/generation-task-policy.test.ts
git commit -m "feat: define generation worker policy"
git push
```

### Task 2: Queue Schema and Compatible Migration

**Files:**
- Modify: `ima ima queencard/src/src/db/schema.ts`
- Create: `ima ima queencard/src/src/db/migrations/0006_async_generation_worker.sql`
- Modify: `ima ima queencard/src/src/db/migrations/meta/_journal.json`
- Create: `ima ima queencard/src/src/db/generation-schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `generationTasks`, `generatedAssets`, and `generationConcurrencyLeases` with fields consumed by `generation-queue.ts`.
- Consumes: status literals from Task 1 only at service boundaries; schema remains database-oriented text fields for compatible migration.

- [ ] **Step 1: Write a failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { generationConcurrencyLeases, generationTasks } from "./schema";

describe("async generation schema", () => {
  it("exposes lease and retry columns", () => {
    expect(Object.keys(getTableColumns(generationTasks))).toEqual(expect.arrayContaining([
      "idempotencyKey", "parentTaskId", "priority", "attemptCount", "maxAttempts",
      "nextAttemptAt", "leaseOwner", "leaseExpiresAt", "heartbeatAt", "version",
      "failureCategory", "lastErrorAt",
    ]));
  });

  it("defines the permit table", () => {
    expect(getTableName(generationConcurrencyLeases)).toBe("generation_concurrency_leases");
    expect(Object.keys(getTableColumns(generationConcurrencyLeases))).toEqual([
      "scopeKey", "slotNumber", "taskId", "taskVersion", "leaseOwner",
      "expiresAt", "heartbeatAt", "acquiredAt",
    ]);
  });
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run: `pnpm vitest run src/db/generation-schema.test.ts`

Expected: FAIL because the queue columns and permit table do not exist.

- [ ] **Step 3: Add Drizzle columns, indexes, and table definition**

Use `primaryKey({ columns: [table.scopeKey, table.slotNumber] })`, a unique index on `(taskId, scopeKey)`, and indexes on `taskId` and `expiresAt`. Preserve the existing `generated_assets_task_output_idx`; do not create a duplicate index.

- [ ] **Step 4: Add the additive SQL migration**

```sql
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "priority" smallint DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "lease_owner" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "failure_category" text;
ALTER TABLE "generation_tasks" ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;

CREATE TABLE IF NOT EXISTS "generation_concurrency_leases" (
  "scope_key" text NOT NULL,
  "slot_number" integer NOT NULL,
  "task_id" text NOT NULL,
  "task_version" integer NOT NULL,
  "lease_owner" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "heartbeat_at" timestamp NOT NULL,
  "acquired_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "generation_concurrency_leases_pk" PRIMARY KEY ("scope_key", "slot_number"),
  CONSTRAINT "generation_concurrency_leases_slot_positive" CHECK ("slot_number" >= 1)
);
```

Add the conditional unique idempotency index, runnable and expired-lease indexes, permit unique/indexes, attempt/max-attempt checks, and state/lease consistency checks. Register journal index `6` with tag `0006_async_generation_worker`.

- [ ] **Step 5: Run schema and existing generation tests**

Run: `pnpm vitest run src/db/generation-schema.test.ts src/services/image-generation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add src/db/schema.ts src/db/migrations/0006_async_generation_worker.sql src/db/migrations/meta/_journal.json src/db/generation-schema.test.ts
git commit -m "feat: add durable generation queue schema"
git push
```

### Task 3: Transaction-Aware Credits and Idempotent Enqueue

**Files:**
- Modify: `ima ima queencard/src/src/services/credit.ts`
- Create: `ima ima queencard/src/src/services/credit.test.ts`
- Modify: `ima ima queencard/src/src/services/image-generation.ts`
- Modify: `ima ima queencard/src/src/services/image-generation.test.ts`

**Interfaces:**
- Consumes: `generationTasks` fields from Task 2 and `GenerationWorkerConfig.maxAttempts` from Task 1.
- Produces: `creditService.freezeInTx(trx, params)`, `settlePartialInTx(trx, holdKey, credits)`, `releaseInTx(trx, holdKey)`, and `createImageGenerationTask(userId, input)` with `idempotencyKey?: string`.

- [ ] **Step 1: Write failing credit idempotency and enqueue tests**

Add tests proving that ten concurrent calls with the same `(userId, idempotencyKey)` return the same task, invoke `freezeInTx` once, and set `creditHoldKey === taskId`. Add a rollback test where task insert throws and no committed hold remains.

```ts
it("reuses the task and hold for a repeated idempotency key", async () => {
  mocks.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValue(existingTask);
  const first = await createImageGenerationTask("user_1", validInput("request_123"));
  const second = await createImageGenerationTask("user_1", validInput("request_123"));
  expect(second.taskId).toBe(first.taskId);
  expect(mocks.freezeInTx).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm vitest run src/services/image-generation.test.ts`

Expected: FAIL because transaction-aware credit methods and `idempotencyKey` do not exist.

- [ ] **Step 3: Extract transaction-aware credit primitives**

Move the bodies of `freeze`, `settlePartial`, and `release` into methods that accept the Drizzle transaction. Keep public wrappers that open their own transaction so existing callers remain compatible.

```ts
async freeze(params: FreezeCreditParams) {
  return db.transaction((trx) => this.freezeInTx(trx, params));
}

async freezeInTx(trx: CreditTransactionDb, params: FreezeCreditParams) {
  // Existing idempotent hold lookup, package allocation, and hold insert.
}
```

- [ ] **Step 4: Make task creation atomic**

Normalize and validate `idempotencyKey` to 8–120 characters. In one transaction: return an existing task when the user/key pair exists; otherwise freeze credits with `videoUuid: taskId` and insert the queued task with `maxAttempts`, `nextAttemptAt`, and `creditHoldKey`.

Catch the unique-key race by re-reading the existing task after a unique-constraint conflict. Do not compare prompt text for idempotency.

- [ ] **Step 5: Run image generation and credit tests**

Run: `pnpm vitest run src/services/image-generation.test.ts src/services/credit.test.ts`

Expected: PASS with no changes to existing credit behavior.

- [ ] **Step 6: Commit and push**

```bash
git add src/services/credit.ts src/services/credit.test.ts src/services/image-generation.ts src/services/image-generation.test.ts
git commit -m "feat: enqueue generation tasks with idempotent credit holds"
git push
```

### Task 4: Atomic Permit Acquisition and Task Claim

**Files:**
- Create: `ima ima queencard/src/src/services/generation-queue.ts`
- Create: `ima ima queencard/src/src/services/generation-queue.test.ts`
- Create: `ima ima queencard/src/src/services/generation-queue.postgres.test.ts`

**Interfaces:**
- Consumes: `GenerationWorkerConfig`, `GenerationLeaseToken`, `buildGenerationScopes`, `generationTasks`, and `generationConcurrencyLeases`.
- Produces: `createGenerationQueue(database)`, `claimNext({ workerId, now, config })`, and `ClaimedGenerationTask { task, lease }`.

- [ ] **Step 1: Write failing repository unit tests**

Test candidate order, three sorted scopes, all-or-nothing rollback when the second scope is full, and a successful claim that returns version `1`, attempt `1`, and three matching permits.

```ts
const claimed = await queue.claimNext({
  workerId: "worker_a",
  now: new Date("2026-08-02T00:00:00Z"),
  config: approvedConfig,
});
expect(claimed?.lease).toMatchObject({
  taskId: "gen_1",
  taskVersion: 1,
  leaseOwner: "worker_a",
});
expect(fakeDb.activeScopes("gen_1")).toEqual([
  "global",
  "provider:gptproto:gpt-image-2",
  "user:user_1",
]);
```

- [ ] **Step 2: Run unit tests and confirm RED**

Run: `pnpm vitest run src/services/generation-queue.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement claim with one short transaction**

Use a candidate query ordered by `priority DESC, next_attempt_at ASC, created_at ASC` with limit `candidateBatch`. For each candidate, lock it with `FOR UPDATE SKIP LOCKED`; acquire the first available/expired slot in each sorted scope; update to `running` only after all three permits succeed. A capacity miss rolls back and moves to the next candidate.

The transaction returns before any provider call. Record permit contention as a normal metric, not an exception.

- [ ] **Step 4: Write real PostgreSQL contention tests**

Under `// @vitest-environment node`, use `TEST_DATABASE_URL`. Create one queued fixture and call `claimNext` from eight independent database clients with `Promise.all`. Assert exactly one non-null claim and exactly three unexpired permit rows. Add a test where the user scope is full but a second user can claim a later candidate.

- [ ] **Step 5: Run unit and PostgreSQL tests**

Run: `test -n "$TEST_DATABASE_URL" && pnpm vitest run src/services/generation-queue.test.ts src/services/generation-queue.postgres.test.ts`

Expected: PASS against a migrated disposable test database. Never run destructive fixtures against production.

- [ ] **Step 6: Commit and push**

```bash
git add src/services/generation-queue.ts src/services/generation-queue.test.ts src/services/generation-queue.postgres.test.ts
git commit -m "feat: claim generation tasks with durable permits"
git push
```

### Task 5: Heartbeat, Retry, Finalization Guard, and Recovery

**Files:**
- Modify: `ima ima queencard/src/src/services/generation-queue.ts`
- Modify: `ima ima queencard/src/src/services/generation-queue.test.ts`
- Modify: `ima ima queencard/src/src/services/generation-queue.postgres.test.ts`

**Interfaces:**
- Produces: `renewLease(lease, now)`, `scheduleRetry(lease, failure, nextAttemptAt, now)`, `markPermanentFailure(lease, failure, now)`, `withValidLeaseForFinalize(lease, callback)`, `releasePermits(lease)`, and `recoverExpired(now)`.
- Consumes: error classification and retry timestamps from Task 1.

- [ ] **Step 1: Write failing lease lifecycle tests**

```ts
it("renews the task and exactly three permits together", async () => {
  await expect(queue.renewLease(lease, now)).resolves.toBe(true);
  expect(fakeDb.task("gen_1").leaseExpiresAt).toEqual(addMs(now, 120_000));
  expect(fakeDb.permits("gen_1")).toHaveLength(3);
});

it("rejects a stale worker finalize", async () => {
  fakeDb.replaceLeaseOwner("gen_1", "worker_b", 2);
  await expect(queue.withValidLeaseForFinalize(lease, vi.fn())).resolves.toBe(false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/services/generation-queue.test.ts`

Expected: FAIL because lifecycle methods do not exist.

- [ ] **Step 3: Implement guarded lifecycle transitions**

Every update condition includes `taskId`, `taskVersion`, `leaseOwner`, `status = running`, and an unexpired lease. Heartbeat updates the task and all three permits in one transaction. Retry/permanent failure/finalize clear task lease fields and remove matching permits in the same transaction.

`recoverExpired(now)` locks expired running tasks with `SKIP LOCKED`, increments version, and moves each task to `retry_scheduled` when attempts remain or `permanently_failed` when exhausted. Repeated recovery calls must update each task once.

- [ ] **Step 4: Add PostgreSQL recovery race tests**

Create an expired task and run two recovery scanners concurrently. Assert one transition, no live permits, and no duplicate retry. Advance a fake clock by 120 seconds plus one scan interval and assert recovery completes within the 150-second design budget.

- [ ] **Step 5: Run queue tests**

Run: `test -n "$TEST_DATABASE_URL" && pnpm vitest run src/services/generation-queue.test.ts src/services/generation-queue.postgres.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add src/services/generation-queue.ts src/services/generation-queue.test.ts src/services/generation-queue.postgres.test.ts
git commit -m "feat: recover leased generation tasks safely"
git push
```

### Task 6: Idempotent Task Executor and Provider Timeout

**Files:**
- Create: `ima ima queencard/src/src/services/generation-task-executor.ts`
- Create: `ima ima queencard/src/src/services/generation-task-executor.test.ts`
- Modify: `ima ima queencard/src/src/services/image-provider.ts`
- Modify: `ima ima queencard/src/src/services/image-generation.ts`

**Interfaces:**
- Consumes: `ClaimedGenerationTask`, queue lifecycle methods, raw `generateImage`, and transaction-aware credit methods.
- Produces: `createGenerationTaskExecutor(deps)` and `execute(claimed, signal?)` returning `succeeded | partially_succeeded | retry_scheduled | permanently_failed | stale`.

- [ ] **Step 1: Write failing executor tests**

Cover full success, partial success, no output, transient 429, permanent 400, 300-second timeout, duplicate output index, and stale lease after provider return.

```ts
it("does not finalize after losing the lease", async () => {
  provider.generate.mockResolvedValue(successfulProviderResult());
  queue.withValidLeaseForFinalize.mockResolvedValue(false);
  await expect(executor.execute(claimed)).resolves.toBe("stale");
  expect(credits.settlePartialInTx).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/services/generation-task-executor.test.ts`

Expected: FAIL because the executor does not exist.

- [ ] **Step 3: Separate provider work from credit lifecycle**

The executor calls exported raw `generateImage`, not `generateImageWithCredits`, because credits were frozen at enqueue and transient attempts must preserve the hold. Keep `generateImageWithCredits` for compatible non-worker callers, implemented as a wrapper around raw generation and existing credit APIs.

- [ ] **Step 4: Implement the executor**

Wrap the provider promise with an `AbortController` and 300-second timeout. Convert provider images to stable output indexes. Inside `withValidLeaseForFinalize`, insert assets with `onConflictDoNothing` on `(taskId, outputIndex)`, compute settled credits from persisted assets, call `settlePartialInTx` or `releaseInTx`, write provider fields, and set the terminal state.

Transient/unknown errors schedule retry when `attemptCount < maxAttempts`; permanent or exhausted failures release credits and become `permanently_failed`. Never release the hold for a transient retry.

- [ ] **Step 5: Run executor and existing provider tests**

Run: `pnpm vitest run src/services/generation-task-executor.test.ts src/services/image-generation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add src/services/generation-task-executor.ts src/services/generation-task-executor.test.ts src/services/image-provider.ts src/services/image-generation.ts
git commit -m "feat: execute generation tasks idempotently"
git push
```

### Task 7: Worker Runtime, Health, Signals, and Observability

**Files:**
- Create: `ima ima queencard/src/src/workers/generation-worker.ts`
- Create: `ima ima queencard/src/src/workers/generation-worker.test.ts`
- Create: `ima ima queencard/src/src/workers/run-generation-worker.ts`
- Create: `ima ima queencard/src/src/services/generation-observability.ts`
- Create: `ima ima queencard/src/src/services/generation-observability.test.ts`
- Modify: `ima ima queencard/src/package.json`
- Modify: `ima ima queencard/src/.env.example`

**Interfaces:**
- Consumes: queue, executor, and config from Tasks 1, 4–6.
- Produces: `createGenerationWorker(deps)`, `start()`, `drain()`, `status()`, worker script `pnpm worker:generation`, and health endpoints `/health/live` and `/health/ready` on `WORKER_HEALTH_PORT`.

- [ ] **Step 1: Write failing worker lifecycle tests**

Use Vitest fake timers. Assert no polling when disabled, no claim when local slots are full, 1–5 second empty-queue backoff, heartbeat every 30 seconds, recovery every 30 seconds, and drain behavior that stops claims but continues heartbeats.

```ts
it("stops claiming while draining", async () => {
  await worker.start();
  const draining = worker.drain();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(queue.claimNext).not.toHaveBeenCalled();
  await draining;
  expect(worker.status().phase).toBe("stopped");
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/workers/generation-worker.test.ts`

Expected: FAIL because the worker runtime does not exist.

- [ ] **Step 3: Implement worker runtime and graceful drain**

Generate `workerId` from deployment ID, process ID, and random suffix. Maintain at most `workerConcurrency` in-flight promises. Poll only with free local slots. Start one heartbeat timer per task and one recovery timer per process. On `SIGTERM`/`SIGINT`, stop claims, keep heartbeats, wait up to 330 seconds, then stop renewing and exit nonzero if tasks remain.

- [ ] **Step 4: Add observability and redaction tests**

```ts
expect(redactGenerationEvent({
  taskId: "gen_1",
  referenceImageUrl: "https://secret.example/image.png?token=abc",
  databaseUrl: "postgresql://secret",
})).toEqual({ taskId: "gen_1" });
```

Implement structured events and in-process counters/histograms behind an interface that can later connect to Zeabur metrics. Never use `userId`, `taskId`, or prompt as metric labels.

- [ ] **Step 5: Add process entrypoint and scripts**

```json
{
  "scripts": {
    "worker:generation": "tsx src/workers/run-generation-worker.ts",
    "verify:generation-concurrency": "tsx scripts/verify-generation-concurrency.ts"
  }
}
```

The entrypoint validates config and database connectivity before reporting ready. The health server returns 200 for live, 200 for ready only while accepting work, and 503 for ready while draining or database-unavailable.

- [ ] **Step 6: Run worker and observability tests**

Run: `pnpm vitest run src/workers/generation-worker.test.ts src/services/generation-observability.test.ts`

Expected: PASS with no open timers.

- [ ] **Step 7: Commit and push**

```bash
git add src/workers src/services/generation-observability.ts src/services/generation-observability.test.ts package.json .env.example
git commit -m "feat: add standalone generation worker runtime"
git push
```

### Task 8: Cut API Routes Over to Durable Enqueue

**Files:**
- Modify: `ima ima queencard/src/src/app/api/v1/image-generations/route.ts`
- Modify: `ima ima queencard/src/src/app/api/v1/image-generations/route.test.ts`
- Modify: `ima ima queencard/src/src/app/api/v1/image-generations/[taskId]/regenerate/route.ts`
- Create: `ima ima queencard/src/src/app/api/v1/image-generations/[taskId]/regenerate/route.test.ts`
- Modify: `ima ima queencard/src/src/services/image-generation.ts`

**Interfaces:**
- Consumes: idempotent enqueue from Task 3.
- Produces: HTTP 202 create/regenerate endpoints that return `taskId`, `status`, `statusUrl`, and `redirectUrl` without importing `next/server.after` or execution functions.

- [ ] **Step 1: Replace route tests with failing isolation assertions**

```ts
it("returns 202 without scheduling provider execution", async () => {
  const response = await POST(validRequest());
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    success: true,
    data: {
      taskId: "gen_123",
      status: "queued",
      statusUrl: "/api/v1/image-generations/gen_123",
      redirectUrl: "/generated?taskId=gen_123",
    },
  });
});
```

Remove `next/server` and `runImageGenerationTask` mocks. Add the same contract for regenerate and assert `parentTaskId` is preserved internally.

- [ ] **Step 2: Run route tests and confirm RED**

Run: `pnpm vitest run src/app/api/v1/image-generations/route.test.ts src/app/api/v1/image-generations/\[taskId\]/regenerate/route.test.ts`

Expected: FAIL because routes still use `after()` and return 200.

- [ ] **Step 3: Implement route cutover**

Delete `after` imports and all fire-and-forget execution calls. Use `apiSuccess(data, 202)`. Add `statusUrl`. Keep authentication, validation, and error handling unchanged.

- [ ] **Step 4: Run API and service tests**

Run: `pnpm vitest run src/app/api/v1/image-generations/route.test.ts src/app/api/v1/image-generations/\[taskId\]/regenerate/route.test.ts src/services/image-generation.test.ts`

Expected: PASS.

- [ ] **Step 5: Prove the route no longer references execution**

Run: `rg -n "after\(|runImageGenerationTask" src/app/api/v1/image-generations`

Expected: no output.

- [ ] **Step 6: Commit and push**

```bash
git add src/app/api/v1/image-generations src/services/image-generation.ts
git commit -m "feat: enqueue image generation outside request lifecycle"
git push
```

### Task 9: Full PostgreSQL Verification, Fault Injection, and Zeabur Handoff

**Files:**
- Create: `ima ima queencard/src/scripts/verify-generation-concurrency.ts`
- Modify: `.gba/0005_async-concurrency-processing/docs/0001_async-concurrency-processing_impl_notes.md`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/environment.md`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/commands.txt`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/concurrency-peak-results.json`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/lease-recovery-results.json`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/credit-consistency-results.json`
- Create: `.gba/0005_async-concurrency-processing/docs/evidence/20260802-1548/performance-summary.md`

**Interfaces:**
- Consumes: all production interfaces from Tasks 1–8 and a migrated disposable `TEST_DATABASE_URL`.
- Produces: reproducible acceptance evidence and exact Zeabur worker deployment/runbook settings.

- [ ] **Step 1: Write the verification script against acceptance datasets**

The script creates D2–D6 fixtures, starts eight worker runtimes with a fake provider, records provider call intervals independently, and writes JSON containing:

```ts
type ConcurrencyEvidence = {
  taskCount: number;
  workerCount: 8;
  globalPeak: number;
  userPeaks: Record<string, number>;
  providerModelPeaks: Record<string, number>;
  duplicateAssetCount: number;
  duplicateSettlementCount: number;
  permanentlyStuckTaskCount: number;
  oldestRunnableWaitMs: number;
  claimLatencyP95Ms: number;
};
```

Exit nonzero unless `globalPeak <= 4`, every user peak `<=1`, every provider/model peak `<=2`, all duplicate/stuck counts are zero, and claim P95 is below 100 ms.

- [ ] **Step 2: Run every focused and full test**

```bash
pnpm vitest run src/config/generation-worker.test.ts
pnpm vitest run src/services/generation-task-policy.test.ts
test -n "$TEST_DATABASE_URL" && pnpm vitest run src/services/generation-queue.test.ts src/services/generation-queue.postgres.test.ts
pnpm vitest run src/services/generation-task-executor.test.ts
pnpm vitest run src/workers/generation-worker.test.ts
pnpm run test
pnpm run lint
pnpm run build:prod
```

Expected: every command exits 0. If no disposable PostgreSQL URL exists, stop and obtain one; never substitute production.

- [ ] **Step 3: Run quantitative verification**

Run: `test -n "$TEST_DATABASE_URL" && pnpm run verify:generation-concurrency`

Expected: 1,000 tasks reach terminal state; global/user/provider-model peaks are at most 4/1/2; duplicate asset, duplicate settlement, inconsistent credit, and stuck task counts are all 0; expired-lease recovery is at most 150 seconds under the real-clock fault case.

- [ ] **Step 4: Record Zeabur deployment contract**

Document a separate worker service with start command `pnpm worker:generation`, the same repository/branch and `ima ima queencard/src` root, shared PostgreSQL, server-only provider keys, `GENERATION_WORKER_ENABLED=true`, rollout initially 10, worker concurrency 2 for the first 24 hours, and health paths `/health/live` and `/health/ready`.

- [ ] **Step 5: Update implementation notes and evidence**

Record every commit, migration hash, exact environment names without values, commands, measured P50/P95/P99, zero-tolerance counters, known limitations, and rollback steps under `docs/evidence/20260802-1548/`. If execution begins in a materially later session, rename this evidence directory once to that session's real `YYYYMMDD-HHmm` timestamp before writing evidence.

- [ ] **Step 6: Commit and push**

```bash
git add scripts/verify-generation-concurrency.ts ../../.gba/0005_async-concurrency-processing/docs
git commit -m "test: verify async generation concurrency guarantees"
git push
```

- [ ] **Step 7: Request final code review**

Use `superpowers:requesting-code-review` against the complete branch diff. Resolve every correctness, data-consistency, security, or deployment finding before claiming completion. Then rerun the full test, lint, build, and quantitative verification commands from Steps 2–3.

---

## Plan Completion Criteria

- Tasks 1–9 are checked off with one focused commit per task.
- The API returns 202 and contains no `after()`/provider execution path.
- A standalone worker processes tasks with three atomic PostgreSQL permits.
- Lease loss, recovery, retry, and stale-finalize behavior pass real PostgreSQL tests.
- Credit holds survive transient retries and settle/release exactly once.
- The 1,000-task verification reports peaks no greater than 4/1/2 and all duplicate/inconsistency/stuck counters equal 0.
- `pnpm run test`, `pnpm run lint`, and `pnpm run build:prod` all exit 0.
- Implementation notes and evidence contain exact commands and measured results.
