import { describe, expect, it, vi } from "vitest";

import {
  createGenerationObservability,
  redactGenerationEvent,
} from "./generation-observability";

describe("generation observability", () => {
  it("removes prompts, identities, credentials, and reference URLs", () => {
    expect(
      redactGenerationEvent({
        taskId: "gen_1",
        userId: "user_1",
        prompt: "secret prompt",
        referenceImageUrl: "https://secret.example/image.png?token=abc",
        databaseUrl: "postgresql://secret",
        apiKey: "secret",
      })
    ).toEqual({ taskId: "gen_1" });
  });

  it("records bounded-label counters and timing summaries", () => {
    const write = vi.fn();
    const metrics = createGenerationObservability(write);
    metrics.increment("generation_claimed");
    metrics.increment("generation_claimed", 2);
    metrics.observe("generation_duration_ms", 20);
    metrics.event("generation_finished", { taskId: "gen_1", prompt: "hidden" });
    expect(metrics.snapshot()).toEqual({
      counters: { generation_claimed: 3 },
      timings: { generation_duration_ms: { count: 1, sumMs: 20 } },
    });
    expect(write).toHaveBeenCalledWith({
      name: "generation_finished",
      taskId: "gen_1",
    });
  });
});
