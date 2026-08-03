import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createImageGenerationTask: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/services/image-generation", () => ({
  createImageGenerationTask: mocks.createImageGenerationTask,
}));

import { POST } from "./route";

describe("image generation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: "user_123" });
    mocks.createImageGenerationTask.mockResolvedValue({
      taskId: "gen_123",
      status: "queued",
    });
  });

  it("returns 202 with polling URLs without scheduling provider generation", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/image-generations", {
        method: "POST",
        body: JSON.stringify({ prompt: "make a poster" }),
      })
    );

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
});
