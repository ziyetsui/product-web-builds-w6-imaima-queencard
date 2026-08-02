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
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: mocks.db,
  creditHolds: { videoUuid: "creditHolds.videoUuid" },
  creditPackages: {},
  creditTransactions: {},
  customers: {},
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
});
