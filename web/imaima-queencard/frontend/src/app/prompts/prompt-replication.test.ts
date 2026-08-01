import { describe, expect, it } from "vitest";
import type { XhsPromptCase } from "@/data/xhsPromptCases";
import { boLandingPromptCases } from "@/data/boLandingPromptCases";
import { xhsPromptCases } from "@/data/xhsPromptCases";
import { analyzeSource, buildReplicationPrompt } from "./prompt-replication";

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

describe("prompt replication", () => {
  it("preserves the funny-comic type and source mechanisms while deriving a concrete topic", () => {
    const analysis = analyzeSource(funnyComicCase);
    const prompt = buildReplicationPrompt(funnyComicCase);

    expect(analysis.type).toBe("搞笑漫画");
    expect(analysis.sourceTheme).toBe("冷笑话");
    expect(prompt).toContain("生成一组新的搞笑漫画主题");
    expect(prompt).toContain("冷笑话，谁懂？");
    expect(prompt).toContain("节奏、反差包袱、分镜密度和标题语气");
    expect(prompt).toContain("复刻参数");
  });

  it("excludes generic tags when selecting the source theme", () => {
    const analysis = analyzeSource({
      ...funnyComicCase,
      topics: ["漫画", "原创漫画", "小红书", "宠物日常", "狗狗"],
    });

    expect(analysis.sourceTheme).toBe("宠物日常");
  });

  it("parses source mechanisms from a 参考案例 prompt", () => {
    const analysis = analyzeSource({
      ...funnyComicCase,
      category: "爆款图文",
      topics: ["爆款图文", "玄学能量图文", "治愈语录"],
      prompt: "参考案例《看完这段话，瞬间通透了》的内容结构、首图钩子、画面节奏和发布语气，生成一组新的爆款图文。创作方法：保留原案例的情绪安抚、仪式感和收藏动机。",
    });

    expect(analysis.type).toBe("爆款图文");
    expect(analysis.sourceMechanisms).toContain("内容结构");
    expect(analysis.sourceMechanisms).toContain("首图钩子");
  });

  it("keeps the replication contract for every route card", () => {
    for (const item of [...xhsPromptCases, ...boLandingPromptCases]) {
      const prompt = buildReplicationPrompt(item);
      expect(prompt).toMatch(new RegExp(`^生成一组新的${item.category}主题：标题《.+》，复刻参数“.+”$`));
      expect(prompt).not.toContain("副标题");
      expect(prompt).toContain("保留原图的视觉风格、构图和内容节奏");
    }
  });
});
