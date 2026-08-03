import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  generatedAssets,
  generationConcurrencyLeases,
  generationTasks,
} from "./schema";

const migrationSql = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0007_async_generation_worker.sql"),
  "utf8"
);
const migrationJournal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/db/migrations/meta/_journal.json"),
    "utf8"
  )
) as {
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};
const dialect = new PgDialect();

function indexByName(
  table: typeof generationTasks | typeof generationConcurrencyLeases | typeof generatedAssets,
  name: string
) {
  const index = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );

  if (!index) {
    throw new Error(`Missing index ${name}`);
  }

  return index;
}

function checkByName(
  table: typeof generationTasks | typeof generationConcurrencyLeases,
  name: string
) {
  const check = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );

  if (!check) {
    throw new Error(`Missing check ${name}`);
  }

  return check;
}

function indexColumns(index: ReturnType<typeof indexByName>) {
  return index.config.columns.map((column) => {
    const indexedColumn = column as {
      name?: string;
      indexConfig?: { order?: string };
    };

    return {
      name: indexedColumn.name,
      order: indexedColumn.indexConfig?.order,
    };
  });
}

function indexPredicate(index: ReturnType<typeof indexByName>) {
  if (!index.config.where) return undefined;
  return dialect.sqlToQuery(index.config.where).sql;
}

function checkExpression(check: ReturnType<typeof checkByName>) {
  return dialect.sqlToQuery(check.value).sql;
}

