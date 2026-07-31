import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  recharge: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/services/credit", () => ({
  creditService: {
    recharge: mocks.recharge,
  },
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/v1/admin/credits/add", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("admin credits add route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin_123", isAdmin: true });
    mocks.recharge.mockResolvedValue({ packageId: 42 });
  });

  it("returns 404 in production when debug is not explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IS_DEBUG", "false");

    const response = await POST(request({ credits: 100 }));
    const json = await readJson(response);

    expect(response.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.recharge).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid credits and does not write", async () => {
    const response = await POST(request({ credits: 0 }));
    const json = await readJson(response);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      success: false,
      error: { message: "Invalid credits value" },
    });
    expect(mocks.recharge).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    mocks.requireAdmin.mockRejectedValue(new ApiError("Forbidden", 403));

    const response = await POST(request({ credits: 100 }));
    const json = await readJson(response);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      success: false,
      error: { message: "Forbidden" },
    });
  });

  it("returns packageId, targetUserId, and credits on success", async () => {
    const response = await POST(
      request({ userId: "user_123", credits: 100, expiryDays: 30 })
    );
    const json = await readJson(response);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: {
        packageId: 42,
        targetUserId: "user_123",
        credits: 100,
      },
    });
    expect(mocks.recharge).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        credits: 100,
        expiryDays: 30,
      })
    );
  });
});
