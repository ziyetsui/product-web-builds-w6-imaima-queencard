import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getMySubscription: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/services/billing", () => ({
  getMySubscription: mocks.getMySubscription,
}));

vi.mock("@/db", () => ({
  db: { execute: mocks.execute },
}));

import { GET } from "./route";

describe("GET /api/v1/user/billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.execute.mockResolvedValue([]);
    mocks.getMySubscription.mockResolvedValue({
      plan: "PRO",
      status: "active",
      cancelAtPeriodEnd: true,
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("returns the authenticated user's current subscription alongside invoices", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/user/billing") as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        user: {
          id: "user_123",
          email: "user@example.com",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        subscription: {
          plan: "PRO",
          status: "active",
          cancelAtPeriodEnd: true,
          endsAt: "2026-09-01T00:00:00.000Z",
        },
        invoices: [],
        nextCursor: null,
        hasMore: false,
      },
    });
  });
});
