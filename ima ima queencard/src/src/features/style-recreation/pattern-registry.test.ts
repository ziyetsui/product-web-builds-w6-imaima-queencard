import { describe, expect, it } from "vitest";

import { xhsPromptCases } from "@/features/prompt-replication/data/xhsPromptCases";
import { boLandingPromptCases } from "@/features/prompt-replication/data/boLandingPromptCases";
import { styleRecreationPatterns } from "@/features/prompt-replication/data/styleRecreationPatterns";
import { compileStyleRecreationPrompt } from "./prompt-compiler";
import {
  getPatternById,
  getPatternForSourceCase,
  getPatternForPromptCase,
  getPatternRegistryValidation,
  getSuggestedPatternValues,
  getSuggestedPatternValuesForCase,
  validateSuggestedPatternValues,
} from "./pattern-registry";

describe("style recreation pattern registry", () => {
  it("contains reviewed reference Patterns plus generic series Patterns", () => {
    const validation = getPatternRegistryValidation();
    expect(validation).toEqual({ valid: true, patternCount: 24, sourceBindingCount: 122, sourceCaseCount: 122 });
    expect(new Set(styleRecreationPatterns.map((pattern) => pattern.id)).size).toBe(24);
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
      "library-meme-series": 1,
      "library-article-cover-series": 1,
      "library-social-post-series": 1,
      "library-universal-series": 1,
    });
  });

  it("gives every Prompt library card a valid editable Pattern and defaults", () => {
    const allCases = [...xhsPromptCases, ...boLandingPromptCases];
    expect(allCases).toHaveLength(2277);
    for (const item of allCases) {
      const pattern = getPatternForPromptCase(item);
      const suggestions = getSuggestedPatternValuesForCase(item);
      expect(pattern, item.id).toBeDefined();
      expect(suggestions, item.id).toBeDefined();
      expect(validateSuggestedPatternValues(pattern!, suggestions!).ok, item.id).toBe(true);
      const compiled = compileStyleRecreationPrompt({ pattern, values: suggestions! });
      expect(compiled.ok, item.id).toBe(true);
      if (compiled.ok) expect(compiled.value.prompt, item.id).not.toContain("逐项复刻原图");
      expect(pattern!.variables.some((variable) => variable.semanticRole === "visual_style"), item.id).toBe(true);
      expect(pattern!.variables.some((variable) => variable.key === "topic"), item.id).toBe(true);
    }
  });

  it("gives all twenty cases one editable style slot and three content slots", () => {
    const boundCases = xhsPromptCases.filter((item) => item.patternId);
    for (const item of boundCases) {
      const pattern = getPatternForSourceCase(item.id)!;
      expect(pattern.variables.some((variable) => variable.key === "headline"), pattern.id).toBe(false);
      expect(pattern.variables).toHaveLength(4);
      expect(pattern.fillTemplate).toContain("{{topic}}");
      expect(pattern.fillTemplate).toContain("{{visual_style}}");
      expect(pattern.variables.filter((variable) => variable.semanticRole === "visual_style")).toHaveLength(1);
      expect(pattern.variables.filter((variable) => variable.semanticRole === "content")).toHaveLength(3);
      expect(Object.keys(item.suggestedPatternValues ?? {}).sort()).toEqual(
        pattern.variables.filter((variable) => variable.defaultValue === undefined).map((variable) => variable.key).sort(),
      );
      expect(getSuggestedPatternValues(item.id)).toEqual({
        visual_style: pattern.variables.find((variable) => variable.key === "visual_style")?.defaultValue,
        ...item.suggestedPatternValues,
      });
    }
    expect(getSuggestedPatternValues(boundCases[0]!.id)).toEqual({
      visual_style: "极简线稿、克制留白和冷幽默",
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
