import { describe, expect, it } from "vitest";

import { xhsPromptCases } from "@/data/xhsPromptCases";
import { styleRecreationPatterns } from "@/data/styleRecreationPatterns";
import {
  getPatternById,
  getPatternForSourceCase,
  getPatternRegistryValidation,
  getSuggestedPatternValues,
  validateSuggestedPatternValues,
} from "./pattern-registry";

describe("style recreation pattern registry", () => {
  it("contains exactly twenty valid, uniquely bound reviewed patterns", () => {
    const validation = getPatternRegistryValidation();
    expect(validation).toEqual({ valid: true, patternCount: 20, sourceBindingCount: 20 });
    expect(new Set(styleRecreationPatterns.map((pattern) => pattern.id)).size).toBe(20);
    expect(new Set(styleRecreationPatterns.flatMap((pattern) => pattern.sourceCaseIds)).size).toBe(20);
  });

  it("binds the first twenty curated cases and supports lookup both ways", () => {
    const boundCases = xhsPromptCases.filter((item) => item.patternId);
    expect(boundCases).toHaveLength(20);
    expect(boundCases[0]?.id).toBe("20251009-27");
    expect(boundCases[19]?.id).toBe("660e6171000000001a010564");

    for (const item of boundCases) {
      const pattern = getPatternForSourceCase(item.id);
      expect(pattern?.id).toBe(item.patternId);
      expect(getPatternById(item.patternId!)?.sourceCaseIds).toContain(item.id);
    }
  });

  it("has five patterns in each reviewed content family", () => {
    const familyCounts = styleRecreationPatterns.reduce<Record<string, number>>((counts, pattern) => {
      const family = pattern.id.replace(/-\d+$/, "");
      counts[family] = (counts[family] ?? 0) + 1;
      return counts;
    }, {});
    expect(familyCounts).toEqual({
      "wordplay-reveal": 5,
      "visual-metaphor-emotion": 5,
      "collectible-checklist": 5,
      "narrative-resonance": 5,
    });
  });

  it("gives all twenty cases a three-slot sentence and complete suggestions", () => {
    const boundCases = xhsPromptCases.filter((item) => item.patternId);
    for (const item of boundCases) {
      const pattern = getPatternForSourceCase(item.id)!;
      expect(pattern.variables.some((variable) => variable.key === "headline"), pattern.id).toBe(false);
      expect(pattern.variables).toHaveLength(3);
      expect(pattern.fillTemplate).toContain("{{topic}}");
      expect(Object.keys(item.suggestedPatternValues ?? {}).sort()).toEqual(
        pattern.variables.map((variable) => variable.key).sort(),
      );
      expect(getSuggestedPatternValues(item.id)).toEqual(item.suggestedPatternValues);
    }
    expect(boundCases[0]?.suggestedPatternValues).toEqual({
      topic: "AI 创业",
      setup: "程序员加班",
      punchline: "模型又崩了",
    });
  });

  it("rejects incomplete, unknown, and invalid suggested values", () => {
    const pattern = styleRecreationPatterns.find((item) => item.id === "collectible-checklist-1")!;
    expect(validateSuggestedPatternValues(pattern, { topic: "职场", audience: "新人" }).ok).toBe(false);
    expect(validateSuggestedPatternValues(pattern, { topic: "职场", audience: "新人", item_count: 6, extra: "未知" }).ok).toBe(false);
    expect(validateSuggestedPatternValues(pattern, { topic: "职场", audience: "新人", item_count: 99 }).ok).toBe(false);
  });
});
