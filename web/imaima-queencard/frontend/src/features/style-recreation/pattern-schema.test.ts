import { describe, expect, it } from "vitest";

import { validateStyleRecreationPattern } from "./pattern-schema";

const validPattern = {
  schemaVersion: "pattern/v1",
  id: "visual-metaphor",
  version: 1,
  level: "reference",
  name: "视觉隐喻",
  description: "把现实问题转译成新的视觉隐喻",
  fillTemplate: "沿用黑白木刻、高对比和大留白，创作关于{{topic}}的画面，让{{subject}}感受到{{emotion}}。",
  sourceCaseIds: ["case-1"],
  visualLanguage: {
    illustration: "黑白木刻版画",
    palette: ["黑", "白"],
    contrast: "high",
    compositionTendencies: ["单主体", "中心视觉重心"],
    whitespace: "large",
    typography: ["顶部大标题", "粗体"],
    strokeAndTexture: ["粗粝线条"],
    visualRhythm: ["强运动张力"],
    emotionalTone: ["压迫", "共鸣"],
  },
  contentPattern: {
    hook: "从现实困难切入",
    sequence: ["转译成视觉隐喻", "让主体与隐喻发生关系"],
    payoff: "形成情绪共鸣",
  },
  variables: [
    { key: "topic", label: "新主题", type: "short_text", required: true, maxLength: 30 },
    { key: "subject", label: "新主体", type: "short_text", required: true, maxLength: 40 },
    {
      key: "emotion",
      label: "新情绪",
      type: "enum",
      required: false,
      options: [
        { value: "anxiety", label: "焦虑" },
        { value: "pressure", label: "压迫" },
      ],
    },
  ],
  creativeConstraints: {
    preserve: ["抽象视觉媒介", "色彩逻辑"],
    transform: ["重新设计主体", "重新设计动作", "重新设计场景", "重新设计构图"],
    forbid: ["复制原文案", "复制原主体", "复制原场景", "复制账号", "复制水印"],
    create: ["创建新场景", "创建新动作", "创建新空间关系"],
  },
  review: { reviewer: "内容审核组", reviewedAt: "2026-08-02", usageRights: "reviewed" },
} as const;

describe("style recreation pattern schema", () => {
  it("accepts a complete reviewed pattern", () => {
    expect(validateStyleRecreationPattern(validPattern).success).toBe(true);
  });

  it("requires 3–4 variables and one required default-free short_text topic", () => {
    expect(validateStyleRecreationPattern({ ...validPattern, variables: validPattern.variables.slice(0, 2) }).success).toBe(false);
    expect(validateStyleRecreationPattern({
      ...validPattern,
      variables: [...validPattern.variables, { key: "scene", label: "场景", type: "short_text", required: false }, { key: "tone", label: "语气", type: "short_text", required: false }],
      fillTemplate: "{{topic}}{{subject}}{{emotion}}{{scene}}{{tone}}",
    }).success).toBe(false);
    expect(validateStyleRecreationPattern({
      ...validPattern,
      variables: validPattern.variables.map((variable) =>
        variable.key === "topic" ? { ...variable, required: false, defaultValue: "旧主题" } : variable,
      ),
    }).success).toBe(false);
  });

  it("requires every variable exactly once and rejects long text slots", () => {
    expect(validateStyleRecreationPattern({ ...validPattern, fillTemplate: "只使用{{topic}}" }).success).toBe(false);
    expect(validateStyleRecreationPattern({
      ...validPattern,
      variables: validPattern.variables.map((variable) => variable.key === "subject"
        ? { key: "subject", label: "新主体", type: "long_text", required: true, maxLength: 120 }
        : variable),
    }).success).toBe(false);
  });

  it("rejects invalid enum/number bounds and incomplete creation rules", () => {
    expect(validateStyleRecreationPattern({
      ...validPattern,
      variables: [
        ...validPattern.variables.slice(0, 2),
        { key: "pages", label: "页数", type: "number", required: false, min: 9, max: 2 },
      ],
    }).success).toBe(false);
    expect(validateStyleRecreationPattern({
      ...validPattern,
      creativeConstraints: { ...validPattern.creativeConstraints, create: ["创建新场景"] },
    }).success).toBe(false);
  });

  it("requires reviewed metadata and no more than five required fields", () => {
    const requiredVariables = ["topic", "subject", "metaphor", "emotion", "headline", "subtitle"].map((key) => ({
      key,
      label: key,
      type: "short_text" as const,
      required: true,
      maxLength: 30,
    }));
    expect(validateStyleRecreationPattern({ ...validPattern, variables: requiredVariables }).success).toBe(false);
    expect(validateStyleRecreationPattern({
      ...validPattern,
      review: { ...validPattern.review, reviewedAt: "not-a-date" },
    }).success).toBe(false);
  });
});
