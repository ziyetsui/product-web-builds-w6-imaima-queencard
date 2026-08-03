import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  regenerateImageTask: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/services/image-generation", () => ({
  regenerateImageTask: mocks.regenerateImageTask,
}));

import { POST } from "./route";

describe("image regeneration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: "user_123" });
    mocks.regenerateImageTask.mockResolvedValue({
      taskId: "gen_new",
      status: "queued",
    });
  });

  it("returns a durable queued task with 202", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/image-generations/gen_old/regenerate", {
        method: "POST",
      }),
      { params: Promise.resolve({ taskId: "gen_old" }) }
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        taskId: "gen_new",
        status: "queued",
        statusUrl: "/api/v1/image-generations/gen_new",
        redirectUrl: "/generated?taskId=gen_new",
      },
    });
    expect(mocks.regenerateImageTask).toHaveBeenCalledWith("user_123", "gen_old");
  });
});
