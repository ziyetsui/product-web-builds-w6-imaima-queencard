import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGptProtoV3Task,
  GptProtoRequestError,
  isGptProtoInsufficientBalanceError,
} from "./gptproto";

describe("GPTProto request errors", () => {
  beforeEach(() => {
    process.env.GPTPROTO_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GPTPROTO_API_KEY;
  });

  it("classifies insufficient balance and does not retry auth", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Insufficient balance" } }), {
        status: 403,
        statusText: "Forbidden",
      })
    );

    const promise = createGptProtoV3Task({ body: { prompt: "test" } });
    await expect(promise).rejects.toBeInstanceOf(GptProtoRequestError);
    await expect(promise).rejects.toMatchObject({
      status: 403,
      code: "GPTPROTO_INSUFFICIENT_BALANCE",
    });
    await promise.catch((error) => {
      expect(isGptProtoInsufficientBalanceError(error)).toBe(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still retries once with a raw key for an authentication response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid signature" }), {
          status: 401,
          statusText: "Unauthorized",
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_1" }), { status: 200 })
      );

    await expect(
      createGptProtoV3Task({ body: { prompt: "test" } })
    ).resolves.toMatchObject({ id: "task_1" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
