import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  trx: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  tables: {
    creditHolds: {
      id: "creditHolds.id",
      videoUuid: "creditHolds.videoUuid",
    },
    creditPackages: {
      id: "creditPackages.id",
      userId: "creditPackages.userId",
      status: "creditPackages.status",
      remainingCredits: "creditPackages.remainingCredits",
      frozenCredits: "creditPackages.frozenCredits",
      expiredAt: "creditPackages.expiredAt",
      createdAt: "creditPackages.createdAt",
    },
    creditTransactions: {},
    customers: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  asc: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  })),
  gt: vi.fn((column: unknown, value: unknown) => ({
    type: "gt",
    column,
    value,
  })),
  isNull: vi.fn((column: unknown) => ({ type: "isNull", column })),
  lt: vi.fn(),
  or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
  sql: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: mocks.db,
  creditHolds: mocks.tables.creditHolds,
  creditPackages: mocks.tables.creditPackages,
  creditTransactions: mocks.tables.creditTransactions,
  customers: mocks.tables.customers,
  CreditPackageStatus: {
    ACTIVE: "ACTIVE",
    DEPLETED: "DEPLETED",
    EXPIRED: "EXPIRED",
  },
  CreditTransType: {
    VIDEO_CONSUME: "VIDEO_CONSUME",
    REFUND: "REFUND",
  },
}));

import { CreditService } from "./credit";

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function comparisonValue(condition: any, column: string) {
  const conditions = condition?.type === "and"
    ? condition.conditions
    : [condition];
  return conditions.find((item: any) => item?.column === column)?.value;
}

function transactionalCreditDb() {
  let committed = {
    packages: [
      {
        id: 1,
        userId: "user_1",
        status: "ACTIVE",
        initialCredits: 10,
        remainingCredits: 10,
        frozenCredits: 0,
        expiredAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
    holds: [] as any[],
  };
  let pending = committed;

  mocks.db.transaction.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
    pending = {
      packages: committed.packages.map((pkg) => ({ ...pkg })),
      holds: committed.holds.map((hold) => ({ ...hold })),
    };

    const trx = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn((condition: unknown) => ({
            limit: vi.fn(async () => {
              if (table === mocks.tables.creditHolds) {
                const videoUuid = comparisonValue(
                  condition,
                  "creditHolds.videoUuid"
                );
                const hold = pending.holds.find(
                  (candidate) => candidate.videoUuid === videoUuid
                );
                return hold ? [hold] : [];
              }
              return [];
            }),
            orderBy: vi.fn(async () => pending.packages),
          })),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async (condition: unknown) => {
            if (table === mocks.tables.creditPackages) {
              const packageId = comparisonValue(condition, "creditPackages.id");
              const pkg = pending.packages.find(
                (candidate) => candidate.id === packageId
              );
              if (pkg) Object.assign(pkg, values);
            }
          }),
        })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            if (table !== mocks.tables.creditHolds) return [];
            const hold = { id: pending.holds.length + 1, ...values };
            pending.holds.push(hold);
            return [{ id: hold.id }];
          }),
        })),
      })),
    };

    const result = await callback(trx);
    committed = pending;
    return result;
  });

  return {
    committed: () => committed,
    pending: () => pending,
  };
}

describe("transaction-aware credit primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.transaction.mockImplementation(
      async (callback: (trx: typeof mocks.trx) => Promise<unknown>) =>
        callback(mocks.trx)
    );
  });

  it("keeps freeze compatible by delegating its exact work to freezeInTx", async () => {
    const service = new CreditService();
    const params = { userId: "user_1", credits: 4, videoUuid: "gen_1" };
    const primitive = vi
      .spyOn(service, "freezeInTx")
      .mockResolvedValue({ success: true, holdId: 12 });

    await expect(service.freeze(params)).resolves.toEqual({
      success: true,
      holdId: 12,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(primitive).toHaveBeenCalledWith(mocks.trx, params);
  });

  it("keeps settlePartial compatible by delegating to settlePartialInTx", async () => {
    const service = new CreditService();
    const primitive = vi
      .spyOn(service, "settlePartialInTx")
      .mockResolvedValue(undefined);

    await service.settlePartial("gen_1", 3);

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(primitive).toHaveBeenCalledWith(mocks.trx, "gen_1", 3);
  });

  it("keeps release compatible by delegating to releaseInTx", async () => {
    const service = new CreditService();
    const primitive = vi
      .spyOn(service, "releaseInTx")
      .mockResolvedValue(undefined);

    await service.release("gen_1");

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(primitive).toHaveBeenCalledWith(mocks.trx, "gen_1");
  });

  it("reuses an existing holding hold inside the caller transaction", async () => {
    const service = new CreditService();
    mocks.trx.select.mockReturnValue(
      selectRows([{ id: 12, status: "HOLDING" }]) as any
    );

    await expect(
      service.freezeInTx(mocks.trx as any, {
        userId: "user_1",
        credits: 4,
        videoUuid: "gen_1",
      })
    ).resolves.toEqual({ success: true, holdId: 12 });
    expect(mocks.trx.update).not.toHaveBeenCalled();
    expect(mocks.trx.insert).not.toHaveBeenCalled();
  });

  it("rolls back real package allocation and hold insertion after a later failure", async () => {
    const service = new CreditService();
    const state = transactionalCreditDb();

    await expect(
      mocks.db.transaction(async (trx: any) => {
        await service.freezeInTx(trx, {
          userId: "user_1",
          credits: 4,
          videoUuid: "gen_1",
        });

        expect(state.pending().packages[0]).toMatchObject({
          remainingCredits: 6,
          frozenCredits: 4,
        });
        expect(state.pending().holds).toHaveLength(1);
        throw new Error("task follow-up failed");
      })
    ).rejects.toThrow("task follow-up failed");

    expect(state.committed().packages[0]).toMatchObject({
      remainingCredits: 10,
      frozenCredits: 0,
    });
    expect(state.committed().holds).toEqual([]);
  });
});
