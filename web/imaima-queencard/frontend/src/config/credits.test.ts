import { describe, expect, it } from "vitest";

import {
  calculateModelCredits,
  getAvailableModels,
  getModelConfig,
} from "./credits";

describe("image credit pricing", () => {
  it.each([
    ["gpt-image-2-all", 4],
    ["nano-banana-2", 5],
    ["gemini-3.1-flash-edit", 5],
    ["seedream-5-0-260128", 4],
    ["seedream-5-edit", 4],
    ["gpt-image-2-edit", 5],
    ["doubao-seedream-5-edit", 4],
    ["viduq2-i2i", 3],
  ])("charges image model credits for %s", (modelId, expectedCredits) => {
    expect(calculateModelCredits(modelId as string)).toBe(expectedCredits);
  });

  it("charges per successful output image", () => {
    expect(calculateModelCredits("nano-banana-2", { outputNumber: 3 })).toBe(15);
    expect(calculateModelCredits("gpt-image-2-edit", { outputNumber: 4 })).toBe(20);
  });

  it("charges a flat v1 credit tier for Gemini 3.1 Flash", () => {
    expect(calculateModelCredits("gemini-3.1-flash-edit", { resolution: "1k" })).toBe(5);
    expect(calculateModelCredits("gemini-3.1-flash-edit", { resolution: "2k" })).toBe(5);
    expect(calculateModelCredits("gemini-3.1-flash-edit", { resolution: "4k" })).toBe(5);
  });

  it("charges Vidu Q2 by resolution and reference image tier", () => {
    expect(
      calculateModelCredits("viduq2-i2i", {
        resolution: "1080p",
        referenceImageCount: 1,
      })
    ).toBe(3);
    expect(
      calculateModelCredits("viduq2-i2i", {
        resolution: "2k",
        referenceImageCount: 3,
      })
    ).toBe(6);
    expect(
      calculateModelCredits("viduq2-i2i", {
        resolution: "4k",
        referenceImageCount: 4,
      })
    ).toBe(15);
  });

  it("exposes enabled image model configs", () => {
    expect(getAvailableModels().map((model) => model.id)).toEqual([
      "gemini-3.1-flash-edit",
      "seedream-5-edit",
      "gpt-image-2-edit",
      "doubao-seedream-5-edit",
      "viduq2-i2i",
    ]);
    expect(getModelConfig("gpt-image-2-all")?.creditCost.base).toBe(4);
  });

  it("falls back to one credit for unknown models", () => {
    expect(calculateModelCredits("unknown-model")).toBe(1);
  });
});