describe("async generation schema", () => {
  it("defines queue columns with durable types, defaults, and nullability", () => {
    const columns = getTableColumns(generationTasks);

    expect(Object.keys(columns)).toEqual(
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
    expect(columns.idempotencyKey).toMatchObject({
      name: "idempotency_key",
      columnType: "PgText",
      dataType: "string",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.parentTaskId).toMatchObject({
      name: "parent_task_id",
      columnType: "PgText",
      dataType: "string",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.priority).toMatchObject({
      name: "priority",
      columnType: "PgSmallInt",
      dataType: "number",
      notNull: true,
      hasDefault: true,
      default: 0,
    });
    expect(columns.attemptCount).toMatchObject({
      name: "attempt_count",
      columnType: "PgInteger",
      dataType: "number",
      notNull: true,
      hasDefault: true,
      default: 0,
    });
    expect(columns.maxAttempts).toMatchObject({
      name: "max_attempts",
      columnType: "PgInteger",
      dataType: "number",
      notNull: true,
      hasDefault: true,
      default: 3,
    });
    expect(columns.nextAttemptAt).toMatchObject({
      name: "next_attempt_at",
      columnType: "PgTimestamp",
      dataType: "date",
      notNull: true,
      hasDefault: true,
    });
    expect(columns.leaseOwner).toMatchObject({
      name: "lease_owner",
      columnType: "PgText",
      dataType: "string",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.leaseExpiresAt).toMatchObject({
      name: "lease_expires_at",
      columnType: "PgTimestamp",
      dataType: "date",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.heartbeatAt).toMatchObject({
      name: "heartbeat_at",
      columnType: "PgTimestamp",
      dataType: "date",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.version).toMatchObject({
      name: "version",
      columnType: "PgInteger",
      dataType: "number",
      notNull: true,
      hasDefault: true,
      default: 0,
    });
    expect(columns.failureCategory).toMatchObject({
      name: "failure_category",
      columnType: "PgText",
      dataType: "string",
      notNull: false,
      hasDefault: false,
    });
    expect(columns.lastErrorAt).toMatchObject({
      name: "last_error_at",
      columnType: "PgTimestamp",
      dataType: "date",
      notNull: false,
      hasDefault: false,
    });
  });

  it("defines generation task queue indexes and checks", () => {
    const idempotencyIndex = indexByName(
      generationTasks,
      "generation_tasks_user_id_idempotency_key_idx"
    );
    const runnableIndex = indexByName(
      generationTasks,
      "generation_tasks_runnable_idx"
    );
    const expiredLeaseIndex = indexByName(
      generationTasks,
      "generation_tasks_expired_lease_idx"
    );

    expect(idempotencyIndex.config.unique).toBe(true);
    expect(indexColumns(idempotencyIndex)).toEqual([
      { name: "user_id", order: "asc" },
      { name: "idempotency_key", order: "asc" },
    ]);
    expect(indexPredicate(idempotencyIndex)).toBe(
      '"generation_tasks"."idempotency_key" is not null'
    );

    expect(runnableIndex.config.unique).toBe(false);
    expect(indexColumns(runnableIndex)).toEqual([
      { name: "status", order: "asc" },
      { name: "priority", order: "desc" },
      { name: "next_attempt_at", order: "asc" },
      { name: "created_at", order: "asc" },
    ]);
    expect(indexPredicate(runnableIndex)).toBeUndefined();

    expect(expiredLeaseIndex.config.unique).toBe(false);
    expect(indexColumns(expiredLeaseIndex)).toEqual([
      { name: "status", order: "asc" },
      { name: "lease_expires_at", order: "asc" },
    ]);
    expect(indexPredicate(expiredLeaseIndex)).toBe(
      '"generation_tasks"."status" = \'running\''
    );

    expect(
      checkExpression(
        checkByName(generationTasks, "generation_tasks_attempt_count_range")
      )
    ).toBe(
      '"generation_tasks"."attempt_count" >= 0 and "generation_tasks"."attempt_count" <= "generation_tasks"."max_attempts"'
    );
    expect(
      checkExpression(
        checkByName(generationTasks, "generation_tasks_max_attempts_range")
      )
    ).toBe(
      '"generation_tasks"."max_attempts" >= 1 and "generation_tasks"."max_attempts" <= 5'
    );
    expect(
      checkExpression(
        checkByName(generationTasks, "generation_tasks_state_lease_consistency")
      )
    ).toBe(
      '("generation_tasks"."status" = \'running\' and "generation_tasks"."lease_owner" is not null and "generation_tasks"."lease_expires_at" is not null and "generation_tasks"."heartbeat_at" is not null) or ("generation_tasks"."status" <> \'running\' and "generation_tasks"."lease_owner" is null)'
    );
  });

  it("defines the permit table primary key, indexes, and slot check", () => {
    const config = getTableConfig(generationConcurrencyLeases);

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
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0].name).toBe("generation_concurrency_leases_pk");
    expect(config.primaryKeys[0].columns.map((column) => column.name)).toEqual([
      "scope_key",
      "slot_number",
    ]);

    const taskScopeIndex = indexByName(
      generationConcurrencyLeases,
      "generation_concurrency_leases_task_scope_idx"
    );
    const taskIndex = indexByName(
      generationConcurrencyLeases,
      "generation_concurrency_leases_task_id_idx"
    );
    const expiresIndex = indexByName(
      generationConcurrencyLeases,
      "generation_concurrency_leases_expires_at_idx"
    );

    expect(taskScopeIndex.config.unique).toBe(true);
    expect(indexColumns(taskScopeIndex)).toEqual([
      { name: "task_id", order: "asc" },
      { name: "scope_key", order: "asc" },
    ]);
    expect(taskIndex.config.unique).toBe(false);
    expect(indexColumns(taskIndex)).toEqual([
      { name: "task_id", order: "asc" },
    ]);
    expect(expiresIndex.config.unique).toBe(false);
    expect(indexColumns(expiresIndex)).toEqual([
      { name: "expires_at", order: "asc" },
    ]);
    expect(
      checkExpression(
        checkByName(
          generationConcurrencyLeases,
          "generation_concurrency_leases_slot_positive"
        )
      )
    ).toBe('"generation_concurrency_leases"."slot_number" >= 1');
  });

  it("preserves generated asset output idempotency", () => {
    const taskOutputIndex = indexByName(
      generatedAssets,
      "generated_assets_task_output_idx"
    );

    expect(taskOutputIndex.config.unique).toBe(true);
    expect(indexColumns(taskOutputIndex)).toEqual([
      { name: "task_id", order: "asc" },
      { name: "output_index", order: "asc" },
    ]);
  });

  it("keeps the migration SQL aligned with the queue contract", () => {
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "generation_tasks_runnable_idx"\s+ON "generation_tasks" \("status", "priority" DESC, "next_attempt_at", "created_at"\);/
    );
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "generation_tasks_expired_lease_idx"\s+ON "generation_tasks" \("status", "lease_expires_at"\)\s+WHERE "status" = 'running';/
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "generation_tasks_user_id_idempotency_key_idx"\s+ON "generation_tasks" \("user_id", "idempotency_key"\)\s+WHERE "idempotency_key" IS NOT NULL;/
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "generation_concurrency_leases_pk" PRIMARY KEY ("scope_key", "slot_number")'
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "generation_concurrency_leases_task_scope_idx"'
    );
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "generation_concurrency_leases_task_id_idx"'
    );
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "generation_concurrency_leases_expires_at_idx"'
    );
    expect(migrationSql).toContain(
      'CHECK ("attempt_count" >= 0 AND "attempt_count" <= "max_attempts")'
    );
    expect(migrationSql).toContain(
      'CHECK ("max_attempts" >= 1 AND "max_attempts" <= 5)'
    );
    expect(migrationSql).toContain(
      '"lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL'
    );

    for (const constraintName of [
      "generation_tasks_attempt_count_range",
      "generation_tasks_max_attempts_range",
      "generation_tasks_state_lease_consistency",
    ]) {
      expect(migrationSql).toMatch(
        new RegExp(
          `WHERE conname = '${constraintName}'\\s+AND conrelid = 'generation_tasks'::regclass`
        )
      );
    }
  });

  it("registers the async generation worker migration in the journal", () => {
    expect(migrationJournal.entries).toContainEqual(
      expect.objectContaining({
        idx: 7,
        version: "7",
        tag: "0007_async_generation_worker",
        breakpoints: true,
      })
    );
  });
});
