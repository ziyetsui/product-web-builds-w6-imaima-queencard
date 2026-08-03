import { describe, expect, it } from "vitest";
import type { XhsPromptCase } from "@/features/prompt-replication/data/xhsPromptCases";
import { boLandingPromptCases } from "@/features/prompt-replication/data/boLandingPromptCases";
import { xhsPromptCases } from "@/features/prompt-replication/data/xhsPromptCases";
import { compileStyleRecreationPrompt } from "@/features/style-recreation/prompt-compiler";
import { getPatternById } from "@/features/style-recreation/pattern-registry";
import {
  analyzeSource,
  buildReplicationPrompt,
  instantiateTitle,
  parseReplicationPrompt,
} from "../lib/prompt-replication";

const funnyComicCase: XhsPromptCase = {
  id: "funny-comic-example",
  title: "鸡，谁懂？",
  subtitle: "参考首图生成同结构新主题",
  category: "搞笑漫画",
  author: "Tila酱",
  date: "2025-10-09",
  image: "/xhs-cases/chicken.jpg",
  images: ["/xhs-cases/chicken.jpg"],
  noteUrl: "https://www.xiaohongshu.com/explore/example",
  authorUrl: "https://www.xiaohongshu.com/user/example",
  topics: ["冷笑话", "搞笑日常", "原创漫画", "鸡", "抽象"],
  likes: 100000,
  saves: 40000,
  shares: 74000,
  likesText: "10w",
  savesText: "4w",
  sharesText: "7.4w",
  prompt: "参考图文《鸡，谁懂？》的节奏、反差包袱、分镜密度和标题语气，生成一组新的小红书搞笑漫画主题：标题《当代人正在经历的8个离谱瞬间》，副标题“把生活小崩溃画成轻松好笑的连环图文”。",
  sourceTitle: "鸡，谁懂？",
};

describe("prompt replication (v4 pattern engine)", () => {
  it("composes the hidden prompt from DNA and default variables", () => {
    const analysis = analyzeSource(funnyComicCase);
    const prompt = buildReplicationPrompt(funnyComicCase);

    expect(analysis.sourceTheme).toBe("冷笑话");
    expect(prompt).toContain("逐项复刻原图的节奏、反差包袱、分镜密度和标题语气");
    expect(prompt).toContain("主标题换成「冷笑话，谁懂？」");
    expect(prompt).toContain("画面主体从原主题换成「冷笑话」");
  });

  it("always includes the watermark and no-analysis-text clauses", () => {
    const prompt = buildReplicationPrompt(funnyComicCase);
    expect(prompt).toContain("去除图片中的水印和平台账号字样");
    expect(prompt).toContain("禁止出现任何说明、分析或指令类文字");
  });

  it("excludes generic tags when selecting the source theme", () => {
    const analysis = analyzeSource({
      ...funnyComicCase,
      topics: ["漫画", "原创漫画", "小红书", "宠物日常", "狗狗"],
    });

    expect(analysis.sourceTheme).toBe("宠物日常");
  });

  it("instantiates known title patterns with the new topic", () => {
    const howTo = instantiateTitle(
      analyzeSource({ ...funnyComicCase, sourceTitle: "如何用一年时间彻底改变你的人生" }),
      "副业",
    );
    expect(howTo).toBe("如何用7天时间搞定副业");

    const whoKnows = instantiateTitle(analyzeSource(funnyComicCase), "打工人失眠");
    expect(whoKnows).toBe("打工人失眠，谁懂？");
  });

  it("falls back to swapping the source topic inside the raw title", () => {
    const analysis = analyzeSource({
      ...funnyComicCase,
      topics: ["冷笑话"],
      sourceTitle: "冷笑话大全看这篇",
    });
    expect(instantiateTitle(analysis, "职场吐槽")).toBe("职场吐槽大全看这篇");
  });

  it("sanitizes nested quotes and brackets so the prompt stays parseable", () => {
    const prompt = buildReplicationPrompt({
      ...funnyComicCase,
      sourceTitle: "睡眠差其实是“五脏有伤”",
    });

    expect(parseReplicationPrompt(prompt)).not.toBeNull();
  });

  it("round-trips build and parse", () => {
    const prompt = buildReplicationPrompt(funnyComicCase);
    expect(parseReplicationPrompt(prompt)).toEqual({
      visual: "节奏、反差包袱、分镜密度和标题语气",
      title: "冷笑话，谁懂？",
      topic: "冷笑话",
    });
  });

  it("uses reviewed Patterns for configured route cards without the v4 contract", () => {
    const configuredCases = xhsPromptCases.filter((item) => item.patternId);
    expect(configuredCases).toHaveLength(20);
    for (const item of configuredCases) {
      const pattern = getPatternById(item.patternId!);
      expect(pattern).toBeDefined();
      const values = Object.fromEntries(pattern!.variables.map((variable) => {
        if (variable.defaultValue !== undefined) return [variable.key, variable.defaultValue];
        if (variable.type === "enum") return [variable.key, variable.options![0]!.value];
        if (variable.type === "number") return [variable.key, variable.min!];
        return [variable.key, `${variable.label}内容`];
      }));
      const compiled = compileStyleRecreationPrompt({ pattern, values });
      expect(compiled.ok).toBe(true);
      if (compiled.ok) expect(compiled.value.prompt).not.toContain("逐项复刻原图");
    }
    expect(boLandingPromptCases.every((item) => !item.patternId)).toBe(true);
  });
});
