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
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  gt: vi.fn((...args: unknown[]) => ({ op: "gt", args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: "isNull", args })),
  or: vi.fn((...args: unknown[]) => ({ op: "or", args })),
}));

vi.mock("@/db", () => ({
  db: mocks.db,
  creditPackages: {
    id: "creditPackages.id",
    userId: "creditPackages.userId",
    remainingCredits: "creditPackages.remainingCredits",
    status: "creditPackages.status",
    expiredAt: "creditPackages.expiredAt",
  },
  creditTransactions: {},
  paymentFulfillments: {
    id: "paymentFulfillments.id",
    fulfillmentKey: "paymentFulfillments.fulfillmentKey",
  },
  CreditPackageStatus: {
    ACTIVE: "ACTIVE",
    DEPLETED: "DEPLETED",
    EXPIRED: "EXPIRED",
  },
  CreditTransType: {
    ORDER_PAY: "ORDER_PAY",
    SUBSCRIPTION: "SUBSCRIPTION",
  },
  PaymentFulfillmentStatus: {
    PENDING: "PENDING",
    FULFILLED: "FULFILLED",
    SKIPPED: "SKIPPED",
    FAILED: "FAILED",
    REFUNDED: "REFUNDED",
  },
}));

import {
  createPendingFulfillment,
  fulfillCreditGrantOnce,
} from "./payment-fulfillment";

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function lockedSelectRows(rows: unknown[], lock: ReturnType<typeof vi.fn>) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
        for: lock.mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      })),
    })),
  };
}

function insertRows(rows: unknown[]) {
  return {
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(rows),
      })),
      returning: vi.fn().mockResolvedValue(rows),
    })),
  };
}

describe("payment fulfillment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.trx));
  });

  it("creates pending fulfillments with a unique fulfillment key", async () => {
    const created = {
      id: 1,
      fulfillmentKey: "stripe:invoice:in_123",
      status: "PENDING",
    };
    mocks.db.insert.mockReturnValue(insertRows([created]));

    await expect(
      createPendingFulfillment({
        fulfillmentKey: "stripe:invoice:in_123",
        credits: 600,
      })
    ).resolves.toEqual(created);
  });

  it("returns the existing fulfillment when unique-key insert is ignored", async () => {
    const existing = {
      id: 1,
      fulfillmentKey: "stripe:invoice:in_123",
      status: "FULFILLED",
    };
    mocks.db.insert.mockReturnValue(insertRows([]));
    mocks.db.select.mockReturnValue(selectRows([existing]));

    await expect(
      createPendingFulfillment({
        fulfillmentKey: "stripe:invoice:in_123",
        credits: 600,
      })
    ).resolves.toEqual(existing);
  });

  it.each(["FULFILLED", "REFUNDED", "FAILED", "SKIPPED"])(
    "locks an existing %s fulfillment before refusing a duplicate grant",
    async (status) => {
      const lock = vi.fn();
    const existing = {
      id: 1,
      fulfillmentKey: "stripe:invoice:in_123",
        status,
      creditPackageId: 42,
    };
      mocks.trx.insert.mockReturnValue(insertRows([]));
      mocks.trx.select.mockReturnValue(lockedSelectRows([existing], lock));

    await expect(
      fulfillCreditGrantOnce({
        fulfillmentKey: "stripe:invoice:in_123",
        userId: "user_123",
        productKey: "creator_monthly",
        credits: 600,
        transType: "SUBSCRIPTION",
        orderNo: "stripe_invoice_in_123",
        expiryDays: 30,
        remark: "Stripe subscription credits",
      })
    ).resolves.toEqual({
      fulfilled: false,
      fulfillment: existing,
      packageId: 42,
    });
      expect(mocks.trx.insert).toHaveBeenCalledTimes(1);
      expect(lock).toHaveBeenCalledWith("update");
    }
  );
});
