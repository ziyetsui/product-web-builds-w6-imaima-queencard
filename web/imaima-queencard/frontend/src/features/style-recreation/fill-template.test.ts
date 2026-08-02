import { describe, expect, it } from "vitest";

import type { PatternVariable } from "./pattern-types";
import { parseFillTemplate, validateFillTemplate } from "./fill-template";

const variables: PatternVariable[] = [
  { key: "topic", label: "新主题", type: "short_text", required: true, maxLength: 30 },
  { key: "scene", label: "新场景", type: "short_text", required: true, maxLength: 40 },
];

describe("fill template", () => {
  it("parses fixed prose and slots in reading order", () => {
    expect(parseFillTemplate("创作关于{{topic}}的故事，用{{scene}}收尾。")).toEqual([
      { type: "text", value: "创作关于" },
      { type: "slot", key: "topic" },
      { type: "text", value: "的故事，用" },
      { type: "slot", key: "scene" },
      { type: "text", value: "收尾。" },
    ]);
  });

  it("rejects unknown, duplicate, missing, and malformed slots", () => {
    expect(validateFillTemplate("{{topic}}{{topic}}{{missing}}", variables).ok).toBe(false);
    expect(validateFillTemplate("只写{{topic}}", variables).ok).toBe(false);
    expect(validateFillTemplate("{{topic}}和{{scene", variables).ok).toBe(false);
  });

  it("rejects templates longer than 220 code points at maximum values", () => {
    const fixed = "字".repeat(170);
    expect(validateFillTemplate(`${fixed}{{topic}}{{scene}}`, variables).ok).toBe(false);
  });
});
