import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  requireAuth: vi.fn(),
  createImageGenerationTask: vi.fn(),
  runImageGenerationTask: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/services/image-generation", () => ({
  createImageGenerationTask: mocks.createImageGenerationTask,
  runImageGenerationTask: mocks.runImageGenerationTask,
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
    mocks.runImageGenerationTask.mockImplementation(() => new Promise(() => {}));
  });

  it("returns the created task before running provider generation", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/image-generations", {
        method: "POST",
        body: JSON.stringify({ prompt: "make a poster" }),
      })
    );

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        taskId: "gen_123",
        status: "queued",
        redirectUrl: "/generated?taskId=gen_123",
      },
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.runImageGenerationTask).not.toHaveBeenCalled();

    const scheduled = mocks.after.mock.calls[0]?.[0] as (() => void) | undefined;
    scheduled?.();
    expect(mocks.runImageGenerationTask).toHaveBeenCalledWith("user_123", "gen_123");
  });
});
