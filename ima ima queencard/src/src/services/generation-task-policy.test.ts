import { describe, expect, it } from "vitest";

import {
  buildGenerationScopes,
  classifyGenerationFailure,
  nextGenerationAttemptAt,
} from "./generation-task-policy";

describe("generation task policy", () => {
  it("builds three sorted scopes", () => {
    expect(
      buildGenerationScopes({
        userId: "user_1",
        provider: "gptproto",
        providerModel: "gpt-image-2",
      })
    ).toEqual([
      "global",
      "provider:gptproto:gpt-image-2",
      "user:user_1",
    ]);
  });

  it("classifies 429 as transient and invalid input as permanent", () => {
    expect(
      classifyGenerationFailure(
        Object.assign(new Error("rate limit"), { status: 429 })
      ).category
    ).toBe("transient");
    expect(
      classifyGenerationFailure(
        Object.assign(new Error("invalid model"), { status: 400 })
      ).category
    ).toBe("permanent");
  });

  it("uses deterministic jitter for the second retry", () => {
    const now = new Date("2026-08-02T00:00:00Z");
    expect(
      nextGenerationAttemptAt({ attemptCount: 2, now, random: () => 0.5 })
    ).toEqual(new Date("2026-08-02T00:00:30Z"));
  });

  it("honors and caps provider Retry-After values", () => {
    const failure = classifyGenerationFailure(
      Object.assign(new Error("rate limit"), { status: 429, retryAfter: 600 })
    );
    const now = new Date("2026-08-02T00:00:00Z");

    expect(failure).toEqual({ category: "transient", retryAfterMs: 600_000 });
    expect(
      nextGenerationAttemptAt({
        attemptCount: 1,
        now,
        random: () => 0.5,
        retryAfterMs: 9_999_999,
      })
    ).toEqual(new Date("2026-08-02T00:15:00Z"));
  });
});
