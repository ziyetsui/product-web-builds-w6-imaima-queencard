import { describe, expect, it } from "vitest";

import {
  IMAGE_GENERATION_MODEL_OPTIONS,
  defaultImageGenerationModel,
} from "./image-generation-models";

describe("image generation model options", () => {
  it("exposes only reference-image model choices", () => {
    expect(IMAGE_GENERATION_MODEL_OPTIONS.map((option) => option.id)).toEqual([
      "gpt-image-2-edit",
      "gemini-3.1-flash-edit",
      "seedream-5-edit",
      "doubao-seedream-5-edit",
      "viduq2-i2i",
    ]);
    expect(
      IMAGE_GENERATION_MODEL_OPTIONS.every(
        (option) =>
          option.capability === "image-edit" ||
          option.capability === "image-to-image"
      )
    ).toBe(true);
  });

  it("uses user-facing tier names without padding-image wording", () => {
    const vidu = IMAGE_GENERATION_MODEL_OPTIONS.find(
      (option) => option.id === "viduq2-i2i"
    );

    expect(vidu?.group).toBe("垫图");
    expect(
      IMAGE_GENERATION_MODEL_OPTIONS.every((option) => !option.label.includes("垫图"))
    ).toBe(true);
  });

  it("defaults to the main reference-image model", () => {
    expect(defaultImageGenerationModel(["https://example.com/ref.png"])).toBe("gpt-image-2-edit");
    expect(defaultImageGenerationModel([])).toBe("gpt-image-2-edit");
  });
});
