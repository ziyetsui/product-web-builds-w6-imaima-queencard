import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

vi.mock("@/db", () => ({
  db: {},
  generatedAssets: {},
  generationTasks: {},
}));

vi.mock("@/services/image-provider", () => ({
  generateImageWithCredits: vi.fn(),
}));

vi.mock("@/services/credit", () => ({
  creditService: {},
}));

import { estimateImageGeneration } from "./image-generation";

describe("image generation validation", () => {
  it("rejects disabled legacy image models", () => {
    expect(() =>
      estimateImageGeneration({
        prompt: "make a poster",
        model: "kling-image-o1-i2i",
        referenceImages: ["https://example.com/reference.png"],
      })
    ).toThrow(ApiError);
  });

  it("estimates enabled Vidu Q2 resolution tiers", () => {
    expect(
      estimateImageGeneration({
        prompt: "make a poster",
        model: "viduq2-i2i",
        referenceImages: ["https://example.com/reference.png"],
        resolution: "4k",
        outputCount: 2,
      })
    ).toMatchObject({
      estimatedCredits: 7,
      modelCreditsPerImage: 7,
      model: "viduq2-i2i",
      capability: "image-to-image",
    });
  });

  it("rejects no-reference image generation", () => {
    expect(
      () => estimateImageGeneration({
        prompt: "make a poster",
        model: "seedream-5-edit",
        outputCount: 4,
      })
    ).toThrow(ApiError);
  });
});
